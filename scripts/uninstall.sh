#!/usr/bin/env bash

set -eu

remove_data=0
remove_audio_driver=0
confirmed=0

usage() {
  cat <<'EOF'
Usage: ./scripts/uninstall.sh [--remove-data] [--remove-audio-driver] [--yes]

Removes the Native Messaging Host registration. With --remove-data --yes, also
removes local settings, runtime files, and the shared dedicated Chrome profile.
With --remove-audio-driver, also removes the system-level virtual audio plug-ins.
The unpacked extension must still be removed manually from chrome://extensions.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --remove-data)
      remove_data=1
      ;;
    --remove-audio-driver)
      remove_audio_driver=1
      ;;
    --yes)
      confirmed=1
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      printf 'Unknown option: %s\n' "$1" >&2
      usage >&2
      exit 2
      ;;
  esac
  shift
done

if { [ "$remove_data" -eq 1 ] || [ "$remove_audio_driver" -eq 1 ]; } && [ "$confirmed" -ne 1 ]; then
  printf '%s\n' '--remove-data and --remove-audio-driver require --yes.' >&2
  exit 2
fi

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
runtime_dir="${MEETING_COPILOT_RUNTIME_DIR:-$repo_root/.meeting-copilot-runtime}"

canonical_path() {
  node - "$1" <<'NODE'
const fs = require("node:fs");
const path = require("node:path");

let current = path.resolve(process.argv[2]);
const missing = [];
while (!fs.existsSync(current)) {
  const parent = path.dirname(current);
  if (parent === current) break;
  missing.unshift(path.basename(current));
  current = parent;
}
const resolved = fs.existsSync(current) ? fs.realpathSync.native(current) : current;
process.stdout.write(path.join(resolved, ...missing));
NODE
}

validate_removal_paths() {
  expected_runtime="$(canonical_path "$repo_root/.meeting-copilot-runtime")"
  actual_runtime="$(canonical_path "$runtime_dir")"
  profile_root="$(canonical_path "$HOME/Library/Application Support/MeetingCopilot")"
  actual_profile="$(canonical_path "$shared_profile")"
  actual_legacy_profile="$(canonical_path "$legacy_chatgpt_profile")"

  if [ "$actual_runtime" != "$expected_runtime" ]; then
    printf 'Refusing to remove unexpected runtime path: %s\n' "$runtime_dir" >&2
    exit 1
  fi
  case "$actual_profile" in
    "$profile_root"/*) ;;
    *)
      printf 'Refusing to remove a Chrome profile outside Meetron data: %s\n' "$shared_profile" >&2
      exit 1
      ;;
  esac
  if [ "$actual_legacy_profile" != "$profile_root/ChatGPTVoiceChrome" ]; then
    printf 'Refusing to remove unexpected legacy profile path: %s\n' "$legacy_chatgpt_profile" >&2
    exit 1
  fi
}

shared_profile="${MEETING_COPILOT_PROFILE_DIR:-$HOME/Library/Application Support/MeetingCopilot/GPTParticipantChrome}"
legacy_chatgpt_profile="$HOME/Library/Application Support/MeetingCopilot/ChatGPTVoiceChrome"
if [ "$remove_data" -eq 1 ]; then
  validate_removal_paths
fi

audio_state_path="$runtime_dir/audio-original.json"
if [ -f "$audio_state_path" ]; then
  if ! restore_output="$("$repo_root/scripts/restore-audio.sh" 2>&1)"; then
    printf 'Audio restoration failed. Uninstall was stopped and recovery data was preserved.\n' >&2
    printf '%s\n' "$restore_output" >&2
    exit 1
  fi
fi
"$repo_root/scripts/install-control-ui.sh" --uninstall --quiet

if [ "$remove_audio_driver" -eq 1 ]; then
  "$repo_root/native/audio-driver/uninstall-driver.sh"
fi

if [ "$remove_data" -eq 1 ]; then
  rm -rf -- "$runtime_dir" "$shared_profile" "$legacy_chatgpt_profile"
  rm -f -- "$repo_root/.meeting-copilot.env"
  printf 'Removed Meetron local data and dedicated Chrome profiles.\n'
fi

printf 'Remove Meetron Controls from regular and shared dedicated Chrome in chrome://extensions.\n'
