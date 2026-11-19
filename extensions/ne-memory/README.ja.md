<p align="center"><img src="https://raw.githubusercontent.com/furukawa658/vscode-chat-tools/main/extensions/ne-memory/icon.png" width="128" alt="Ne"></p>

# Ne: 同じ注意を、二度と言わない

「そうじゃなくて」「前も言ったけど」。Copilotに同じ修正指示を何度も出していませんか。
Neはあなたの過去のチャットから繰り返した修正指示を見つけ、ルールの案にします。あなたが承認したものだけが、Copilotのユーザーメモリに登録されます。

## できること

| コマンド | 内容 |
| --- | --- |
| `Ne: 修正指示の検出数を測る` | 直近20件のチャットから、修正指示の件数と割合を表示する。モデルは使わない |
| `Ne: 修正指示を分析してルール登録` | 修正指示からルール案を作り、承認ダイアログで「登録する」を選んだときだけ書き込む |
| `Ne: 登録したルールを取り消す` | 登録履歴から選んで取り消す |

## 使い方

1. まず `Ne: 修正指示の検出数を測る` で、どれくらい言い直しているかを見る。
2. `Ne: 修正指示を分析してルール登録` でルール案を確認し、残したいものだけ承認する。
3. 以後のチャットで、登録したルールがCopilotに渡る。

## 送信と書き込み

- 言語モデルへ送るのは、現在のワークスペースの修正指示の本文(1件400文字まで)だけである。送信前に確認が出る。
- 自動登録はしない。ワークスペースの指示ファイルも書き換えない。
- 書き込み先は `globalStorage/github.copilot-chat/memory-tool/memories/ne-rules.md` である。

## 知っておくこと

- Copilot Chatが公開していない保存形式と、メモリの保存場所(内部構成)に依存する。構成が変わると動かなくなる可能性がある。
- 修正指示の判定語は少数に絞っている。見逃しや誤検出はありうる。検出率は `Ne: 修正指示の検出数を測る` で確認できる。
- 動作確認: VS Code 1.147、Copilot Chat 0.75。

## 設定

| 設定 | 既定値 | 内容 |
| --- | --- | --- |
| `ne.scope` | `currentWorkspace` | 分析対象。既定は現在のワークスペースのみ |

## 関連する拡張機能

- [Tsugi](https://marketplace.visualstudio.com/items?itemName=ShunsukeF.tsugi): 長くなったチャットを新しいチャットへ引き継ぐ
- [Eien](https://marketplace.visualstudio.com/items?itemName=ShunsukeF.eien): 夜間に止まったチャットを再開させる
- 3つまとめて入れる: [Pack](https://marketplace.visualstudio.com/items?itemName=ShunsukeF.vscode-chat-tools-pack)

不具合・要望は [GitHub](https://github.com/furukawa658/vscode-chat-tools/issues) へ。
