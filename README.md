# vscode-chat-tools

Copilot Chat向け拡張機能 Tsugi・Eien・Ne のモノレポ。共通部品は `src/core`。

- `bun run build` でバンドル、`bun test C:/.../tests` でテスト
- `extensions/<名前>` で `npx vsce package` / `npx vsce publish`
- 3つとも非公開のチャット保存形式を読む。形式が変わったら `src/core/session.ts` を直して全て再公開する。
