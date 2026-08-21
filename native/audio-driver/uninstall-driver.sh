#!/usr/bin/env bash

set -euo pipefail

install_root="${MEETING_COPILOT_AUDIO_INSTALL_DIR:-/Library/Audio/Plug-Ins/HAL}"
restart_audio=0

if [ "${1:-}" = "--restart-audio" ]; then
  restart_audio=1
elif [ -n "${1:-}" ] && [ "${1:-}" != "--help" ]; then
  printf 'Usage: ./native/audio-driver/uninstall-driver.sh [--restart-audio]\n' >&2
  exit 2
elif [ "${1:-}" = "--help" ]; then
  printf 'Usage: ./native/audio-driver/uninstall-driver.sh [--restart-audio]\n'
  exit 0
fi

for name in MeetronMeetingToAI MeetronAIToMeeting MeetingCopilotMeetingToAI MeetingCopilotAIToMeeting; do
  path="$install_root/$name.driver"
  if [ -e "$path" ]; then
    sudo /bin/rm -rf "$path"
    printf 'Removed %s\n' "$path"
  fi
done

for installed_path in \
  /usr/local/bin/meetron-audioctl \
  /usr/local/bin/meeting-copilot-audioctl \
  /usr/local/share/doc/meetron-audio; do
  if [ -e "$installed_path" ] || [ -L "$installed_path" ]; then
    sudo /bin/rm -rf "$installed_path"
    printf 'Removed %s\n' "$installed_path"
  fi
done

if pkgutil --pkg-info io.github.bb8ad8.meetron.audio.pkg >/dev/null 2>&1; then
  sudo pkgutil --forget io.github.bb8ad8.meetron.audio.pkg >/dev/null
  printf 'Forgot installer receipt io.github.bb8ad8.meetron.audio.pkg\n'
fi

if [ "$restart_audio" -eq 1 ]; then
  sudo /usr/bin/killall coreaudiod 2>/dev/null || true
else
  printf 'Log out or restart macOS to finish removal.\n'
fi
