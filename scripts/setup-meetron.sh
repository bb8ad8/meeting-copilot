#!/usr/bin/env bash

set -eu

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
check_only=0
release_url="${MEETRON_SETUP_RELEASE_URL:-https://github.com/bb8ad8/meeting-copilot/releases/latest}"
receipt_id="${MEETRON_SETUP_RECEIPT_ID:-io.github.bb8ad8.meetron.audio.pkg}"
no_open="${MEETRON_SETUP_NO_OPEN:-0}"

usage() {
  cat <<'EOF'
Usage: ./scripts/setup-meetron.sh [--check-only]

Prepares Meetron's JavaScript dependencies and Chrome Native Messaging Host,
then checks the installed Meetron Audio package and required applications.

When Meetron Audio is not installed, this script finds a downloaded signed
PKG and opens it, or opens GitHub Releases and the Downloads folder.

Options:
  --check-only  Do not install npm packages or register the Native Host.
  -h, --help    Show this help.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --check-only) check_only=1 ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

printf 'Meetron setup\n'
printf '%s\n' '============='

show_dialog() {
  message="$1"
  if [ "$no_open" = "1" ] || ! command -v osascript >/dev/null 2>&1; then
    return 1
  fi
  osascript - "$message" <<'APPLESCRIPT' 2>/dev/null
on run arguments
  display dialog (item 1 of arguments) with title "Meetron Setup" buttons {"OK"} default button "OK"
end run
APPLESCRIPT
}

choose_pkg_action() {
  package_name="$1"
  if [ "$no_open" = "1" ] || ! command -v osascript >/dev/null 2>&1; then
    printf 'インストーラを開くには、Finderで次のPKGをダブルクリックしてください。\n%s\n' "$package_name"
    return 1
  fi
  osascript - "$package_name" <<'APPLESCRIPT' 2>/dev/null
on run arguments
  set packageName to item 1 of arguments
  set prompt to "署名・公証済みの " & packageName & " が見つかりました。\n\n開発元: Yuki Inaba\n\nインストール後にMacの再起動が必要です。"
  set answer to display dialog prompt with title "Meetron Audioをインストール" buttons {"後で", "Finderで表示", "インストーラを開く"} default button "インストーラを開く" cancel button "後で"
  return button returned of answer
end run
APPLESCRIPT
}

choose_download_action() {
  if [ "$no_open" = "1" ] || ! command -v osascript >/dev/null 2>&1; then
    return 1
  fi
  osascript <<'APPLESCRIPT' 2>/dev/null
set prompt to "Meetron Audioがまだインストールされていません。\n\nGitHub ReleasesからMeetronAudio-*.pkgをダウンロードしてください。ダウンロード後、もう一度「Meetron Setup.command」を開きます。"
set answer to display dialog prompt with title "最初にMeetron Audioをインストールします" buttons {"後で", "ダウンロードページを開く"} default button "ダウンロードページを開く" cancel button "後で"
return button returned of answer
APPLESCRIPT
}

find_audio_pkg() {
  if [ -n "${MEETRON_SETUP_PKG_PATH:-}" ]; then
    if [ -f "$MEETRON_SETUP_PKG_PATH" ]; then
      printf '%s\n' "$MEETRON_SETUP_PKG_PATH"
    fi
    return 0
  fi

  for candidate in \
    "$repo_root"/MeetronAudio-*.pkg \
    "$repo_root"/installer/MeetronAudio-*.pkg \
    "$repo_root"/../installer/MeetronAudio-*.pkg \
    "$repo_root"/dist/release/MeetronAudio-*.pkg \
    "$repo_root"/dist/MeetronAudio-*.pkg \
    "$HOME"/Downloads/MeetronAudio-*.pkg \
    "$HOME"/Desktop/MeetronAudio-*.pkg; do
    if [ -f "$candidate" ]; then
      printf '%s\n' "$candidate"
      return
    fi
  done
  return 0
}

verify_audio_pkg() {
  package_path="$1"
  signature_output="$(pkgutil --check-signature "$package_path" 2>&1)" || {
    printf '[ERROR] PKGのApple署名を確認できませんでした。\n%s\n' "$signature_output" >&2
    return 1
  }
  if ! printf '%s\n' "$signature_output" | grep -F 'Developer ID Installer: Yuki Inaba (SHDVCBHNJW)' >/dev/null; then
    printf '[ERROR] PKGの開発元がYuki Inabaではありません。開かずに削除してください。\n' >&2
    return 1
  fi
  if ! printf '%s\n' "$signature_output" | grep -F 'Notarization: trusted by the Apple notary service' >/dev/null; then
    printf '[ERROR] PKGのApple公証を確認できません。開かずに削除してください。\n' >&2
    return 1
  fi
  if ! spctl --assess --type install "$package_path" >/dev/null 2>&1; then
    printf '[ERROR] macOS GatekeeperがPKGを承認しませんでした。開かずに削除してください。\n' >&2
    return 1
  fi

  checksum_path="$package_path.sha256"
  if [ -f "$checksum_path" ]; then
    if ! (cd "$(dirname "$package_path")" && shasum -a 256 -c "$(basename "$checksum_path")") >/dev/null 2>&1; then
      printf '[ERROR] PKGのSHA-256チェックサムが一致しません。開かずに削除してください。\n' >&2
      return 1
    fi
    printf '[OK] PKGの署名、公証、チェックサムを確認しました。\n'
  else
    printf '[OK] PKGの署名と公証を確認しました。\n'
    printf '[INFO] チェックサムファイルがないため、Appleの署名と公証を使って検証しました。\n'
  fi
}

guide_audio_install() {
  package_path="$(find_audio_pkg)"
  if [ -n "$package_path" ]; then
    verify_audio_pkg "$package_path" || return 1
    printf '[NEXT] Meetron Audioをインストールし、Macを再起動してください。\n'
    printf '       %s\n' "$package_path"
    [ "$check_only" -eq 1 ] && return 20
    action="$(choose_pkg_action "$(basename "$package_path")" || true)"
    case "$action" in
      'インストーラを開く')
        open -R "$package_path"
        open "$package_path"
        ;;
      'Finderで表示')
        open -R "$package_path"
        ;;
      *)
        [ "$no_open" = "1" ] || true
        ;;
    esac
    return 20
  fi

  printf '[NEXT] Meetron Audio PKGをGitHub Releasesからダウンロードしてください。\n'
  printf '       %s\n' "$release_url"
  [ "$check_only" -eq 1 ] && return 20
  action="$(choose_download_action || true)"
  if [ "$action" = 'ダウンロードページを開く' ]; then
    open "$release_url"
    open "$HOME/Downloads"
  fi
  return 20
}

if [ "$(uname -s 2>/dev/null || true)" != "Darwin" ]; then
  printf '[ERROR] Meetron supports macOS only.\n' >&2
  exit 1
fi

macos_version="$(sw_vers -productVersion 2>/dev/null || printf unknown)"
macos_major="${macos_version%%.*}"
if ! printf '%s' "$macos_major" | grep -Eq '^[0-9]+$' || [ "$macos_major" -lt 13 ]; then
  printf '[ERROR] macOS 13 or later is required (found %s).\n' "$macos_version" >&2
  exit 1
fi

if pkgutil --pkg-info "$receipt_id" >/dev/null 2>&1; then
  audio_version="$(pkgutil --pkg-info "$receipt_id" 2>/dev/null | sed -n 's/^version: //p')"
  printf '[OK] Meetron Audio PKG is installed%s.\n' "${audio_version:+ ($audio_version)}"
else
  if guide_audio_install; then
    exit 0
  else
    status=$?
    exit "$status"
  fi
fi

node_binary="$(command -v node || true)"
npm_binary="$(command -v npm || true)"
if [ -z "$node_binary" ] || [ -z "$npm_binary" ]; then
  printf '[ERROR] Node.js 22 or 24 LTS is required. Ask your AI assistant to install it, then run this again.\n' >&2
  exit 1
fi
node_version="$($node_binary --version)"
node_major="$(printf '%s' "$node_version" | sed 's/^v//' | cut -d. -f1)"
if [ "$node_major" -lt 22 ]; then
  printf '[ERROR] Node.js 22 or later is required (found %s).\n' "$node_version" >&2
  exit 1
fi

if [ ! -d '/Applications/Google Chrome.app' ] && [ ! -d "$HOME/Applications/Google Chrome.app" ]; then
  printf '[ERROR] Google Chrome was not found. Install the official Google Chrome build first.\n' >&2
  exit 1
fi

if [ "$check_only" -eq 0 ]; then
  printf '\nInstalling local dependencies...\n'
  (cd "$repo_root" && npm ci)
  "$repo_root/scripts/install-control-ui.sh"
fi

printf '\nChecking the completed setup...\n'
if ! "$repo_root/scripts/check-env.sh"; then
  printf '\nMeetron Audio may still be waiting for a macOS restart. Restart the Mac, then run Meetron Setup.command again.\n' >&2
  show_dialog 'Meetron Audioを利用するため、Macを再起動してください。再起動後、もう一度「Meetron Setup.command」を開きます。' || true
  exit 21
fi

extension_dir="$repo_root/extension"
printf '\nNext manual steps\n'
printf '%s\n' '-----------------'
printf '1. In regular Chrome, open chrome://extensions and enable Developer mode.\n'
printf '2. Choose Load unpacked and select:\n   %s\n' "$extension_dir"
printf '3. Run the dedicated Chrome setup and load the same extension there.\n'
printf '4. Sign in to Google and ChatGPT in the dedicated Chrome window.\n'
printf '5. Open Meetron Controls in regular Chrome and finish its setup checklist.\n'

if [ "$check_only" -eq 0 ]; then
  open -a 'Google Chrome' 'chrome://extensions' >/dev/null 2>&1 || true
  "$repo_root/scripts/open-control-ui-setup.sh"
fi

printf '\nMeetron local setup completed. Chrome sign-in and extension loading remain manual.\n'
