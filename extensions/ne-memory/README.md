<p align="center"><img src="https://raw.githubusercontent.com/furukawa658/vscode-chat-tools/main/extensions/ne-memory/icon.png" width="128" alt="Ne"></p>

# Ne: never give the same correction twice

"No, not like that." "I told you before." Do you keep giving Copilot the same corrections? Ne finds the corrections you repeated in your past chats and drafts them as rules. Only the rules you approve are saved to Copilot's user memory.

[日本語版 README](https://github.com/furukawa658/vscode-chat-tools/blob/main/extensions/ne-memory/README.ja.md)

![Ne overview](https://raw.githubusercontent.com/furukawa658/vscode-chat-tools/main/extensions/ne-memory/images/overview.png)

## Commands

| Command | Details |
| --- | --- |
| `Ne: 修正指示の検出数を測る` (count corrections) | Shows the number and share of corrections in your last 20 chats. No model is used. |
| `Ne: 修正指示を分析してルール登録` (analyze and register rules) | Drafts rules from your corrections and writes them only if you choose to register in the approval dialog. |
| `Ne: 登録したルールを取り消す` (undo registered rules) | Pick from the registration history to undo. |

Command titles are shown in Japanese in the current version.

## How to use

1. Run the count command first to see how often you restate things.
2. Run the analyze command, review the drafted rules, and approve only those you want.
3. In later chats, the registered rules are passed to Copilot.

## What is sent and written

- Only the text of corrections in the current workspace (up to 400 characters each) is sent to the VS Code language model, after a confirmation prompt.
- Nothing is registered automatically. Workspace instruction files are not modified.
- Rules are written to `globalStorage/github.copilot-chat/memory-tool/memories/ne-rules.md`.

## Good to know

- It depends on the chat save format and the memory location, which are internal to Copilot Chat. A change on their side may break it.
- Detection uses a small set of marker phrases, so it can miss corrections or flag false ones. The count command shows the detection rate.
- Verified on VS Code 1.147 and Copilot Chat 0.75.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `ne.scope` | `currentWorkspace` | Scope of analysis. The default is the current workspace only |

## Related extensions

- [Tsugi](https://marketplace.visualstudio.com/items?itemName=ShunsukeF.tsugi): hand off a long chat to a new one
- [Eien](https://marketplace.visualstudio.com/items?itemName=ShunsukeF.eien): resume chats that stall overnight
- Install all three: [Pack](https://marketplace.visualstudio.com/items?itemName=ShunsukeF.vscode-chat-tools-pack)

Bugs and requests: [GitHub Issues](https://github.com/furukawa658/vscode-chat-tools/issues). License: MIT.
