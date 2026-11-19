<p align="center"><img src="https://raw.githubusercontent.com/furukawa658/vscode-chat-tools/main/extensions/tsugi/icon.png" width="128" alt="Tsugi"></p>

# Tsugi: hand off a long Copilot chat in one click

The longer a chat gets, the more Copilot forgets your instructions and the slower it responds. Tsugi shows context usage in the status bar and carries your work over to a fresh chat. It does not call a model to summarize, so it uses no extra tokens.

[日本語版 README](https://github.com/furukawa658/vscode-chat-tools/blob/main/extensions/tsugi/README.ja.md)

![Tsugi overview](https://raw.githubusercontent.com/furukawa658/vscode-chat-tools/main/extensions/tsugi/images/overview.png)

## Does this sound familiar?

- Halfway through a long conversation, you repeat the same correction again and again.
- You want a new chat, but rewriting the background is a chore.
- You cannot tell how much context is used, so you miss the right moment to switch.

## Features

| Feature | Details |
| --- | --- |
| Usage in the status bar | Shows context usage at all times. Turns to a warning color above 80% (configurable). |
| One-click handoff | Click the status bar to put a handoff prompt into a new chat input. |
| What the handoff contains | The first request, recent exchanges, and the Git state of every workspace folder. |
| Nothing is sent for you | The text only lands in the input box. You review and edit it before sending. |
| Optional file copy | The handoff can also be saved to the extension storage (`tsugi.saveHandoff`). |

## How to use

1. Install the extension. The usage appears in the status bar.
2. When it turns to the warning color, click it.
3. Review the handoff prompt in the new chat and send it.

You can also run `Tsugi: 新しいチャットへ引き継ぐ` (hand off to a new chat) from the Command Palette. Command titles are shown in Japanese in the current version.

## Privacy

- Nothing is sent to any external service.
- Files are only read. The only write is the optional handoff copy.

## Good to know

- It reads the chat save format (`chatSessions/*.jsonl`), which Copilot Chat does not publish. If the format changes, Tsugi stops showing values and warns you.
- The usage shown is for the most recently updated chat in the workspace. It can differ from the chat on screen.
- Verified on VS Code 1.147 and Copilot Chat 0.75.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `tsugi.warnPercent` | 80 | Usage (%) at which the status bar turns to the warning color |
| `tsugi.saveHandoff` | true | Also save the handoff text to a file |

## Related extensions

- [Eien](https://marketplace.visualstudio.com/items?itemName=ShunsukeF.eien): resume chats that stall overnight
- [Ne](https://marketplace.visualstudio.com/items?itemName=ShunsukeF.ne-memory): turn repeated corrections into rules
- Install all three: [Pack](https://marketplace.visualstudio.com/items?itemName=ShunsukeF.vscode-chat-tools-pack)

Bugs and requests: [GitHub Issues](https://github.com/furukawa658/vscode-chat-tools/issues). License: MIT.
