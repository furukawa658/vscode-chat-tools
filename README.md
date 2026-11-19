# vscode-chat-tools

Keep Copilot Chat moving: before context runs out, when a task stalls overnight, and after you have corrected the same thing too many times.

Tsugi, Eien, and Ne are three focused VS Code extensions that share the reading and Git safety code in `src/core`. Install them separately or get the full set from [the Pack](https://marketplace.visualstudio.com/items?itemName=ShunsukeF.vscode-chat-tools-pack).

Japanese: [README.ja.md](README.ja.md)

| Extension | When it helps |
| --- | --- |
| [Tsugi](https://marketplace.visualstudio.com/items?itemName=ShunsukeF.tsugi) | A long chat is getting fuzzy or slow: see context usage and continue in a fresh chat |
| [Eien](https://marketplace.visualstudio.com/items?itemName=ShunsukeF.eien) | Leave an overnight task with a strict AI credit circuit breaker: cancel at your nightly budget, resume stalls, and keep rollback-ready checkpoints |
| [Ne](https://marketplace.visualstudio.com/items?itemName=ShunsukeF.ne-memory) | You keep repeating the same correction: review and save it as a reusable rule |
| [Pack](https://marketplace.visualstudio.com/items?itemName=ShunsukeF.vscode-chat-tools-pack) | Install the complete Copilot Chat workflow in one click |

## Development

- Build with `bun run build`; test with `bun test <absolute path to tests>`.
- Publish by running the `publish` GitHub Actions workflow manually (needs the `VSCE_PAT` secret). A published version cannot be republished, so bump the version in each `package.json`.
- All three read an unpublished chat save format. If it changes, fix `src/core/session.ts` and republish everything.
- `scripts/make-images.ts` regenerates the overview images (requires Chrome).
- `scripts/make-demo-media.ts` regenerates the UI demo screenshots and videos (requires Chrome and Python OpenCV).
- `bun run build:zig` cross-compiles the resident Tsugi session scanner for Windows, Linux, and macOS. Local builds use the JavaScript fallback when Zig is unavailable; CI and Marketplace publishing require Zig 0.15.2.
