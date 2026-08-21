# Meetron

[![CI](https://github.com/bb8ad8/meetron/actions/workflows/ci.yml/badge.svg)](https://github.com/bb8ad8/meetron/actions/workflows/ci.yml)
[![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue.svg)](LICENSE)
[![Platform: macOS](https://img.shields.io/badge/platform-macOS-lightgrey.svg)](#動作環境)

ChatGPT Web Voiceを、Google Meetへ`GPT-Live`という別参加者として接続するmacOS向けの実験的ベータ版です。OpenAI APIは使わず、Meetron専用の仮想音声デバイスで会議音声とChatGPT音声を双方向に橋渡しします。

このプロジェクトは非公式であり、OpenAI、Apple、Googleの提供・承認を受けた製品ではありません。ChatGPTとGoogle Meetの画面変更により、自動化が動かなくなる可能性があります。

## 非エンジニア向け最短手順

初回導入は、ローカルのファイルとターミナルを操作できるAIコーディング支援へ任せる方法を推奨します。ターミナルのコマンドを自分で入力する必要はありません。

1. AIアシスタントへ、下の依頼文をコピーして渡す
2. AIがこのリポジトリをcloneしたら、Finderでclone先を開く
3. `Meetron Setup.command`をダブルクリックする
4. 画面に従ってMeetron Audioをインストールする
5. Macを再起動し、同じ`Meetron Setup.command`をもう一度開く
6. 案内されたChrome拡張の読み込みとGoogle・ChatGPTへのログインだけを本人が行う

```text
https://github.com/bb8ad8/meetron のMeetronをこのMacへcloneし、READMEの「AIアシスタントによるセットアップ」に従って、利用できる状態までセットアップしてください。安全に自動化できる確認とコマンドは進め、管理者認証、再起動、Chrome拡張の読み込み、Google・ChatGPTへのログインが必要になったら私へ案内してください。パスワードや認証コードをAIチャットへ入力するよう求めないでください。
```

詳しいAI向け依頼文と役割分担は[AIアシスタントによるセットアップ](#aiアシスタントによるセットアップ推奨)にあります。

## 動作環境

- macOS 13以降（実機はmacOS 26 / Apple Siliconで確認）
- Google Chrome公式ビルド
- Node.js 22または24 LTS
- ChatGPT Web Voiceを利用できるアカウント
- Google Meetへ参加できるGoogleアカウント

Intel MacとmacOS 13〜15では未検証のベストエフォート対応です。音声PKGはApple Silicon / IntelのUniversal Binaryとしてビルドします。Chrome Web Store版はなく、GitHubから取得した拡張をデベロッパーモードで読み込みます。

## Meetron Setup.commandが行うこと

GitHubからcloneした後は、Finderでリポジトリを開き、`Meetron Setup.command`をダブルクリックします。セットアップは現在の状態を判定し、次に必要な操作だけを表示します。

- Meetron Audioが未導入: ダウンロード済みの正規PKGを探し、Appleの署名・公証を確認してFinderとインストーラを開く
- PKGがまだない: GitHub ReleasesとFinderのダウンロードフォルダを開く
- PKG導入直後: Macの再起動を案内する
- 再起動済み: Node.js依存関係、Native Messaging Host、Chrome拡張の設定へ進む

PKGは開発元が`Yuki Inaba`であることを自動確認します。パスワードやTouch IDはMeetronやAIチャットへ入力せず、macOSのインストーラ画面へ直接入力してください。途中で画面を閉じても、同じ`Meetron Setup.command`をもう一度開けば続きから判定します。

## 現在のスコープ

- Google Meetへの統合参加を自動化。Zoom Web Clientは低レベル起動のみ試験的に対応
- 会議URL、初回マイク案内、表示名、音声デバイス、参加前ミュートを自動設定
- ChatGPT Projectでの新規チャット作成とVoice開始を自動設定
- 拡張の`開始`と統合起動では参加リクエストまで自動化。低レベル起動では`--join`指定時のみ自動化
- 発話抑制はProject instructionsと会議側ミュートで行う
- 普段使うChromeのMeet上に表示する小型UIから、GPT参加者の接続確認、マイク、Voice、セッション終了、環境診断を遠隔操作

旧公開版から更新するユーザーに限り、BlackHole 2ch / 16chを移行期間中の互換バックエンドとして自動検出します。新規セットアップではBlackHoleを導入しません。Meetronは既存のBlackHoleを削除・変更しないため、ほかのアプリで引き続き利用できます。

## 音声構成

```text
会議参加者の音声
  -> 専用ChromeのGPT参加者Meet
  -> Meet speaker: Meetron: Meeting to AI
  -> macOS system input: Meetron: Meeting to AI
  -> ChatGPT Voice input

ChatGPT Voice output
  -> ChatGPT VoiceタブだけをMeetron: AI to Meetingへ出力
  -> GPT参加者Meet mic: Meetron: AI to Meeting
  -> Google Meet
  -> 通常ChromeのMeet
  -> 現在の物理出力（ヘッドホン／スピーカー）
```

`Meeting to AI`と`AI to Meeting`を別々のステレオデバイスにすることで、ChatGPTの発話が自分の入力へ戻るループを防ぎます。ChatGPT Voiceタブ以外の音声とmacOSのシステム出力は変更しません。デバイスの識別には表示名ではなく安定したCore Audio UIDを使います。

## AIアシスタントによるセットアップ（推奨）

Meetronは、音声ドライバ、macOSの音声設定、2つのChrome環境、GoogleとChatGPTのログインを扱うPoCです。非エンジニアがREADMEのコマンドを順番に実行するのではなく、Codexなどローカル操作に対応したAIアシスタントへ導入を任せ、本人確認が必要な場面だけ利用者が操作することを想定しています。

### 新しく利用する場合の依頼文

ローカル操作に対応したAIアシスタントを開き、次の依頼文を渡してください。すでにリポジトリを取得している場合は、そのフォルダをAIに開かせてから依頼します。

```text
https://github.com/bb8ad8/meetron のMeetronを、このMacで利用できる状態までセットアップしてください。

README.mdを最初から最後まで読み、最初に環境診断と短い作業計画を示してください。これは非エンジニア向けのセットアップです。質問だけで止まらず、安全に実行できる確認、ダウンロード、コマンド、設定、ローカルテストはあなたが進めてください。

次の順序でセットアップしてください。
1. macOS 13以降、Apple SiliconまたはIntel、Google Chrome、Node.js 22または24 LTSを確認する
2. リポジトリ直下の「Meetron Setup.command」を開く。必要なら同等の./scripts/setup-meetron.shを実行する
3. Meetron Audioが未導入なら、セットアップが見つけたPKGの署名、公証、チェックサムを確認する。PKGがなければ、セットアップが開くGitHub Releasesから最新のMeetronAudio-*.pkgとSHA-256ファイルを取得して、もう一度セットアップを実行する
4. PKGの開発元が「Yuki Inaba」であることを説明して私にインストール操作を依頼し、インストール後にMacを再起動する
5. 普段使うChromeとMeetron専用Chromeで、extensionフォルダを「パッケージ化されていない拡張機能」として読み込む場所を正確に示す
6. 専用ChromeでGoogleとChatGPTへログインし、ChatGPTに「Meetron」Projectを作成して、このREADMEのProject instructionsを設定するよう案内する
7. ./scripts/check-env.shとローカルテストを実行し、最後に機密情報を含まないGoogle Meetで双方向音声を確認する

音声にはMeetron Audioを使用してください。BlackHole、Homebrew、SwitchAudioSourceを新規導入しないでください。ソースからの音声ドライバービルドは、配布PKGが利用できない理由が確認できた場合だけ提案してください。

次の操作が必要になったら勝手に進めず、理由と操作内容を短く説明して私に依頼してください。
- macOS管理者パスワードまたはTouch ID
- macOSの再起動
- Chromeでのデベロッパーモード有効化と拡張機能の読み込み
- GoogleまたはChatGPTへのログインと2段階認証
- ChatGPT Projectの作成とInstructions設定
- テスト会議への参加、参加許可、音声確認

パスワードや認証コードをAIチャットへ入力するよう求めないでください。各工程の後に状態を再確認し、失敗した場合はログを調べてから次へ進んでください。
```

### 公開版Meeting Copilotから更新する場合の依頼文

すでに公開版を利用している場合は、リポジトリを開いて次の依頼文を渡してください。

```text
このMacで利用中のMeeting Copilotを、既存設定とログイン状態を保持したままMeetronへ更新してください。

README.mdを最初から最後まで読み、現在のGit状態、macOS、チップ、Node.js、Chrome、音声デバイス、Meetron Audio PKGの有無を先に診断してください。作業前に短い更新計画を示し、安全に自動化できる確認、コマンド、設定、ローカルテストはあなたが進めてください。

次の条件を守って更新してください。
- 私のローカル変更があれば上書きせず、内容を説明してから安全な対処を相談する
- .meeting-copilot.env、.meeting-copilot-runtime、専用Chromeプロファイル、拡張機能ID、Native Messaging Host IDを削除・改名しない
- GoogleとChatGPTのログイン状態をできる限り保持する
- Git更新はgit pull --ff-onlyを基本にし、リセット、強制チェックアウト、履歴の書き換えをしない
- GitHub Releasesから最新の署名・公証済みMeetronAudio-*.pkgを取得し、SHA-256、Appleの署名、公証結果を確認する
- PKGの表示上の開発元が「Yuki Inaba」であることを説明し、管理者認証と再起動は私に依頼する
- 再起動後に「Meetron Setup.command」または./scripts/setup-meetron.shを実行する
- ChromeのMeetron Controlsを再読み込みし、必要な場合だけ同じextensionフォルダを読み込み直す
- ./scripts/check-env.shとローカルテストの後、機密情報を含まないGoogle Meetで双方向音声を確認する

既存のBlackHoleはMeetron以外で使っている可能性があるため、アンインストール、更新、設定変更をしないでください。新しい音声経路にはMeetron Audioを優先し、移行中に問題が起きた場合だけ従来経路を一時的なフォールバックとして使用してください。

次の操作が必要になったら勝手に進めず、理由と操作内容を短く説明して私に依頼してください。
- macOS管理者パスワードまたはTouch ID
- macOSの再起動
- Chromeでのデベロッパーモード有効化、拡張機能の読み込み・再読み込み
- GoogleまたはChatGPTへの再ログインと2段階認証
- テスト会議への参加、参加許可、音声確認

パスワードや認証コードをAIチャットへ入力するよう求めないでください。各工程の後に状態を再確認し、失敗した場合はログを調べてから次へ進んでください。
```

### AIと利用者の役割分担

| 工程 | AIが行うこと | 利用者が行うこと |
| --- | --- | --- |
| 取得・診断 | リポジトリの取得場所を特定または相談して取得し、macOS、Chrome、Node.js、音声デバイスを診断 | 保存場所と、AIへ許可する操作範囲を確認 |
| 依存ソフト | PKGの署名とチェックサムを検証し、Node.jsパッケージやローカル連携を設定 | 管理者パスワードやTouch IDはmacOS画面へ直接入力 |
| 再起動 | 再起動前の作業を完了し、再開後に状態を再診断 | Macを再起動し、同じAIへ完了を伝える |
| Chrome拡張 | Native Messaging Hostを登録し、選択する正確な`extension`パスと画面を提示 | 普段使うChromeと専用Chromeでデベロッパーモードを有効化し、拡張を手動で読み込む |
| アカウント | 必要なGoogle、ChatGPT、Project画面を開き、完了後の状態を確認 | パスワードと2段階認証を各サービス画面へ直接入力し、Project Instructionsを確認 |
| 動作確認 | ローカルテスト、接続診断、ログ調査を実行 | テスト会議への参加・許可、参加者への通知、別端末での音声確認を実施 |

パスワードや認証コードをAIへ共有する必要はありません。管理者パスワードの入力待ちになった場合は、利用者がターミナルまたはmacOSの確認画面へ直接入力し、処理が終わったことだけをAIへ伝えます。

### 推奨する進め方

1. AIが環境診断とインストール内容の事前確認を行う
2. 利用者がライセンスを確認し、必要な管理者認証を行う
3. 専用音声ドライバ導入後、利用者がmacOSを再起動する
4. 同じAIとの会話を開き、`再起動しました。続きから確認して`と伝える
5. AIの案内に沿って、利用者がChrome拡張、Google・ChatGPTログインを設定する
6. AIが診断とローカルテストを実行する
7. 利用者がテスト会議で最終確認する

拡張を読み込んだ後は、不足している設定をポップアップのステップ形式UIでも確認できます。

### ChatGPT Project instructions

ChatGPT Webで`Meetron` Projectを作り、次の内容をProject instructionsへ設定します。

```text
あなたは「GPT-Live」という名前で会議に参加する助言者です。

会議中の発言を聞き、現在の議題、合意事項、未決事項、前提、懸念、次の行動を内部で追跡してください。

通常は完全に沈黙してください。相づち、挨拶、確認、要約、笑い、フィラー、聞き返しを含め、自発的な音声を一切出さないでください。

「ChatGPT、どう思う？」「GPT、どう思う？」「GPT-Live、どう思う？」「GPT、応答して」「GPT-Live、応答して」のように、名前を呼ばれ、同じ発言内で意見または回答を明示的に求められた場合だけ発話してください。誰に向けた発言か曖昧な場合は沈黙してください。

発話するときは30秒以内で、現在の論点、見落とされていそうなリスクまたは前提、次に取るべき具体的な提案の順に簡潔に答えてください。不確かなことを断定せず、回答後は再び完全に沈黙してください。
```

Project instructionsだけでは発話抑制を保証できません。会議側のGPT参加者マイクを外側の安全装置として使用し、意図しない発話時は直ちにミュートしてください。

## 手動セットアップ・開発者向け

以下は、AIアシスタントが内部で実行する主なコマンドと、手動で問題を切り分ける場合の参考手順です。通常の初回導入では、利用者がすべてを自分で実行する必要はありません。

一般利用では、最初にリポジトリ直下の`Meetron Setup.command`をダブルクリックします。未導入なら、セットアップが[GitHub Releases](https://github.com/bb8ad8/meetron/releases)とFinderを開き、ダウンロード済みの`MeetronAudio-*.pkg`を検証してインストーラを開きます。管理者認証後にMacを再起動し、同じファイルをもう一度開いてください。PKG利用時はXcode、Swift、Homebrewは不要です。

AIアシスタントまたはターミナルから同じ処理を行う場合は次を実行します。

```bash
./scripts/setup-meetron.sh
```

このセットアップはNode.js、Chrome、Meetron Audioを確認し、JavaScript依存関係とNative Messaging Hostを準備して、Chrome拡張を読み込む画面を開きます。Chromeのデベロッパーモード、拡張フォルダの選択、Google・ChatGPTへのログインは利用者が行います。

ソースから音声部分をビルドする開発者は、Xcode Command Line Toolsを用意して次を実行します。

```bash
./scripts/check-env.sh
./scripts/install-audio-deps.sh --dry-run
./scripts/install-audio-deps.sh
```

ドライバの導入では管理者認証が必要です。導入後にmacOSからログアウトするか再起動し、`./scripts/check-env.sh`で2つのデバイスを確認します。ローカル開発だけでCore Audioを即時再起動する場合は`--restart-audio`を使えます。

### MeetコントロールUI

Google Meet上へ常駐する開発版Chrome拡張とNative Messaging Hostを設定します。

```bash
npm install
./scripts/install-control-ui.sh
```

普段使うChromeでデベロッパーモードを有効にし、`extension`ディレクトリを「パッケージ化されていない拡張機能」として読み込みます。初期セットアップから、MeetとChatGPTで共用する専用Chromeを開き、同じ拡張をそちらにも一度読み込みます。Chrome公式ビルドでは開発版拡張をコマンドだけで読み込めないため、このディレクトリ選択だけは手動です。

普段使うChromeで拡張を開くと、音声デバイス、ChatGPT Project、専用Chromeを順に確認する初期セットアップが表示されます。完了後はMeet URLを入力して`開始`を押すだけで、音声経路の設定、ChatGPT Voiceの起動、GPT参加者のMeet参加、マイク解除までをバックグラウンドで実行します。通常ChromeのMeet上に出るパネルは専用ChromeのGPT参加者だけを操作し、ユーザー本人のMeetマイクには触れません。

```bash
./scripts/open-gpt-participant.sh "https://meet.google.com/xxx-yyyy-zzz"
```

Google Meetのマイク権限、初回案内、表示名、専用音声デバイス、参加前ミュートを自動設定する場合:

```bash
npm install
./scripts/open-gpt-participant.sh --auto-prepare --restart-profile \
  "https://meet.google.com/xxx-yyyy-zzz"
```

自動設定は専用Chromeプロファイルだけを再起動し、`127.0.0.1`に限定したChrome DevTools接続を一時的に使います。この専用Chromeではメディア権限ダイアログを自動承認します。通常のChromeプロファイルには接続しません。`--join`を追加すると、Meetの検証準備を待ってから参加リクエストも送信します。

ChatGPTの`Meetron` Projectで毎回新しいチャットを作成し、Voiceを開始する場合:

```bash
./scripts/open-chatgpt-live.sh --restart-profile
```

初回だけ、Meetと共用する専用ChromeでChatGPTへログインし、同じコマンドを再実行します。Project URLはローカル専用の`.meeting-copilot.env`へ保存し、リポジトリ配布には含めません。ChatGPT Webの入力はシステム既定の`Meetron: Meeting to AI`を使い、専用Chrome内のVoice出力だけを`Meetron: AI to Meeting`へ固定します。macOSのシステム出力は変更しません。

ChatGPT Voiceを開始し、Meetの参加リクエストまでまとめて実行する場合:

```bash
./scripts/start-meetron.sh \
  "https://meet.google.com/xxx-yyyy-zzz"
```

統合起動では、同じ専用Chromeの別タブでChatGPT VoiceとMeetを開き、入室後に会議マイクも自動解除します。Voice再起動はChatGPTタブだけを作り直すため、Meet参加状態を維持します。低レベルの`open-gpt-participant.sh --join`だけを実行した場合はミュートのままです。`--join`を使う場合は専用ChromeでGoogleへ一度ログインしてください。

参加ボタン表示後の固定待機は既定で2秒です。必要な場合は`MEETING_COPILOT_JOIN_DELAY`で調整できます。MeetのUIからマイクボタンを検出できない場合は、標準ショートカットへ自動的にフォールバックします。カメラ状態を安全に判定できないUIでは参加ボタンを自動で押さず、専用Chromeを前面に残すので、カメラをオフにして手動参加してください。

会議中にGPT参加者のマイクをローカルから制御する場合:

```bash
./scripts/set-meet-mic.sh mute
./scripts/set-meet-mic.sh unmute
./scripts/set-meet-mic.sh toggle
```

常駐パネルの`終了・復元`は、GPT参加者のミュート、ChatGPT Voice停止、Meet退出、専用Meetタブの終了、起動前に保存したmacOS入出力への復元をまとめて実行します。音声設定だけを復元する場合は次のコマンドを使います。

```bash
./scripts/restore-audio.sh
```

2026年7月以降のChatGPTデスクトップアプリにもVoiceがありますが、クラウドProjectを外部から選択してVoiceを開始する公開APIはありません。このPoCでは、自動化可能で今回の実機テストが通ったChatGPT Web Voiceを利用します。

ChatGPT側にはREADMEのProject instructionsを設定し、最初は機密情報を含まないテスト会議と別端末で双方向音声を確認してください。

## 公開版Meeting Copilotからの更新

旧公開版を利用中の場合も、ローカル設定や専用Chromeを削除せず、そのまま更新します。

1. ローカル変更がないことを確認して最新版を取得する
2. GitHub Releasesの`MeetronAudio-*.pkg`を検証してインストールする
3. Macを再起動する
4. `Meetron Setup.command`を実行する
5. `chrome://extensions`でMeetron Controlsを再読み込みする
6. `./scripts/check-env.sh`で`Meetron Audio`が選択されていることを確認する
7. 機密情報を含まないテスト会議で確認する

`.meeting-copilot.env`、`.meeting-copilot-runtime`、`~/Library/Application Support/MeetingCopilot`、`MEETING_COPILOT_*`環境変数、Native Messaging Host IDは既存ユーザーとの互換性のため当面維持します。これらは内部識別子であり、画面上の製品名はMeetronです。

BlackHoleを導入済みでも削除する必要はありません。MeetronはBlackHoleを自動削除・更新せず、音声設定も変更しません。移行リリースではMeetron Audioが利用できない場合に限って旧経路を互換フォールバックとして検出します。新規ユーザーがBlackHoleを導入する必要はありません。

## アンインストール

専用Chromeを終了してから、Native Messaging Host登録を削除します。

```bash
./scripts/uninstall.sh
```

専用Chromeプロファイル、ローカル設定、実行ログも削除する場合:

```bash
./scripts/uninstall.sh --remove-data --yes
```

システムへ導入した2つの仮想音声デバイス、音声制御CLI、PKGレシートも削除する場合は、`--remove-audio-driver`を追加します。管理者認証後、ログアウトまたは再起動が必要です。

保存していたmacOS音声設定を復元できない場合、アンインストールは中止され、復旧データは削除されません。元の音声デバイスを再接続してから再実行してください。最後に、普段使うChromeの`chrome://extensions`からMeetron Controlsを削除します。`--remove-data`を使わない場合は、専用Chromeからも同じ拡張を削除してください。

## 開発用チェック

JavaScript、シェル、Chrome拡張、自動化の標準テストは次で実行します。このテストにはSwiftやXcode Command Line Toolsは不要です。

```bash
npm test
```

音声ドライバのソースを変更した開発者は、Xcode Command Line ToolsがあるMacでCリングバッファを追加検証します。

```bash
npm run test:native
```

配布PKGの生成とUniversal Binary、macOS 13 deployment target、チェックサムの検証はリリース作業で実行します。通常の`package:audio`は開発用PKGを`dist/development/`へ生成し、公証済みの公開成果物とは分離します。

```bash
npm run package:audio
npm run test:package
```

公開用PKGはDeveloper IDとApple公証の設定後、`npm run package:audio:release`で`dist/release/`へ生成します。この処理は公証設定がなければ停止し、既存の公証済みPKGを上書きしません。

PKGをインストールして利用するだけのユーザーは、これらの開発者テストを実行する必要はありません。`./scripts/setup-meetron.sh --check-only`と`./scripts/check-env.sh`を使ってください。

不具合報告では、macOSとChromeのバージョン、再現手順、`.meeting-copilot-runtime/meeting-launch.log`からアカウント情報や会議URLを除いた内容を[Issue](https://github.com/bb8ad8/meetron/issues)へ添えてください。修正提案は[CONTRIBUTING.md](CONTRIBUTING.md)に従ってください。セキュリティ上の問題は公開Issueへ書かず、[SECURITY.md](SECURITY.md)の連絡方法を利用してください。

## 配布上の注意

Meetronは[GNU General Public License v3.0](LICENSE)で提供します。仮想音声ドライバはAppleのAudio Server Plug-in公式サンプルを土台にしており、由来と上流ライセンスは[第三者通知](THIRD_PARTY_NOTICES.md)へ記録しています。Playwrightなど外部依存のライセンスは各パッケージに従います。

本ソフトウェアは実験的な自動化ツールであり、会議への参加、録音、要約、判断の正確性や継続動作を保証しません。本番会議へ導入する前に、機密情報を含まない会議で確認してください。

会議音声をChatGPTへ送る前に、所属組織の規定と参加者への通知・同意要件を確認してください。

データの扱いは[PRIVACY.md](PRIVACY.md)、脆弱性の報告は[SECURITY.md](SECURITY.md)、開発参加は[CONTRIBUTING.md](CONTRIBUTING.md)を参照してください。
