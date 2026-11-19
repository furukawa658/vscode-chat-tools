<p align="center"><img src="https://raw.githubusercontent.com/furukawa658/vscode-chat-tools/main/extensions/eien/icon.png" width="128" alt="Eien"></p>

# Eien: keep Copilot going while you sleep

You hand off a long task and go to bed, and in the morning the chat stopped halfway. Eien reduces that waste. It sends a continue instruction only to a chat that is stuck while processing, records the working tree to a Git ref at each intervention, and gives you a report in the morning.

[Japanese README](https://github.com/furukawa658/vscode-chat-tools/blob/main/extensions/eien/README.ja.md)

![Eien overview](https://raw.githubusercontent.com/furukawa658/vscode-chat-tools/main/extensions/eien/images/overview.png)

![Eien in VS Code](https://raw.githubusercontent.com/furukawa658/vscode-chat-tools/main/extensions/eien/images/demo.png)

[Watch the demo](https://raw.githubusercontent.com/furukawa658/vscode-chat-tools/main/extensions/eien/images/demo.mp4)

## Features

| Feature | Details |
| --- | --- |
| Resume stalled chats | When the chat has not updated for a set time (default 120 s) and the last request is still processing, it sends a continue instruction. Finished responses are left alone. |
| No stopping on questions | The instruction asks Copilot to write questions to `eien-questions.md` and move on to other work. |
| Rollback-ready records | The start state is saved as checkpoint #0, then each intervention is recorded under `refs/eien/checkpoint`. No work branch or normal index is changed. |
| Optional approval click | When enabled, Eien uses the OS accessibility API to click a known VS Code approval button. If no button is found or permissions are missing, it sends the normal continuation prompt instead. |
| Automatic stop | Stops at a time limit (default 8 h) or an intervention limit (default 20). |
| Morning report | Opens one report of the start, interventions, checkpoints, and stop. |

## How to use

1. After handing off your task, run `Eien: Start Overnight Monitoring` from the Command Palette.
2. In the morning, run `Eien: Open Morning Report`.
3. Run `Eien: Stop Overnight Monitoring` when you no longer need it.

## Safety

- It does not touch your work branch or your normal Git index. It uses a temporary index and a dedicated `refs/eien/checkpoint` history.
- Checkpoints are skipped while `.git/index.lock` exists. The start baseline makes rollback to the pre-run state possible.
- Approval clicking is disabled by default. Enable `eien.autoClickApprovals` only when you accept the OS accessibility behavior.
- The checkpoint uses `commit-tree` with GPG signing disabled, so hooks and signing prompts cannot freeze overnight work.
- Checkpoints include untracked files. Do not keep credentials in the working tree.

## Good to know

- It reads the chat save format, which Copilot Chat does not publish. If it cannot read it, Eien does not start, and stops if running.
- Verified on VS Code 1.147 and Copilot Chat 0.75.

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `eien.idleSeconds` | 120 | Seconds without updates before a chat counts as stalled |
| `eien.maxHours` | 8 | Maximum running time |
| `eien.maxInterventions` | 20 | Maximum number of interventions |
| `eien.autoClickApprovals` | `false` | Click known chat approval buttons through the OS accessibility API, then fall back to a continuation prompt |

## Approval Click Prerequisites

| OS | Requirement |
| --- | --- |
| All | Set `"editor.accessibilitySupport": "on"` in VS Code settings. |
| Windows | No extra setup. Eien uses PowerShell UI Automation. |
| macOS | Allow `Visual Studio Code` under System Settings > Privacy & Security > Accessibility. |
| Linux | Install `python3-pyatspi` and `gir1.2-atspi-2.0`. If Wayland blocks accessibility access, start VS Code with `code --ozone-platform=x11`. |

## Related extensions

- [Tsugi](https://marketplace.visualstudio.com/items?itemName=ShunsukeF.tsugi): hand off a long chat to a new one
- [Ne](https://marketplace.visualstudio.com/items?itemName=ShunsukeF.ne-memory): turn repeated corrections into rules
- Install all three: [Pack](https://marketplace.visualstudio.com/items?itemName=ShunsukeF.vscode-chat-tools-pack)

Bugs and requests: [GitHub Issues](https://github.com/furukawa658/vscode-chat-tools/issues). License: MIT.
