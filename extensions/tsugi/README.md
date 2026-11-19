<p align="center"><img src="https://raw.githubusercontent.com/furukawa658/vscode-chat-tools/main/extensions/tsugi/icon.png" width="128" alt="Tsugi"></p>

# Tsugi: 長くなったCopilotチャットを、1クリックで次へ

チャットが長くなるほど、Copilotは指示を守らなくなり、応答も遅くなります。
Tsugiはコンテキストの使用率をステータスバーに出し、新しいチャットへ作業をそのまま引き継ぎます。要約のためにモデルを呼ばないので、追加のトークンは使いません。

## こんな経験はありませんか

- 長いやり取りの途中から、同じ指摘を何度も繰り返している
- 新しいチャットに切り替えたいが、経緯を書き直すのが面倒
- 今どれくらい使っているのか分からず、切り替えどきを逃す

## できること

| 機能 | 内容 |
| --- | --- |
| 使用率の常時表示 | ステータスバーに使用率を表示する。80%(設定で変更可)を超えると警告色になる |
| 1クリックで引き継ぎ | ステータスバーをクリックすると、新しいチャットの入力欄に引き継ぎ文が入る |
| 引き継ぎ文の中身 | 最初の依頼、直近のやり取り、全ワークスペースフォルダーのGit状態 |
| 送信はしない | 入力欄に入れるだけ。内容を確認・編集してから送信できる |
| 引き継ぎ文の保存 | 拡張機能の保存領域にも残せる(`tsugi.saveHandoff`) |

## 使い方

1. インストールすると、ステータスバーに使用率が出る。
2. 警告色になったら、ステータスバーをクリックする。
3. 新しいチャットに入った引き継ぎ文を確認し、送信する。

コマンドパレットの `Tsugi: 新しいチャットへ引き継ぐ` からも実行できる。

## プライバシー

- 外部へは何も送信しない。
- ファイルは読むだけで、書き込むのは引き継ぎ文の保存だけである。

## 知っておくこと

- Copilot Chatが公開していない保存形式(`chatSessions/*.jsonl`)を読む。形式が変わったら表示を止めて警告する。
- 表示する使用率は、ワークスペースで最後に更新されたチャットのものである。画面に表示中のチャットと異なる場合がある。
- 動作確認: VS Code 1.147、Copilot Chat 0.75。

## 設定

| 設定 | 既定値 | 内容 |
| --- | --- | --- |
| `tsugi.warnPercent` | 80 | 警告色にする使用率(%) |
| `tsugi.saveHandoff` | true | 引き継ぎ文をファイルへ保存する |

## 関連する拡張機能

- [Eien](https://marketplace.visualstudio.com/items?itemName=ShunsukeF.eien): 夜間に止まったチャットを再開させる
- [Ne](https://marketplace.visualstudio.com/items?itemName=ShunsukeF.ne-memory): 繰り返した修正指示をルール化する
- 3つまとめて入れる: [Pack](https://marketplace.visualstudio.com/items?itemName=ShunsukeF.vscode-chat-tools-pack)

不具合・要望は [GitHub](https://github.com/furukawa658/vscode-chat-tools/issues) へ。
