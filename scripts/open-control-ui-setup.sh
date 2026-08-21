#!/usr/bin/env bash

set -eu

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
extension_dir="$repo_root/extension"
environment_profile_dir="${MEETING_COPILOT_PROFILE_DIR:-}"
environment_cdp_port="${MEETING_COPILOT_CDP_PORT:-}"

"$repo_root/scripts/install-control-ui.sh" --quiet

if [ -f "$repo_root/.meeting-copilot.env" ]; then
  set -a
  . "$repo_root/.meeting-copilot.env"
  set +a
fi
if [ -n "$environment_profile_dir" ]; then
  MEETING_COPILOT_PROFILE_DIR="$environment_profile_dir"
fi
if [ -n "$environment_cdp_port" ]; then
  MEETING_COPILOT_CDP_PORT="$environment_cdp_port"
fi

profile_dir="${MEETING_COPILOT_PROFILE_DIR:-$HOME/Library/Application Support/MeetingCopilot/GPTParticipantChrome}"
cdp_port="${MEETING_COPILOT_CDP_PORT:-9223}"

find_chrome() {
  for app_path in \
    '/Applications/Google Chrome.app' \
    "$HOME/Applications/Google Chrome.app"; do
    if [ -d "$app_path" ]; then
      printf '%s\n' "$app_path"
      return 0
    fi
  done
  return 1
}

chrome_path="${MEETING_COPILOT_CHROME_PATH:-}"
if [ -z "$chrome_path" ]; then
  chrome_path="$(find_chrome || true)"
fi
if [ -z "$chrome_path" ]; then
  printf 'Google Chrome was not found.\n' >&2
  exit 1
fi

find_profile_pids() {
  ps -axo pid=,command= | awk -v profile="--user-data-dir=$profile_dir" '
    index($0, profile) && $0 ~ /Contents\/MacOS\// && $0 !~ /Helper/ { print $1 }
  '
}

dedicated_endpoint_ready() {
  node "$repo_root/scripts/verify-dedicated-chrome.mjs" \
    --profile-dir "$profile_dir" --port "$cdp_port" >/dev/null 2>&1
}

profile_pids="$(find_profile_pids)"
if [ -n "$profile_pids" ]; then
  if ! dedicated_endpoint_ready; then
    printf 'The shared Chrome profile is running without its automation endpoint.\n' >&2
    printf 'Close it, then run this setup command again.\n' >&2
    exit 1
  fi
  node "$repo_root/scripts/open-chrome-page.mjs" \
    --cdp "http://127.0.0.1:$cdp_port" \
    --url 'chrome://extensions/' >/dev/null
else
  open -na "$chrome_path" --args \
    --remote-debugging-address=127.0.0.1 \
    "--remote-debugging-port=$cdp_port" \
    --use-fake-ui-for-media-stream \
    "--user-data-dir=$profile_dir" \
    --no-first-run \
    --new-window \
    'chrome://extensions/'
fi

attempts=0
while ! dedicated_endpoint_ready; do
  attempts=$((attempts + 1))
  if [ "$attempts" -ge 40 ]; then
    printf 'The dedicated Chrome automation endpoint did not start on port %s.\n' "$cdp_port" >&2
    exit 1
  fi
  sleep 0.25
done

cat <<EOF

In the shared Meetron Chrome window:
  1. Enable Developer mode.
  2. Click Load unpacked.
  3. Select: $extension_dir
  4. Confirm the extension ID is: jlikakgdldiihhflkobhnpfegjlcakdd

Chrome remembers the extension in this dedicated profile after the first load.
EOF
