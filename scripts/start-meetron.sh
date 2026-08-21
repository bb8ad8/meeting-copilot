#!/usr/bin/env bash

set -eu

if [ "$#" -ne 1 ]; then
  printf 'Usage: ./scripts/start-meetron.sh MEETING_URL\n' >&2
  exit 2
fi

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
meeting_url="$1"
audio_configured=0
launch_completed=0
dedicated_launch_started=0
environment_meet_cdp_port="${MEETING_COPILOT_CDP_PORT:-}"

cleanup_on_failure() {
  if [ "$launch_completed" -ne 1 ]; then
    if [ "$dedicated_launch_started" -eq 1 ]; then
      printf '[INFO] Closing the dedicated browser after launch failure.\n' >&2
      "$repo_root/scripts/close-dedicated-chrome.sh" >/dev/null 2>&1 || true
    fi
    if [ "$audio_configured" -eq 1 ]; then
      printf '[INFO] Restoring the previous macOS audio defaults after launch failure.\n' >&2
      "$repo_root/scripts/restore-audio.sh" >/dev/null 2>&1 || true
    fi
  fi
}
trap cleanup_on_failure EXIT

# These paths and variables intentionally keep their original names so existing
# Meeting Copilot installations continue to work without migrating local data.
if [ -f "$repo_root/.meeting-copilot.env" ]; then
  set -a
  . "$repo_root/.meeting-copilot.env"
  set +a
fi
if [ -n "$environment_meet_cdp_port" ]; then
  MEETING_COPILOT_CDP_PORT="$environment_meet_cdp_port"
  export MEETING_COPILOT_CDP_PORT
fi
"$repo_root/scripts/install-control-ui.sh" --quiet
audio_configured=1
"$repo_root/scripts/configure-audio.sh"
dedicated_launch_started=1
"$repo_root/scripts/open-chatgpt-live.sh" --restart-profile
"$repo_root/scripts/open-gpt-participant.sh" --join "$meeting_url"
"$repo_root/scripts/set-meet-mic.sh" --assume-before muted --wait 60 unmute
launch_completed=1

printf '\nChatGPT Voice is active and the Meetron participant has joined.\n'
printf 'The meeting microphone is unmuted; Project instructions control when ChatGPT speaks.\n'
