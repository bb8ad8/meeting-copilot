#!/usr/bin/env bash

set -euo pipefail

driver_root="$(cd "$(dirname "$0")" && pwd)"
build_root="${MEETING_COPILOT_AUDIO_BUILD_DIR:-$driver_root/.build}"
install_root="${MEETING_COPILOT_AUDIO_INSTALL_DIR:-/Library/Audio/Plug-Ins/HAL}"
dry_run=0
restart_audio=0

usage() {
  cat <<'EOF'
Usage: ./native/audio-driver/install-driver.sh [--dry-run] [--restart-audio]

Builds and installs the Meetron virtual audio devices. Installation
into /Library requires an administrator password. Log out or restart macOS
after installation unless --restart-audio is used for local development.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run) dry_run=1 ;;
    --restart-audio) restart_audio=1 ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

if [ "$dry_run" -eq 1 ]; then
  printf '[DRY RUN] build two signed virtual audio drivers\n'
  printf '[DRY RUN] install MeetronMeetingToAI.driver into %s\n' "$install_root"
  printf '[DRY RUN] install MeetronAIToMeeting.driver into %s\n' "$install_root"
  exit 0
fi

"$driver_root/build-driver.sh"

install_bundle() {
  local name="$1"
  local source="$build_root/$name.driver"
  local destination="$install_root/$name.driver"
  sudo /usr/bin/ditto "$source" "$destination"
  sudo /usr/sbin/chown -R root:wheel "$destination"
  sudo /bin/chmod -R go-w "$destination"
  codesign --verify --strict --verbose=1 "$destination"
}

sudo /bin/mkdir -p "$install_root"
install_bundle MeetronMeetingToAI
install_bundle MeetronAIToMeeting

# Remove the exact Phase 1 development bundles only after Meetron is installed.
for legacy_name in MeetingCopilotMeetingToAI MeetingCopilotAIToMeeting; do
  legacy_path="$install_root/$legacy_name.driver"
  if [ -e "$legacy_path" ]; then
    sudo /bin/rm -rf "$legacy_path"
    printf 'Removed legacy driver %s\n' "$legacy_path"
  fi
done

if [ "$restart_audio" -eq 1 ]; then
  sudo /usr/bin/killall coreaudiod 2>/dev/null || true
  printf 'Core Audio was restarted. Reopen applications that use audio.\n'
else
  printf 'Installation complete. Log out or restart macOS before first use.\n'
fi
