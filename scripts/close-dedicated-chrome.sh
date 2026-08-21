#!/usr/bin/env bash

set -eu

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
dry_run=0

if [ -f "$repo_root/.meeting-copilot.env" ]; then
  # shellcheck disable=SC1091
  . "$repo_root/.meeting-copilot.env"
fi

usage() {
  cat <<'EOF'
Usage: ./scripts/close-dedicated-chrome.sh [--dry-run]

Closes the shared Meetron Chrome profile. This also ends ChatGPT Voice
and disconnects its dedicated Meet participant.
EOF
}

case "${1:-}" in
  "") ;;
  --dry-run) dry_run=1 ;;
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

profile_dir="${MEETING_COPILOT_PROFILE_DIR:-$HOME/Library/Application Support/MeetingCopilot/GPTParticipantChrome}"

find_profile_pids() {
  ps -axo pid=,command= | awk -v profile="--user-data-dir=$profile_dir" '
    index($0, profile) && $0 ~ /Contents\/MacOS\// && $0 !~ /Helper/ { print $1 }
  '
}

profile_pids="$(find_profile_pids)"
if [ -z "$profile_pids" ]; then
  printf 'Meetron Chrome is not running.\n'
  exit 0
fi

if [ "$dry_run" -eq 1 ]; then
  printf '[DRY RUN] close Meetron Chrome profile: %s\n' "$profile_dir"
  exit 0
fi

for profile_pid in $profile_pids; do
  kill "$profile_pid" 2>/dev/null || true
done

attempts=0
while [ -n "$(find_profile_pids)" ] && [ "$attempts" -lt 20 ]; do
  sleep 0.25
  attempts=$((attempts + 1))
done

remaining_pids="$(find_profile_pids)"
if [ -n "$remaining_pids" ]; then
  for profile_pid in $remaining_pids; do
    kill -KILL "$profile_pid" 2>/dev/null || true
  done
fi

printf 'Meetron Chrome closed.\n'
