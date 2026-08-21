#!/usr/bin/env bash

set -euo pipefail

driver_root="$(cd "$(dirname "$0")" && pwd)"
repo_root="$(cd "$driver_root/../.." && pwd)"
version="${MEETRON_AUDIO_VERSION:-${MEETING_COPILOT_AUDIO_VERSION:-0.1.0}}"
if [ "$#" -gt 0 ]; then
  package_path="$1"
else
  package_path="$repo_root/dist/development/MeetronAudio-$version.pkg"
fi
checksum_path="$package_path.sha256"
working_dir="$(mktemp -d "${TMPDIR:-/tmp}/meetron-package-test.XXXXXX")"
trap 'rm -rf "$working_dir"' EXIT

if [ ! -f "$package_path" ]; then
  printf 'Package was not found: %s\n' "$package_path" >&2
  exit 1
fi

pkgutil --expand-full "$package_path" "$working_dir/expanded"
payload="$working_dir/expanded/MeetronAudioComponent.pkg/Payload"

for binary in \
  "$payload/Library/Audio/Plug-Ins/HAL/MeetronMeetingToAI.driver/Contents/MacOS/MeetronMeetingToAI" \
  "$payload/Library/Audio/Plug-Ins/HAL/MeetronAIToMeeting.driver/Contents/MacOS/MeetronAIToMeeting" \
  "$payload/usr/local/bin/meetron-audioctl"; do
  test -x "$binary"
  architectures="$(lipo -archs "$binary")"
  case " $architectures " in
    *' arm64 '*) ;;
    *) printf 'arm64 is missing from %s\n' "$binary" >&2; exit 1 ;;
  esac
  case " $architectures " in
    *' x86_64 '*) ;;
    *) printf 'x86_64 is missing from %s\n' "$binary" >&2; exit 1 ;;
  esac
  min_versions="$(otool -l "$binary" | awk '/LC_BUILD_VERSION/{show=1;next} show&&/minos/{print $2;show=0}')"
  if printf '%s\n' "$min_versions" | grep -Fvx '13.0' >/dev/null; then
    printf 'Unexpected deployment target in %s: %s\n' "$binary" "$min_versions" >&2
    exit 1
  fi
done

test -L "$payload/usr/local/bin/meeting-copilot-audioctl"
grep -F '<os-version min="13.0"' "$working_dir/expanded/Distribution" >/dev/null

if [ -f "$checksum_path" ]; then
  (
    cd "$(dirname "$package_path")"
    shasum -a 256 -c "$(basename "$checksum_path")"
  ) >/dev/null
fi

if [ "${MEETRON_REQUIRE_NOTARIZED:-0}" = "1" ]; then
  xcrun stapler validate "$package_path"
  spctl --assess --type install --verbose=2 "$package_path"
fi

printf 'Meetron Audio package validation passed.\n'
