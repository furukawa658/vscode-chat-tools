# vscode-chat-tools

Copilot Chatの作業が途切れる場面を、4つの拡張機能でつなぐ。

コンテキストが限界に近づく前、夜間作業が途中で止まったとき、同じ修正指示を繰り返したとき、軽量エージェントへ作業を任せるときに使える。Tsugi・Eien・Ne・Makaseruは責務を分ける。個別にも入れられるが、[Pack](https://marketplace.visualstudio.com/items?itemName=ShunsukeF.vscode-chat-tools-pack)なら一度にそろえられる。

| 拡張機能 | こんな場面で使う |
| --- | --- |
| [Tsugi](https://marketplace.visualstudio.com/items?itemName=ShunsukeF.tsugi) | 長いチャットの応答が鈍い。使用率を見て、作業内容を新しいチャットへ引き継ぐ |
| [Eien](https://marketplace.visualstudio.com/items?itemName=ShunsukeF.eien) | 夜間のAIクレジット予算に達したら厳格に停止し、静かになったチャットを再開してGitのチェックポイントを残す |
| [Ne](https://marketplace.visualstudio.com/items?itemName=ShunsukeF.ne-memory) | 同じ修正指示を繰り返す。内容を確認して、再利用できるルールにする |
| Makaseru MCP | 軽量エージェントへ小さな作業を渡す。親へ判断を戻し、完了後は許可範囲・根拠・ファイルの実状態を確かめる |
| [Pack](https://marketplace.visualstudio.com/items?itemName=ShunsukeF.vscode-chat-tools-pack) | 4つの拡張機能をまとめて導入する |

## 開発

- `bun run build` でバンドル、`bun test C:/.../tests` でテストする
- 公開はGitHub Actionsの `publish` を手動実行する(`VSCE_PAT` が必要)。公開済みの版は再公開できないため、`package.json` の版を上げる
- Tsugi・Eien・Neは非公開のチャット保存形式を読む。形式が変わったら `src/core/session.ts` を直し、該当する3拡張とPackを再公開する
