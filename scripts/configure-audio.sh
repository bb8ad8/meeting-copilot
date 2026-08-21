#!/usr/bin/env bash

set -eu

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
node_binary="${MEETING_COPILOT_NODE_PATH:-$(command -v node || true)}"

if [ -z "$node_binary" ]; then
  printf 'Node.js was not found.\n' >&2
  exit 1
fi

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  exec "$node_binary" "$repo_root/scripts/audio-backend.mjs" --help
fi
if [ "$#" -gt 1 ] || { [ "$#" -eq 1 ] && [ "$1" != "--dry-run" ]; }; then
  printf 'Usage: ./scripts/configure-audio.sh [--dry-run]\n' >&2
  exit 2
fi

exec "$node_binary" "$repo_root/scripts/audio-backend.mjs" configure "$@"
