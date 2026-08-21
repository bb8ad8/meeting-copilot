#!/usr/bin/env bash

set -euo pipefail

driver_root="$(cd "$(dirname "$0")" && pwd)"
output_root="${MEETING_COPILOT_AUDIO_BUILD_DIR:-$driver_root/.build}"
source_file="$driver_root/vendor/apple/MeetingCopilotAudio.c"
ring_source="$driver_root/MeetingCopilotRingBuffer.c"
version="${MEETRON_AUDIO_VERSION:-${MEETING_COPILOT_AUDIO_VERSION:-0.1.1}}"
signing_identity="${MEETING_COPILOT_AUDIO_SIGNING_IDENTITY:--}"
deployment_target="${MEETING_COPILOT_AUDIO_DEPLOYMENT_TARGET:-13.0}"

usage() {
  cat <<'EOF'
Usage: ./native/audio-driver/build-driver.sh [--output DIR]

Builds the two Meetron virtual audio driver bundles. By default the
bundles are ad-hoc signed for local development. Set
MEETING_COPILOT_AUDIO_SIGNING_IDENTITY for a Developer ID build.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --output)
      output_root="${2:-}"
      shift
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

if [ "$(uname -s)" != "Darwin" ]; then
  printf 'The audio driver can only be built on macOS.\n' >&2
  exit 1
fi
if ! xcrun --find clang >/dev/null 2>&1; then
  printf 'Xcode Command Line Tools are required.\n' >&2
  exit 1
fi

mkdir -p "$output_root"

build_driver() {
  local executable="$1"
  local display_name="$2"
  local bundle_id="$3"
  local device_uid="$4"
  local box_uid="$5"
  local factory_uuid="$6"
  local bundle="$output_root/$executable.driver"

  mkdir -p "$bundle/Contents/MacOS" "$bundle/Contents/Resources/en.lproj"

  xcrun clang \
    -bundle \
    -O2 \
    -arch arm64 \
    -arch x86_64 \
    -mmacosx-version-min="$deployment_target" \
    -std=c11 \
    -Wall \
    -Wextra \
    -Werror \
    -Wno-unused-parameter \
    -Wno-missing-field-initializers \
    -framework CoreAudio \
    -framework CoreFoundation \
    -DMEETING_COPILOT_BUNDLE_ID="\"$bundle_id\"" \
    -DMEETING_COPILOT_BOX_UID="\"$box_uid\"" \
    -DMEETING_COPILOT_DEVICE_UID="\"$device_uid\"" \
    -DMEETING_COPILOT_MODEL_UID='"io.github.bb8ad8.meetron.audio.loopback.stereo"' \
    -DMEETING_COPILOT_DEVICE_NAME="\"$display_name\"" \
    -o "$bundle/Contents/MacOS/$executable" \
    "$source_file" \
    "$ring_source"

  /usr/libexec/PlistBuddy -c 'Clear dict' "$bundle/Contents/Info.plist" 2>/dev/null || true
  /usr/libexec/PlistBuddy -c 'Add :CFBundleDevelopmentRegion string English' "$bundle/Contents/Info.plist"
  /usr/libexec/PlistBuddy -c "Add :CFBundleExecutable string $executable" "$bundle/Contents/Info.plist"
  /usr/libexec/PlistBuddy -c "Add :CFBundleIdentifier string $bundle_id" "$bundle/Contents/Info.plist"
  /usr/libexec/PlistBuddy -c 'Add :CFBundleInfoDictionaryVersion string 6.0' "$bundle/Contents/Info.plist"
  /usr/libexec/PlistBuddy -c "Add :CFBundleName string $display_name" "$bundle/Contents/Info.plist"
  /usr/libexec/PlistBuddy -c 'Add :CFBundlePackageType string BNDL' "$bundle/Contents/Info.plist"
  /usr/libexec/PlistBuddy -c "Add :CFBundleShortVersionString string $version" "$bundle/Contents/Info.plist"
  /usr/libexec/PlistBuddy -c "Add :CFBundleVersion string $version" "$bundle/Contents/Info.plist"
  /usr/libexec/PlistBuddy -c 'Add :CFPlugInFactories dict' "$bundle/Contents/Info.plist"
  /usr/libexec/PlistBuddy -c "Add :CFPlugInFactories:$factory_uuid string NullAudio_Create" "$bundle/Contents/Info.plist"
  /usr/libexec/PlistBuddy -c 'Add :CFPlugInTypes dict' "$bundle/Contents/Info.plist"
  /usr/libexec/PlistBuddy -c 'Add :CFPlugInTypes:443ABAB8-E7B3-491A-B985-BEB9187030DB array' "$bundle/Contents/Info.plist"
  /usr/libexec/PlistBuddy -c "Add :CFPlugInTypes:443ABAB8-E7B3-491A-B985-BEB9187030DB:0 string $factory_uuid" "$bundle/Contents/Info.plist"

  {
    printf 'DeviceName = "%s";\n' "$display_name"
    printf 'InputStreamName = "%s Input";\n' "$display_name"
    printf 'OutputStreamName = "%s Output";\n' "$display_name"
    printf 'ManufacturerName = "Meetron OSS";\n'
    printf 'MasterElementName = "Master";\n'
    printf 'LeftElementName = "Left";\n'
    printf 'RightElementName = "Right";\n'
  } > "$bundle/Contents/Resources/en.lproj/Localizable.strings"

  if [ "$signing_identity" = "-" ]; then
    codesign --force --sign - --timestamp=none "$bundle"
  else
    codesign --force --sign "$signing_identity" --timestamp --options runtime "$bundle"
  fi
  codesign --verify --strict --verbose=1 "$bundle"
}

build_driver \
  MeetronMeetingToAI \
  'Meetron: Meeting to AI' \
  io.github.bb8ad8.meetron.audio.meeting-to-ai \
  io.github.bb8ad8.meetron.audio.meeting-to-ai.device \
  io.github.bb8ad8.meetron.audio.meeting-to-ai.box \
  A6753414-0A69-469B-8B71-E9BFB07F2052

build_driver \
  MeetronAIToMeeting \
  'Meetron: AI to Meeting' \
  io.github.bb8ad8.meetron.audio.ai-to-meeting \
  io.github.bb8ad8.meetron.audio.ai-to-meeting.device \
  io.github.bb8ad8.meetron.audio.ai-to-meeting.box \
  6E579DC5-E15D-4F07-A109-AED99FA940DC

printf 'Built audio drivers in %s\n' "$output_root"
