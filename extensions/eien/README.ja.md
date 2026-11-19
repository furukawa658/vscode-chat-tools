<p align="center"><img src="https://raw.githubusercontent.com/furukawa658/vscode-chat-tools/main/extensions/eien/icon.png" width="128" alt="Eien"></p>

# Eien: 寝ている間も、Copilotを止めない

夜に長い作業を任せて寝たのに、朝見たら途中で止まっていた。Eienはその無駄を減らします。
処理中のまま止まったチャットにだけ継続指示を送り、介入のたびに作業ツリーをGit参照へ記録します。朝には、何が起きたかの報告を開けます。

## できること

| 機能 | 内容 |
| --- | --- |
| 止まったチャットの再開 | 更新が一定時間(既定120秒)止まり、最後のリクエストが処理中のままのときだけ継続指示を送る。完了済みの応答には送らない |
| 質問で止まらない | 継続指示は、質問で止まらず `eien-questions.md` へ書いて他の作業を進めるよう求める |
| 巻き戻せる記録 | 介入のたびに、`refs/eien/checkpoint` へ作業ツリーを記録する。作業ブランチは増えず、フックも通らない |
| 上限で自動停止 | 経過時間(既定8時間)と介入回数(既定20回)の上限で止まる |
| 朝の報告 | 開始・介入・チェックポイント・停止の記録を1つのレポートで開ける |

## 使い方

1. 作業を任せたら、コマンドパレットで `Eien: 開始` を実行する。
2. 朝に `Eien: 朝の報告を開く` で記録を確認する。
3. 不要になったら `Eien: 停止` を実行する。

## 安全のために

- 作業ブランチと通常のインデックスには触れない。一時インデックスを使う。
- 承認ボタンの自動押下はしない。編集の自動確定もしない。
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

## 関連する拡張機能

- [Tsugi](https://marketplace.visualstudio.com/items?itemName=ShunsukeF.tsugi): 長くなったチャットを新しいチャットへ引き継ぐ
- [Ne](https://marketplace.visualstudio.com/items?itemName=ShunsukeF.ne-memory): 繰り返した修正指示をルール化する
- 3つまとめて入れる: [Pack](https://marketplace.visualstudio.com/items?itemName=ShunsukeF.vscode-chat-tools-pack)

不具合・要望は [GitHub](https://github.com/furukawa658/vscode-chat-tools/issues) へ。
