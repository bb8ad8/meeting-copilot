#!/usr/bin/env bash

set -eu

dry_run=0
restart_audio=0

usage() {
  cat <<'EOF'
Usage: ./scripts/install-audio-deps.sh [options]

Builds Meetron's Core Audio helper and installs its two virtual audio
devices. No Homebrew audio package is required.

Options:
  --dry-run       Show what would be installed.
  --restart-audio Restart Core Audio after installation (development only).
  --yes           Accepted for compatibility; sudo may still request a password.
  -h, --help      Show this help.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --dry-run) dry_run=1 ;;
    --restart-audio) restart_audio=1 ;;
    --yes|--accept-blackhole-license) : ;; # Compatibility with the pre-Phase-1 installer.
    -h|--help) usage; exit 0 ;;
    *) printf 'Unknown argument: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

if [ "$(uname -s 2>/dev/null || true)" != "Darwin" ]; then
  printf 'Error: this installer supports macOS only.\n' >&2
  exit 1
fi

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
if [ "$dry_run" -eq 1 ]; then
  "$repo_root/native/audio-driver/install-driver.sh" --dry-run
  printf '[DRY RUN] build the native Core Audio control helper\n'
  exit 0
fi

"$repo_root/scripts/build-audio-control.sh"
if [ "$restart_audio" -eq 1 ]; then
  "$repo_root/native/audio-driver/install-driver.sh" --restart-audio
else
  "$repo_root/native/audio-driver/install-driver.sh"
fi

printf '\nNext: log out or restart macOS, then run ./scripts/check-env.sh.\n'
