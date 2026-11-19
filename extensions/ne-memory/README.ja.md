<p align="center"><img src="https://raw.githubusercontent.com/furukawa658/vscode-chat-tools/main/extensions/ne-memory/icon.png" width="128" alt="Ne"></p>

# Ne: 同じ修正指示を、次のルールへ

「そうじゃなくて」「前も言ったけど」。毎回のチャットで同じやり取りを繰り返すなら、Neが過去のセッションから修正パターンを見つけ、具体的なルール案にする。5秒の確認時間で内容を見直し、編集・取り消し・保存先変更・統合先の選択もできる。

繰り返し打つ指示を、一度確認すれば再利用できる知識へ変える。

## コマンド

| コマンド | 内容 |
| --- | --- |
| `Ne: 修正指示の検出数を測る` | 直近20件のチャットから、修正指示の件数と割合を表示する。モデルは使わない |
| `Ne: 修正指示を分析してルール登録` | 修正パターンからルール案を作り、確認後だけ登録する |
| `Ne: 登録したルールを取り消す` | 登録履歴から選んで取り消す |

## 使い方

1. 最初に件数の測定コマンドを実行し、どれくらい言い直しているかを見る。
2. 分析コマンドを実行する。Neは確認後に例を選択中の言語モデルへ送り、5秒の登録通知を出す。
3. 時間が過ぎたら自動登録する。見直す場合は `Review, edit, and register` を選び、構造化したMarkdownの確認画面を開く。
4. 取り消す場合は `Ignore` を選ぶ。確認画面のCodeLensでは、確定、取り消し、登録範囲の切替、統合先の選択ができる。

## 送信と書き込み

- 修正指示の本文と構造化した応答情報は、確認後だけVS Codeで選択中の言語モデルへ送る。
- Neは繰り返された表面的な指示と根本原因を分け、実行可能なルールを要求する。不正な提案や情報不足の提案は登録しない。
- 既定では現在のワークスペースだけを走査する。`ne.scanAllWorkspaces` を有効にすると、ローカルの他のワークスペースも走査する。
- 全体ルールは `globalStorage/github.copilot-chat/memory-tool/memories/user-preferences.instructions.md` へ書く。
- ワークスペースルールは、最初のワークスペースフォルダーにある `.github/copilot-instructions.md` へ書く。
- `Ignore` と確認画面での取り消しは、Neが登録した対象ルールだけを削除する。その後の無関係な編集は残る。

## 知っておくこと

- Copilot Chat内部のチャット保存形式とメモリの保存場所に依存する。構成が変わると動かなくなる可能性がある。
- 修正指示は、少数の判定語で見つけるため、見逃しや誤検出がありうる。測定コマンドで検出率を確認できる。
- 同じチャット内で繰り返しただけでは提案しない。`ne.minimumSessions` で指定した数の異なるセッションに出た修正だけを対象にする。
- 確認画面で保存範囲を切り替えると、選んでいた統合先を解除する。異なる範囲のルールを誤って混ぜないためである。
- 動作確認: VS Code 1.147、Copilot Chat 0.75。

## 設定

| 設定 | 既定値 | 内容 |
| --- | --- | --- |
| `ne.scanAllWorkspaces` | `false` | ローカルの全ワークスペースを走査する |
| `ne.minimumSessions` | 2 | 繰り返しとみなすために必要な異なるセッション数 |
| `ne.maxSessions` | 100 | 調べる直近セッションファイルの上限 |
| `ne.defaultScope` | `Global` | 最初の登録先。`Global` または `Workspace` |
| `ne.autoRegisterSeconds` | 5 | 自動登録までの待ち時間 |

## 関連する拡張機能

- [Tsugi](https://marketplace.visualstudio.com/items?itemName=ShunsukeF.tsugi): 長くなったチャットを新しいチャットへ引き継ぐ
- [Eien](https://marketplace.visualstudio.com/items?itemName=ShunsukeF.eien): 夜間に止まったチャットを再開させる
- 3つまとめて入れる: [Pack](https://marketplace.visualstudio.com/items?itemName=ShunsukeF.vscode-chat-tools-pack)

不具合・要望は [GitHub](https://github.com/furukawa658/vscode-chat-tools/issues) へ。