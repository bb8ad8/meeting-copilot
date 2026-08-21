#!/usr/bin/env bash

set -euo pipefail
export COPYFILE_DISABLE=1

driver_root="$(cd "$(dirname "$0")" && pwd)"
repo_root="$(cd "$driver_root/../.." && pwd)"
version="${MEETRON_AUDIO_VERSION:-${MEETING_COPILOT_AUDIO_VERSION:-0.1.0}}"
deployment_target="${MEETRON_AUDIO_DEPLOYMENT_TARGET:-${MEETING_COPILOT_AUDIO_DEPLOYMENT_TARGET:-13.0}}"
application_identity="${MEETRON_AUDIO_SIGNING_IDENTITY:-${MEETING_COPILOT_AUDIO_SIGNING_IDENTITY:--}}"
installer_identity="${MEETRON_INSTALLER_SIGNING_IDENTITY:-${MEETING_COPILOT_INSTALLER_SIGNING_IDENTITY:-}}"
notary_profile="${MEETRON_NOTARY_PROFILE:-${MEETING_COPILOT_NOTARY_PROFILE:-}}"
notary_key="${MEETRON_NOTARY_KEY:-${MEETING_COPILOT_NOTARY_KEY:-}}"
notary_key_id="${MEETRON_NOTARY_KEY_ID:-${MEETING_COPILOT_NOTARY_KEY_ID:-}}"
notary_issuer="${MEETRON_NOTARY_ISSUER:-${MEETING_COPILOT_NOTARY_ISSUER:-}}"
release_build="${MEETRON_RELEASE_BUILD:-0}"
working_dir="$(mktemp -d "${TMPDIR:-/tmp}/meetron-audio-package.XXXXXX")"
trap 'rm -rf "$working_dir"' EXIT

notary_args=()
if [ -n "$notary_profile" ]; then
  if [ -n "$notary_key" ] || [ -n "$notary_key_id" ] || [ -n "$notary_issuer" ]; then
    printf 'Choose either MEETRON_NOTARY_PROFILE or direct App Store Connect key settings.\n' >&2
    exit 1
  fi
  notary_args=(--keychain-profile "$notary_profile")
elif [ -n "$notary_key" ] || [ -n "$notary_key_id" ] || [ -n "$notary_issuer" ]; then
  if [ -z "$notary_key" ] || [ -z "$notary_key_id" ] || [ -z "$notary_issuer" ]; then
    printf 'Direct notarization requires MEETRON_NOTARY_KEY, MEETRON_NOTARY_KEY_ID, and MEETRON_NOTARY_ISSUER.\n' >&2
    exit 1
  fi
  if [ ! -f "$notary_key" ]; then
    printf 'App Store Connect private key not found: %s\n' "$notary_key" >&2
    exit 1
  fi
  notary_args=(--key "$notary_key" --key-id "$notary_key_id" --issuer "$notary_issuer")
fi

if [ "$release_build" != "0" ] && [ "$release_build" != "1" ]; then
  printf 'MEETRON_RELEASE_BUILD must be 0 or 1.\n' >&2
  exit 1
fi
if [ "$release_build" = "1" ] && [ "${#notary_args[@]}" -eq 0 ]; then
  printf 'Release packaging requires Apple notarization credentials.\n' >&2
  exit 1
fi

configured_output_dir="${MEETRON_AUDIO_DIST_DIR:-${MEETING_COPILOT_AUDIO_DIST_DIR:-}}"
if [ -n "$configured_output_dir" ]; then
  output_dir="$configured_output_dir"
elif [ "$release_build" = "1" ] || [ "${#notary_args[@]}" -gt 0 ]; then
  output_dir="$repo_root/dist/release"
else
  output_dir="$repo_root/dist/development"
fi

package_name="MeetronAudio-$version.pkg"
package_path="$output_dir/$package_name"

protect_existing_notarized_package() {
  if [ -f "$package_path" ]; then
    signature_output="$(pkgutil --check-signature "$package_path" 2>&1 || true)"
    if xcrun stapler validate "$package_path" >/dev/null 2>&1 ||
      printf '%s\n' "$signature_output" | grep -F 'Notarization: trusted by the Apple notary service' >/dev/null; then
      printf 'Refusing to overwrite an existing notarized package: %s\n' "$package_path" >&2
      printf 'Use a new version or move the existing release artifact to a separately preserved location.\n' >&2
      exit 1
    fi
  fi
}

# Fail before an expensive build, then check again immediately before copying
# to close the window where another process could place a release artifact.
protect_existing_notarized_package

MEETING_COPILOT_AUDIO_BUILD_DIR="$working_dir/drivers" \
MEETING_COPILOT_AUDIO_SIGNING_IDENTITY="$application_identity" \
MEETING_COPILOT_AUDIO_DEPLOYMENT_TARGET="$deployment_target" \
  "$driver_root/build-driver.sh"
"$repo_root/scripts/build-audio-control.sh"

audioctl="$repo_root/native/audio-control/.build/apple/Products/Release/meetron-audioctl"
staging="$working_dir/root"
package_scripts="$working_dir/scripts"
resources="$working_dir/resources"
mkdir -p \
  "$staging/Library/Audio/Plug-Ins/HAL" \
  "$staging/usr/local/bin" \
  "$staging/usr/local/share/doc/meetron-audio" \
  "$package_scripts" \
  "$resources" \
  "$output_dir"

/usr/bin/ditto "$working_dir/drivers/MeetronMeetingToAI.driver" \
  "$staging/Library/Audio/Plug-Ins/HAL/MeetronMeetingToAI.driver"
/usr/bin/ditto "$working_dir/drivers/MeetronAIToMeeting.driver" \
  "$staging/Library/Audio/Plug-Ins/HAL/MeetronAIToMeeting.driver"
/bin/cp "$audioctl" "$staging/usr/local/bin/meetron-audioctl"
/bin/ln -s meetron-audioctl "$staging/usr/local/bin/meeting-copilot-audioctl"
/bin/cp "$repo_root/LICENSE" "$staging/usr/local/share/doc/meetron-audio/COPYING"
/bin/cp "$repo_root/THIRD_PARTY_NOTICES.md" \
  "$staging/usr/local/share/doc/meetron-audio/THIRD_PARTY_NOTICES.md"
/bin/cp "$driver_root/vendor/apple/LICENSE.txt" \
  "$staging/usr/local/share/doc/meetron-audio/LICENSE-APPLE.txt"

if [ "$application_identity" = "-" ]; then
  codesign --force --sign - --timestamp=none "$staging/usr/local/bin/meetron-audioctl"
else
  codesign --force --sign "$application_identity" --timestamp --options runtime \
    "$staging/usr/local/bin/meetron-audioctl"
fi
codesign --verify --strict --verbose=1 "$staging/usr/local/bin/meetron-audioctl"
/usr/bin/xattr -cr "$staging"

cat > "$package_scripts/postinstall" <<'POSTINSTALL'
#!/bin/sh
set -eu

# Remove only the exact pre-Meetron Phase 1 development bundles.
for legacy_name in MeetingCopilotMeetingToAI MeetingCopilotAIToMeeting; do
  legacy_path="/Library/Audio/Plug-Ins/HAL/$legacy_name.driver"
  if [ -e "$legacy_path" ]; then
    /bin/rm -rf "$legacy_path"
  fi
done

exit 0
POSTINSTALL
/bin/chmod 755 "$package_scripts/postinstall"

/bin/cp "$repo_root/LICENSE" "$resources/LICENSE.txt"
cat > "$resources/welcome.html" <<'WELCOME'
<!doctype html><html lang="ja"><meta charset="utf-8"><body>
<h1>Meetron Audio</h1>
<p>Meetronが会議音声とChatGPT Voiceを接続するための2つの仮想音声デバイスをインストールします。</p>
<p>インストール後にMacを再起動してください。</p>
</body></html>
WELCOME
cat > "$resources/conclusion.html" <<'CONCLUSION'
<!doctype html><html lang="ja"><meta charset="utf-8"><body>
<h1>インストールが完了しました</h1>
<p>Meetron Audioを読み込むため、Macを再起動してください。</p>
</body></html>
CONCLUSION

component_package="$working_dir/MeetronAudioComponent.pkg"
pkgbuild \
  --root "$staging" \
  --scripts "$package_scripts" \
  --ownership recommended \
  --install-location / \
  --identifier io.github.bb8ad8.meetron.audio.pkg \
  --version "$version" \
  "$component_package"

cat > "$working_dir/Distribution.xml" <<EOF
<?xml version="1.0" encoding="utf-8"?>
<installer-gui-script minSpecVersion="2">
  <title>Meetron Audio $version</title>
  <welcome file="welcome.html"/>
  <license file="LICENSE.txt"/>
  <conclusion file="conclusion.html"/>
  <options customize="never" require-scripts="false" hostArchitectures="x86_64,arm64"/>
  <domains enable_anywhere="false" enable_currentUserHome="false" enable_localSystem="true"/>
  <volume-check>
    <allowed-os-versions><os-version min="$deployment_target"/></allowed-os-versions>
  </volume-check>
  <choices-outline><line choice="default"/></choices-outline>
  <choice id="default" visible="false">
    <pkg-ref id="io.github.bb8ad8.meetron.audio.pkg"/>
  </choice>
  <pkg-ref id="io.github.bb8ad8.meetron.audio.pkg" version="$version" onConclusion="RequireRestart">MeetronAudioComponent.pkg</pkg-ref>
</installer-gui-script>
EOF

built_package="$working_dir/$package_name"
product_args=(
  --distribution "$working_dir/Distribution.xml"
  --resources "$resources"
  --package-path "$working_dir"
)
if [ -n "$installer_identity" ]; then
  product_args+=(--sign "$installer_identity" --timestamp)
fi
productbuild "${product_args[@]}" "$built_package"

if [ "${#notary_args[@]}" -gt 0 ]; then
  if [ -z "$installer_identity" ] || [ "$application_identity" = "-" ]; then
    printf 'Notarization requires Developer ID Application and Installer identities.\n' >&2
    exit 1
  fi
  xcrun notarytool submit "$built_package" "${notary_args[@]}" --wait
  xcrun stapler staple "$built_package"
  xcrun stapler validate "$built_package"
  spctl --assess --type install --verbose=2 "$built_package"
fi

pkgutil --check-signature "$built_package" || [ -z "$installer_identity" ]

protect_existing_notarized_package

/bin/cp "$built_package" "$package_path"
(
  cd "$output_dir"
  shasum -a 256 "$package_name" > "$package_name.sha256"
)
printf 'Created %s\n' "$package_path"
printf 'Created %s.sha256\n' "$package_path"
