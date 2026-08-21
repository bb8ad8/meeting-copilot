#!/usr/bin/env bash

set -eu

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
failures=0
temp_dir="$(mktemp -d "${TMPDIR:-/tmp}/meeting-copilot-tests.XXXXXX")"
fake_chrome="$temp_dir/Google Chrome.app"
mkdir -p "$fake_chrome/Contents/MacOS"
touch "$fake_chrome/Contents/MacOS/Google Chrome"
chmod +x "$fake_chrome/Contents/MacOS/Google Chrome"
trap 'rm -rf "$temp_dir"' EXIT

pass() {
  printf '[PASS] %s\n' "$1"
}

fail() {
  printf '[FAIL] %s\n' "$1" >&2
  failures=$((failures + 1))
}

for script in "$repo_root"/scripts/*.sh; do
  if bash -n "$script"; then
    pass "bash syntax: ${script##*/}"
  else
    fail "bash syntax: ${script##*/}"
  fi
done

if bash -n "$repo_root/Meetron Setup.command"; then
  pass 'bash syntax: Meetron Setup.command'
else
  fail 'bash syntax: Meetron Setup.command'
fi

if "$repo_root/scripts/check-env.sh" --help >/dev/null; then
  pass 'check-env help'
else
  fail 'check-env help'
fi

if "$repo_root/scripts/setup-meetron.sh" --help >/dev/null; then
  pass 'Meetron setup help'
else
  fail 'Meetron setup help'
fi

if release_guard_output="$(MEETRON_RELEASE_BUILD=1 \
  MEETRON_NOTARY_PROFILE= \
  MEETRON_NOTARY_KEY= \
  MEETRON_NOTARY_KEY_ID= \
  MEETRON_NOTARY_ISSUER= \
  "$repo_root/native/audio-driver/package-driver.sh" 2>&1)"; then
  fail 'release packaging requires notarization credentials'
elif printf '%s\n' "$release_guard_output" | grep -F 'requires Apple notarization credentials' >/dev/null; then
  pass 'release packaging requires notarization credentials'
else
  fail 'release packaging requires notarization credentials'
fi

fake_setup_bin="$temp_dir/setup-bin"
fake_setup_pkg="$temp_dir/MeetronAudio-9.9.9.pkg"
mkdir -p "$fake_setup_bin"
touch "$fake_setup_pkg"
cat > "$fake_setup_bin/pkgutil" <<'EOF'
#!/usr/bin/env bash
case "$1" in
  --pkg-info) exit 1 ;;
  --check-signature)
    cat <<'SIGNATURE'
Status: signed by a developer certificate issued by Apple for distribution
Notarization: trusted by the Apple notary service
Developer ID Installer: Yuki Inaba (SHDVCBHNJW)
SIGNATURE
    ;;
  *) exit 2 ;;
esac
EOF
cat > "$fake_setup_bin/spctl" <<'EOF'
#!/usr/bin/env bash
exit 0
EOF
chmod +x "$fake_setup_bin/pkgutil" "$fake_setup_bin/spctl"

if setup_pkg_output="$(PATH="$fake_setup_bin:/usr/bin:/bin" \
  MEETRON_SETUP_PKG_PATH="$fake_setup_pkg" \
  MEETRON_SETUP_NO_OPEN=1 \
  "$repo_root/scripts/setup-meetron.sh" --check-only 2>&1)"; then
  fail 'Meetron setup pauses for PKG installation'
else
  setup_status=$?
  if [ "$setup_status" -eq 20 ] &&
    printf '%s\n' "$setup_pkg_output" | grep -F 'PKGの署名と公証を確認しました' >/dev/null; then
    pass 'Meetron setup verifies and locates a downloaded PKG'
  else
    fail 'Meetron setup verifies and locates a downloaded PKG'
  fi
fi

if setup_download_output="$(PATH="$fake_setup_bin:/usr/bin:/bin" \
  MEETRON_SETUP_PKG_PATH="$temp_dir/not-downloaded.pkg" \
  MEETRON_SETUP_NO_OPEN=1 \
  "$repo_root/scripts/setup-meetron.sh" --check-only 2>&1)"; then
  fail 'Meetron setup pauses for PKG download'
else
  setup_status=$?
  if [ "$setup_status" -eq 20 ] &&
    printf '%s\n' "$setup_download_output" | grep -F 'GitHub Releases' >/dev/null; then
    pass 'Meetron setup explains where to download the PKG'
  else
    fail 'Meetron setup explains where to download the PKG'
  fi
fi

if "$repo_root/scripts/configure-audio.sh" --help >/dev/null; then
  pass 'audio routing setup help'
else
  fail 'audio routing setup help'
fi

fake_audio_source="$temp_dir/SwitchAudioSource"
fake_audio_state="$temp_dir/fake-audio-state"
fake_audio_runtime="$temp_dir/fake-audio-runtime"
printf 'Physical microphone\nPhysical output\n' > "$fake_audio_state"
cat > "$fake_audio_source" <<'EOF'
#!/usr/bin/env bash
set -eu
case "$*" in
  -a)
    printf 'BlackHole 2ch\nBlackHole 16ch\nPhysical microphone\nPhysical output\n'
    ;;
  '-c -t input')
    sed -n '1p' "$FAKE_AUDIO_STATE"
    ;;
  '-c -t output')
    sed -n '2p' "$FAKE_AUDIO_STATE"
    ;;
  '-t input -s BlackHole 2ch')
    { printf 'BlackHole 2ch\n'; sed -n '2p' "$FAKE_AUDIO_STATE"; } > "$FAKE_AUDIO_STATE.tmp"
    mv "$FAKE_AUDIO_STATE.tmp" "$FAKE_AUDIO_STATE"
    ;;
  '-t input -s Physical microphone')
    { printf 'Physical microphone\n'; sed -n '2p' "$FAKE_AUDIO_STATE"; } > "$FAKE_AUDIO_STATE.tmp"
    mv "$FAKE_AUDIO_STATE.tmp" "$FAKE_AUDIO_STATE"
    ;;
  '-t output -s '*)
    printf 'System output must not be changed.\n' >&2
    exit 90
    ;;
  *)
    printf 'Unexpected SwitchAudioSource arguments: %s\n' "$*" >&2
    exit 2
    ;;
esac
EOF
chmod +x "$fake_audio_source"
if configure_result="$(FAKE_AUDIO_STATE="$fake_audio_state" \
  MEETING_COPILOT_AUDIOCTL="" \
  MEETING_COPILOT_SWITCH_AUDIO_SOURCE="$fake_audio_source" \
  MEETING_COPILOT_RUNTIME_DIR="$fake_audio_runtime" \
  "$repo_root/scripts/configure-audio.sh")" &&
  [ "$(sed -n '2p' "$fake_audio_state")" = 'Physical output' ] &&
  node -e '
    const fs = require("node:fs");
    const result = JSON.parse(process.argv[1]);
    const state = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
    if (!result.outputUnchanged || result.output !== "Physical output" || state.outputChanged !== false) process.exit(1);
  ' "$configure_result" "$fake_audio_runtime/audio-original.json"; then
  pass 'audio setup keeps the system output unchanged'
else
  fail 'audio setup keeps the system output unchanged'
fi

if FAKE_AUDIO_STATE="$fake_audio_state" \
  MEETING_COPILOT_AUDIOCTL="" \
  MEETING_COPILOT_SWITCH_AUDIO_SOURCE="$fake_audio_source" \
  MEETING_COPILOT_RUNTIME_DIR="$fake_audio_runtime" \
  "$repo_root/scripts/restore-audio.sh" >/dev/null &&
  [ "$(sed -n '1p' "$fake_audio_state")" = 'Physical microphone' ] &&
  [ "$(sed -n '2p' "$fake_audio_state")" = 'Physical output' ] &&
  [ ! -f "$fake_audio_runtime/audio-original.json" ]; then
  pass 'audio restore restores only the changed input'
else
  fail 'audio restore preserves the unchanged system output'
fi

if "$repo_root/scripts/restore-audio.sh" --help >/dev/null; then
  pass 'audio routing restore help'
else
  fail 'audio routing restore help'
fi

if "$repo_root/scripts/close-dedicated-chrome.sh" --help >/dev/null; then
  pass 'dedicated Chrome cleanup help'
else
  fail 'dedicated Chrome cleanup help'
fi

if "$repo_root/scripts/uninstall.sh" --help >/dev/null; then
  pass 'uninstaller help'
else
  fail 'uninstaller help'
fi

uninstall_repo="$temp_dir/uninstall-repo"
uninstall_home="$temp_dir/uninstall-home"
uninstall_runtime="$uninstall_repo/.meeting-copilot-runtime"
mkdir -p "$uninstall_repo/scripts" "$uninstall_home" "$uninstall_runtime"
cp "$repo_root/scripts/uninstall.sh" \
  "$repo_root/scripts/restore-audio.sh" \
  "$repo_root/scripts/install-control-ui.sh" \
  "$uninstall_repo/scripts/"
printf '{invalid recovery state\n' > "$uninstall_runtime/audio-original.json"
if HOME="$uninstall_home" MEETING_COPILOT_RUNTIME_DIR="$uninstall_runtime" \
  "$uninstall_repo/scripts/uninstall.sh" --remove-data --yes >/dev/null 2>&1; then
  fail 'uninstaller stops when audio restoration fails'
elif [ -f "$uninstall_runtime/audio-original.json" ]; then
  pass 'uninstaller preserves recovery data when audio restoration fails'
else
  fail 'uninstaller preserves failed audio recovery state'
fi

uninstall_sentinel="$uninstall_home/keep-me"
printf 'keep\n' > "$uninstall_sentinel"
rm -f "$uninstall_runtime/audio-original.json"
if HOME="$uninstall_home" \
  MEETING_COPILOT_RUNTIME_DIR="$uninstall_runtime" \
  MEETING_COPILOT_PROFILE_DIR="$uninstall_home" \
  "$uninstall_repo/scripts/uninstall.sh" --remove-data --yes >/dev/null 2>&1; then
  fail 'uninstaller rejects a profile path outside Meetron data'
elif [ -f "$uninstall_sentinel" ]; then
  pass 'uninstaller protects paths outside Meetron data'
else
  fail 'uninstaller preserved unrelated user data'
fi

if HOME="$uninstall_home" \
  MEETING_COPILOT_RUNTIME_DIR="$uninstall_home" \
  "$uninstall_repo/scripts/uninstall.sh" --remove-data --yes >/dev/null 2>&1; then
  fail 'uninstaller rejects an unexpected runtime path'
elif [ -f "$uninstall_sentinel" ]; then
  pass 'uninstaller protects data from an unexpected runtime path'
else
  fail 'uninstaller preserved unrelated runtime data'
fi

if "$repo_root/scripts/install-audio-deps.sh" --dry-run --yes --accept-blackhole-license >/dev/null; then
  pass 'audio installer dry run'
else
  fail 'audio installer dry run'
fi

if node "$repo_root/scripts/prepare-meet.mjs" --help >/dev/null; then
  pass 'Meet preparation help'
else
  fail 'Meet preparation help'
fi

if node "$repo_root/scripts/prepare-chatgpt-live.mjs" --help >/dev/null; then
  pass 'ChatGPT Voice preparation help'
else
  fail 'ChatGPT Voice preparation help'
fi

if node "$repo_root/scripts/open-chrome-page.mjs" --help >/dev/null; then
  pass 'shared Chrome page opener help'
else
  fail 'shared Chrome page opener help'
fi

if node "$repo_root/scripts/verify-dedicated-chrome.mjs" --help >/dev/null; then
  pass 'dedicated Chrome ownership verifier help'
else
  fail 'dedicated Chrome ownership verifier help'
fi

if node "$repo_root/scripts/set-meet-mic.mjs" --help >/dev/null; then
  pass 'Meet microphone control help'
else
  fail 'Meet microphone control help'
fi

if "$repo_root/scripts/set-meet-mic.sh" --help >/dev/null; then
  pass 'Meet microphone wrapper help'
else
  fail 'Meet microphone wrapper help'
fi

if node "$repo_root/scripts/set-meet-mic.mjs" \
  --state unmuted --assume-before invalid >/dev/null 2>&1; then
  fail 'Meet microphone rejects invalid assumed state'
else
  pass 'Meet microphone rejects invalid assumed state'
fi

if "$repo_root/scripts/install-control-ui.sh" --help >/dev/null; then
  pass 'control UI installer help'
else
  fail 'control UI installer help'
fi

node_binary="$(command -v node)"
if env -i HOME="$HOME" PATH=/usr/bin:/bin \
  MEETING_COPILOT_NODE_PATH="$node_binary" \
  "$repo_root/scripts/native-host.sh" --help >/dev/null; then
  pass 'Native Host starts with Chrome-style PATH'
else
  fail 'Native Host Chrome PATH compatibility'
fi

for javascript in "$repo_root"/extension/*.js "$repo_root"/scripts/*.mjs "$repo_root"/tests/*.mjs; do
  if node --check "$javascript"; then
    pass "JavaScript syntax: ${javascript##*/}"
  else
    fail "JavaScript syntax: ${javascript##*/}"
  fi
done

if node -e '
  const crypto = require("node:crypto");
  const fs = require("node:fs");
  const manifest = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
  if (manifest.manifest_version !== 3) process.exit(1);
  if (manifest.action?.default_popup !== "popup.html") process.exit(1);
  const key = Buffer.from(manifest.key, "base64");
  const hex = crypto.createHash("sha256").update(key).digest().subarray(0, 16).toString("hex");
  const id = [...hex].map((value) => String.fromCharCode(97 + Number.parseInt(value, 16))).join("");
  if (id !== "jlikakgdldiihhflkobhnpfegjlcakdd") process.exit(1);
' "$repo_root/extension/manifest.json"; then
  pass 'extension manifest and stable ID'
else
  fail 'extension manifest and stable ID'
fi

if node "$repo_root/tests/native-host-test.mjs" >/dev/null; then
  pass 'Native Host protocol and setup validation'
else
  fail 'Native Host protocol ping'
fi

if node "$repo_root/tests/audio-backend-test.mjs" >/dev/null; then
  pass 'audio backend selection and route isolation'
else
  fail 'audio backend selection and route isolation'
fi

if node "$repo_root/tests/session-cancel-test.mjs" >/dev/null; then
  pass 'session stop cancels an in-progress launch'
else
  fail 'session launch cancellation'
fi

if node "$repo_root/tests/service-worker-test.mjs" >/dev/null; then
  pass 'service worker sender authorization'
else
  fail 'service worker sender authorization'
fi

if node "$repo_root/tests/playwright-cdp-test.mjs" >/dev/null; then
  pass 'Playwright CDP compatibility defaults'
else
  fail 'Playwright CDP compatibility defaults'
fi

if [ "${MEETING_COPILOT_SKIP_BROWSER_TEST:-0}" = "1" ]; then
  pass 'extension panel and popup UI browser test (skipped by environment)'
elif [ -x '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' ]; then
  if node "$repo_root/tests/extension-ui-test.mjs" >/dev/null; then
    pass 'extension panel and popup UI browser test'
  else
    fail 'extension UI browser test'
  fi
  if node "$repo_root/tests/unified-profile-test.mjs" >/dev/null; then
    pass 'unified profile preserves Meet during Voice restart'
  else
    fail 'unified profile Voice restart isolation'
  fi
  if node "$repo_root/tests/prepare-meet-test.mjs" >/dev/null; then
    pass 'Meet camera state handling'
  else
    fail 'Meet camera state handling'
  fi
else
  pass 'extension panel and popup UI browser test (skipped: Chrome not installed)'
fi

native_manifest_output="$(PATH=/usr/bin:/bin \
  MEETING_COPILOT_NODE_PATH="$node_binary" \
  MEETING_COPILOT_PROFILE_DIR="$temp_dir/dedicated-profile" \
  "$repo_root/scripts/install-control-ui.sh" --dry-run)"
if printf '%s\n' "$native_manifest_output" | grep -F -- 'chrome-extension://jlikakgdldiihhflkobhnpfegjlcakdd/' >/dev/null &&
  printf '%s\n' "$native_manifest_output" | grep -F -- 'com.meeting_copilot.host' >/dev/null &&
  printf '%s\n' "$native_manifest_output" | grep -F -- "$temp_dir/dedicated-profile/NativeMessagingHosts" >/dev/null; then
  pass 'Native Host installer dry run'
else
  fail 'Native Host installer dry run'
fi

launcher_output="$(MEETING_COPILOT_CHROME_PATH="$fake_chrome" \
  MEETING_COPILOT_PROFILE_DIR="$temp_dir/profile" \
  "$repo_root/scripts/open-gpt-participant.sh" --dry-run 'https://meet.google.com/abc-defg-hij')"
if printf '%s\n' "$launcher_output" | grep -F -- '--user-data-dir=' >/dev/null; then
  pass 'Meet launcher dry run'
else
  fail 'Meet launcher dry run'
fi

auto_launcher_output="$(MEETING_COPILOT_CHROME_PATH="$fake_chrome" \
  MEETING_COPILOT_PROFILE_DIR="$temp_dir/profile" \
  "$repo_root/scripts/open-gpt-participant.sh" --auto-prepare --restart-profile --dry-run \
  'https://meet.google.com/abc-defg-hij')"
if printf '%s\n' "$auto_launcher_output" | grep -F -- '--remote-debugging-address=127.0.0.1' >/dev/null &&
  printf '%s\n' "$auto_launcher_output" | grep -F -- '--use-fake-ui-for-media-stream' >/dev/null; then
  pass 'automated Meet launcher dry run'
else
  fail 'automated Meet launcher dry run'
fi

join_launcher_output="$(MEETING_COPILOT_CHROME_PATH="$fake_chrome" \
  MEETING_COPILOT_PROFILE_DIR="$temp_dir/profile" \
  "$repo_root/scripts/open-gpt-participant.sh" --join --join-delay 7 --restart-profile --dry-run \
  'https://meet.google.com/abc-defg-hij')"
if printf '%s\n' "$join_launcher_output" | grep -F -- 'wait 7 seconds' >/dev/null; then
  pass 'automated Meet admission dry run'
else
  fail 'automated Meet admission dry run'
fi

default_join_output="$(MEETING_COPILOT_CHROME_PATH="$fake_chrome" \
  MEETING_COPILOT_PROFILE_DIR="$temp_dir/profile" \
  "$repo_root/scripts/open-gpt-participant.sh" --join --restart-profile --dry-run \
  'https://meet.google.com/abc-defg-hij')"
if printf '%s\n' "$default_join_output" | grep -F -- 'wait 2 seconds' >/dev/null; then
  pass 'short default Meet admission delay'
else
  fail 'short default Meet admission delay'
fi

chatgpt_launcher_output="$(MEETING_COPILOT_CHROME_PATH="$fake_chrome" \
  MEETING_COPILOT_PROFILE_DIR="$temp_dir/profile" \
  MEETING_COPILOT_CDP_PORT=9223 \
  MEETING_COPILOT_CHATGPT_PROJECT_URL='https://chatgpt.com/g/g-p-test/project' \
  "$repo_root/scripts/open-chatgpt-live.sh" --restart-profile --dry-run)"
if printf '%s\n' "$chatgpt_launcher_output" | grep -F -- '--remote-debugging-port=9223' >/dev/null &&
  printf '%s\n' "$chatgpt_launcher_output" | grep -F -- "--user-data-dir=$temp_dir/profile" >/dev/null &&
  printf '%s\n' "$chatgpt_launcher_output" | grep -F -- 'https://chatgpt.com/g/g-p-test/project' >/dev/null; then
  pass 'ChatGPT Voice launcher dry run'
else
  fail 'ChatGPT Voice launcher dry run'
fi

if MEETING_COPILOT_CHROME_PATH="$fake_chrome" \
  "$repo_root/scripts/open-gpt-participant.sh" --dry-run 'http://example.com/not-a-meeting' >/dev/null 2>&1; then
  fail 'launcher rejects unsupported URLs'
else
  pass 'launcher rejects unsupported URLs'
fi

if [ "$failures" -ne 0 ]; then
  printf '%s test(s) failed.\n' "$failures" >&2
  exit 1
fi

printf 'All script tests passed.\n'
