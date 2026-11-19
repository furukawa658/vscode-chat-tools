<p align="center"><img src="https://raw.githubusercontent.com/furukawa658/vscode-chat-tools/main/extensions/eien/icon.png" width="128" alt="Eien"></p>

# Eien: Copilotへ任せた作業を、途中で終わらせない

夜に長い作業を任せたのに、朝になったら途中で止まっていた。Eienは処理中のまま更新が止まったチャットを検出し、継続指示を送る。介入ごとに作業ツリーをGit参照へ残し、朝には開始から停止までの記録を1つのレポートで確認できる。

完了済みの会話には介入せず、作業ブランチや通常のGitインデックスも変更しない。

## できること

| 機能 | 内容 |
| --- | --- |
| 止まったチャットの再開 | 更新が一定時間(既定120秒)止まり、最後のリクエストが処理中のままのときだけ継続指示を送る。完了済みの応答には送らない |
| 質問で止まらない | 質問を `eien-questions.md` へ書いて、他の作業を続けるよう継続指示で求める |
| 巻き戻せる記録 | 開始時をチェックポイント#0にし、介入のたびに `refs/eien/checkpoint` へ作業ツリーを記録する |
| 承認ボタンの任意操作 | 設定を有効にした場合だけOSのアクセシビリティAPIで既知の承認ボタンを押す。見つからない場合や権限がない場合は継続指示へ戻る |
| 上限で自動停止 | 経過時間(既定8時間)と介入回数(既定20回)の上限で止まる |
| 朝の報告 | 開始・介入・チェックポイント・停止の記録を1つのレポートで開ける |

## 使い方

1. 作業を任せたら、コマンドパレットで `Eien: Start Overnight Monitoring` を実行する。
2. 朝に `Eien: Open Morning Report` で記録を確認する。
3. 不要になったら `Eien: Stop Overnight Monitoring` を実行する。

## 安全のために

- 作業ブランチと通常のインデックスには触れず、一時インデックスと専用の `refs/eien/checkpoint` 履歴だけを使う。
- `.git/index.lock` がある間はチェックポイントを作らない。開始時の基準点から、実行前の状態へ戻せる。
- 承認ボタンの操作は既定で無効。OSのアクセシビリティ操作を許容する場合だけ `eien.autoClickApprovals` を有効にする。
- GPG署名を無効にした `commit-tree` を使い、署名確認やGitフックで停止しないようにする。
- チェックポイントには未追跡ファイルも入る。認証情報を作業ツリーに置かないこと。

## 知っておくこと

- Copilot Chatが公開していない保存形式を読む。読めない場合は開始せず、実行中なら停止する。
- 動作確認: VS Code 1.147、Copilot Chat 0.75。

## 設定

| 設定 | 既定値 | 内容 |
| --- | --- | --- |
| `eien.idleSeconds` | 120 | 更新が止まったとみなす秒数 |
| `eien.maxHours` | 8 | 最大稼働時間 |
| `eien.maxInterventions` | 20 | 最大介入回数 |
| `eien.autoClickApprovals` | `false` | 既知の承認ボタンをOSのアクセシビリティAPIで押し、押せない場合は継続指示へ戻る |

## 承認ボタン操作の準備

| OS | 必要な準備 |
| --- | --- |
| 共通 | VS Codeの `editor.accessibilitySupport` を `on` にする |
| Windows | 追加設定は不要。PowerShell UI Automationを使う |
| macOS | システム設定のプライバシーとセキュリティから、Visual Studio Codeのアクセシビリティを許可する |
| Linux | `python3-pyatspi` と `gir1.2-atspi-2.0` を入れる。Waylandでアクセスが止まる場合は `code --ozone-platform=x11` でVS Codeを起動する |

## 関連する拡張機能

- [Tsugi](https://marketplace.visualstudio.com/items?itemName=ShunsukeF.tsugi): 長くなったチャットを新しいチャットへ引き継ぐ
- [Ne](https://marketplace.visualstudio.com/items?itemName=ShunsukeF.ne-memory): 繰り返した修正指示をルール化する
- 3つまとめて入れる: [Pack](https://marketplace.visualstudio.com/items?itemName=ShunsukeF.vscode-chat-tools-pack)

不具合・要望は [GitHub](https://github.com/furukawa658/vscode-chat-tools/issues) へ。