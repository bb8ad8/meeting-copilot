#!/usr/bin/env bash

set -u

if [ "${1:-}" = "--help" ] || [ "${1:-}" = "-h" ]; then
  cat <<'EOF'
Usage: ./scripts/check-env.sh

Checks macOS, Chrome, the native audio controller, and the selected virtual
audio backend. Meetron Audio is preferred; BlackHole remains a legacy
migration fallback.
EOF
  exit 0
fi
if [ "$#" -ne 0 ]; then
  printf 'Unknown argument: %s\n' "$1" >&2
  exit 2
fi

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
required_missing=0
warnings=0

ok() { printf '[OK]      %s\n' "$1"; }
missing() { printf '[MISSING] %s\n' "$1"; required_missing=$((required_missing + 1)); }
warn() { printf '[WARN]    %s\n' "$1"; warnings=$((warnings + 1)); }
info() { printf '[INFO]    %s\n' "$1"; }

find_app() {
  for app_path in "$@"; do
    if [ -d "$app_path" ]; then printf '%s\n' "$app_path"; return 0; fi
  done
  return 1
}

printf 'Meetron environment check\n'
printf '%s\n' '================================='

if [ "$(uname -s 2>/dev/null || true)" = "Darwin" ]; then
  macos_version="$(sw_vers -productVersion 2>/dev/null || printf unknown)"
  architecture="$(uname -m)"
  macos_major="${macos_version%%.*}"
  if [ "$macos_major" -ge 13 ]; then
    ok "macOS $macos_version ($architecture)"
  else
    missing "macOS 13 or later is required (found $macos_version)."
  fi
  if [ "$architecture" = "x86_64" ]; then
    info 'Intel Mac support is best effort; the distributed audio package is Universal.'
  fi
else
  missing 'macOS is required.'
fi

if command -v node >/dev/null 2>&1 && command -v npm >/dev/null 2>&1; then
  node_version="$(node --version)"
  node_major="$(printf '%s' "$node_version" | sed 's/^v//' | cut -d. -f1)"
  if [ "$node_major" -ge 22 ]; then
    ok "Node.js: $node_version, npm: $(npm --version)"
  else
    missing "Node.js 22 or later is required (found $node_version)."
  fi
else
  missing 'Node.js and npm were not found.'
fi

audioctl="$repo_root/native/audio-control/.build/apple/Products/Release/meetron-audioctl"
if [ ! -x "$audioctl" ]; then
  audioctl="$repo_root/native/audio-control/.build/release/meetron-audioctl"
fi
if [ ! -x "$audioctl" ]; then
  audioctl="/usr/local/bin/meetron-audioctl"
fi
if [ -x "$audioctl" ]; then
  ok "Native Core Audio controller: $audioctl"
  info 'Running this controller does not require Xcode or Swift.'
else
  missing 'Native Core Audio controller has not been built.'
  if command -v swift >/dev/null 2>&1 && xcrun --find clang >/dev/null 2>&1; then
    info 'Apple development tools are available for a source build.'
    info 'Next: ./scripts/build-audio-control.sh'
  else
    info 'Install MeetronAudio-*.pkg, or install Xcode Command Line Tools for a source build.'
  fi
fi

chrome_path="$(find_app '/Applications/Google Chrome.app' "$HOME/Applications/Google Chrome.app" || true)"
if [ -n "$chrome_path" ]; then ok "Google Chrome: $chrome_path"; else missing 'Google Chrome was not found.'; fi

printf '\nAudio devices\n'
printf '%s\n' '-------------'
audio_status="$(node "$repo_root/scripts/audio-backend.mjs" status 2>/dev/null || true)"
if [ -n "$audio_status" ] && node -e 'JSON.parse(process.argv[1])' "$audio_status" 2>/dev/null; then
  backend="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).backendLabel || "unknown")' "$audio_status")"
  devices_ready="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).devicesReady ? "1" : "0")' "$audio_status")"
  current_input="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).input || "")' "$audio_status")"
  current_output="$(node -e 'process.stdout.write(JSON.parse(process.argv[1]).output || "")' "$audio_status")"
  node -e 'for (const name of JSON.parse(process.argv[1]).devices || []) console.log(`  - ${name}`)' "$audio_status"
  if [ "$devices_ready" = "1" ]; then
    ok "Audio backend: $backend"
  else
    missing 'The two Meetron virtual audio devices were not found.'
    info 'Next: ./scripts/install-audio-deps.sh'
  fi
  [ -n "$current_input" ] && info "Default input: $current_input"
  [ -n "$current_output" ] && info "Default output: $current_output"
else
  missing 'Audio devices could not be inspected.'
fi

if command -v brew >/dev/null 2>&1; then
  info 'Homebrew is available but is no longer required for audio routing.'
fi

printf '\nSummary\n'
printf '%s\n' '-------'
if [ "$required_missing" -eq 0 ]; then
  ok "Required dependencies are present ($warnings warning(s))."
  exit 0
fi
printf '[MISSING] %s required dependency check(s) failed.\n' "$required_missing"
exit 1
