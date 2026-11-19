# vscode-chat-tools

Copilot Chatを長く使う人向けの拡張機能 Tsugi・Eien・Ne のモノレポ。共通部品は `src/core`。

| 拡張機能 | 内容 |
| --- | --- |
| [Tsugi](https://marketplace.visualstudio.com/items?itemName=ShunsukeF.tsugi) | 使用率の表示と、新しいチャットへの引き継ぎ |
| [Eien](https://marketplace.visualstudio.com/items?itemName=ShunsukeF.eien) | 夜間に止まったチャットの再開と作業ツリーの記録 |
| [Ne](https://marketplace.visualstudio.com/items?itemName=ShunsukeF.ne-memory) | 繰り返した修正指示のルール化 |
| [Pack](https://marketplace.visualstudio.com/items?itemName=ShunsukeF.vscode-chat-tools-pack) | 上の3つをまとめて導入 |

## 開発

- `bun run build` でバンドル、`bun test C:/.../tests` でテスト
- 公開は GitHub Actions の `publish` を手動実行する(`VSCE_PAT` が必要)。公開済みの版は再公開できないため、`package.json` の版を上げる
- 3つとも非公開のチャット保存形式を読む。形式が変わったら `src/core/session.ts` を直して全て再公開する
