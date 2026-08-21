#!/usr/bin/env bash

set -u

repo_root="$(cd "$(dirname "$0")" && pwd)"
"$repo_root/scripts/setup-meetron.sh"
status=$?

show_notice() {
  message="$1"
  if command -v osascript >/dev/null 2>&1; then
    osascript - "$message" <<'APPLESCRIPT' >/dev/null 2>&1 || true
on run arguments
  display dialog (item 1 of arguments) with title "Meetron Setup" buttons {"OK"} default button "OK"
end run
APPLESCRIPT
  fi
}

printf '\n'
case "$status" in
  0)
    printf 'セットアップ確認が完了しました。このウインドウを閉じて構いません。\n'
    show_notice 'ローカルセットアップが完了しました。Chromeに表示された案内に沿って、Meetron Controlsの読み込みとログインを完了してください。'
    ;;
  20)
    printf 'Meetron Audioのインストール待ちです。インストール後にMacを再起動してください。\n'
    ;;
  21)
    printf 'Meetron Audioを読み込むため、Macを再起動してください。\n'
    ;;
  *)
    printf 'セットアップは完了していません。上のメッセージをAIアシスタントへ共有してください。\n' >&2
    show_notice 'セットアップ中に問題が発生しました。ターミナルに表示されたメッセージをAIアシスタントへ共有してください。'
    ;;
esac
printf 'Returnキーを押すと閉じます。\n'
read -r _
exit "$status"
