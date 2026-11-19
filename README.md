# vscode-chat-tools

Monorepo of Tsugi, Eien and Ne: VS Code extensions for heavy Copilot Chat users. Shared code lives in `src/core`.

Japanese: [README.ja.md](README.ja.md)

| Extension | What it does |
| --- | --- |
| [Tsugi](https://marketplace.visualstudio.com/items?itemName=ShunsukeF.tsugi) | Shows context usage and hands off to a new chat |
| [Eien](https://marketplace.visualstudio.com/items?itemName=ShunsukeF.eien) | Resumes stalled chats overnight and records the working tree |
| [Ne](https://marketplace.visualstudio.com/items?itemName=ShunsukeF.ne-memory) | Turns repeated corrections into approved rules |
| [Pack](https://marketplace.visualstudio.com/items?itemName=ShunsukeF.vscode-chat-tools-pack) | Installs the three above |

## Development

- Build with `bun run build`; test with `bun test <absolute path to tests>`.
- Publish by running the `publish` GitHub Actions workflow manually (needs the `VSCE_PAT` secret). A published version cannot be republished, so bump the version in each `package.json`.
- All three read an unpublished chat save format. If it changes, fix `src/core/session.ts` and republish everything.
- `scripts/make-images.ts` regenerates the overview images (requires Chrome).
- `scripts/make-demo-media.ts` regenerates the UI demo screenshots and videos (requires Chrome and Python OpenCV).
