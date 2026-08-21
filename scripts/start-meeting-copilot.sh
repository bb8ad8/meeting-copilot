#!/usr/bin/env bash

set -eu

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
printf '[NOTICE] start-meeting-copilot.sh is kept for compatibility. Use start-meetron.sh.\n' >&2
exec "$repo_root/scripts/start-meetron.sh" "$@"
