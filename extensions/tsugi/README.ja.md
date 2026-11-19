<p align="center"><img src="https://raw.githubusercontent.com/furukawa658/vscode-chat-tools/main/extensions/tsugi/icon.png" width="128" alt="Tsugi"></p>

# Tsugi: 長いチャットを捨てずに、次へ進む

会話が長くなると、Copilotが指示を見落とし、応答にも時間がかかる。Tsugiはコンテキストの使用率がどこまで埋まったかを表示し、目標・直近の判断・Git状態・対象ファイルを新しいチャットの入力欄へ移す。引き継ぎにモデルを呼ばないため、チャットを替えるだけで追加トークンを使わない。

経緯を思い出して書き直す手間を、確認と1クリックに置き換える。

## こんな経験はありませんか

- 長いやり取りの途中から、同じ指摘を何度も繰り返している
- 新しいチャットへ切り替えたいが、経緯を書き直すのが面倒
- コンテキストの残量が分からず、切り替える時期を逃す

## できること

| 機能 | 内容 |
| --- | --- |
| 使用率の常時表示 | ステータスバーに使用率を表示する。80%(設定で変更可)を超えると警告色になる |
| 1クリックで引き継ぎ | ステータスバーをクリックすると、新しいチャットの入力欄に引き継ぎ文が入る |
| 1つのチャットを複数タスクへ分割 | `Tsugi: Split into Separate Task Chats` で独立タスクの候補を確認し、選んだタスクごとに別チャットを作る |
| タスク単位の引き継ぎ | 各チャットへ、そのタスクの目標、関連ファイル、確定事項、受入条件、該当する直近のやり取り、関連ファイルだけのGit差分を入れる |
| 引き継ぎ文の中身 | 最初の依頼、直近のやり取り、全ワークスペースフォルダーのGit状態 |
| 送信はしない | 入力欄に入れるだけ。内容を確認・編集してから送信できる |
| 引き継ぎ文の保存 | 拡張機能の保存領域にも残せる(`tsugi.saveHandoff`) |

## 使い方

1. インストールすると、ステータスバーに使用率が出る。
2. 警告色になったら、ステータスバーをクリックする。
3. 新しいチャットに入った引き継ぎ文を確認し、送信する。

コマンドパレットの `Tsugi: 新しいチャットへ引き継ぐ` と `Tsugi: Split into Separate Task Chats` からも実行できる。分割時は直近の会話をモデルへ送る前に確認を求め、提案の構造を検証してから、選んだ各タスクを別チャットの未送信入力として開く。

## プライバシー

- 引き継ぎ文を自動送信しない。
- 分割時だけ、確認後に直近の会話をVS Codeで選択中の言語モデルへ送る。
- ファイルは読むだけで、書き込むのは引き継ぎ文の保存だけである。

## 知っておくこと

- Copilot Chatが公開していない保存形式(`chatSessions/*.jsonl`)を読む。形式が変わると表示できない場合がある。
- 表示する使用率は、ワークスペースで最後に更新されたチャットのものである。画面に表示中のチャットと異なる場合がある。
- 現在の合計にシステム指示やツール定義が含まれているため、追加オーバーヘッドの既定値は0である。
- 動作確認: VS Code 1.147、Copilot Chat 0.75。

## 設定

| 設定 | 既定値 | 内容 |
| --- | --- | --- |
| `tsugi.warnPercent` | 80 | 警告色にする使用率(%) |
| `tsugi.saveHandoff` | true | 引き継ぎ文をファイルへ保存する |
| `tsugi.baseOverheadTokens` | 0 | 保存済みの合計に含まれないシステム・MCPオーバーヘッドを補う |

## 関連する拡張機能

- [Eien](https://marketplace.visualstudio.com/items?itemName=ShunsukeF.eien): 夜間に止まったチャットを再開させる
- [Ne](https://marketplace.visualstudio.com/items?itemName=ShunsukeF.ne-memory): 繰り返した修正指示をルール化する
- 3つまとめて入れる: [Pack](https://marketplace.visualstudio.com/items?itemName=ShunsukeF.vscode-chat-tools-pack)

不具合・要望は [GitHub](https://github.com/furukawa658/vscode-chat-tools/issues) へ。