# Copilot Chat Power Pack (Tsugi · Eien · Ne)

Three lightweight, zero-bloat extensions that fix the biggest friction points of daily **GitHub Copilot Chat** and **Copilot Agent** workflows, from live context tracking to rule learning and credit-safe overnight runs.

## Why install all three? (The Complete Copilot Loop)

Long Copilot sessions usually fail in three predictable ways: **context bloat**, **repeating the same corrections**, and **stalled or runaway overnight runs**. Each extension solves one stage without overlapping:

| Stage | Extension | What it solves | Key safeguard |
| :--- | :--- | :--- | :--- |
| **1. During coding** | **Tsugi** | Shows live context window and token usage in the status bar and hands off or splits bloated chats in one click. | Uses **zero extra model tokens** for handoffs; never auto-sends prompts. |
| **2. Across sessions** | **Ne** | Detects corrections you keep repeating and turns them into `.github/copilot-instructions.md` or global rules. | **5-second review window** with root-cause explanation and one-click undo. |
| **3. Overnight / AFK** | **Eien** | Resumes stalled Copilot chats overnight and enforces a strict AI credit budget circuit breaker. | Stops immediately at your credit cap; saves rollback-ready **Git checkpoints** off-branch. |

## Built for control and safety

- **Independent and modular:** Each tool works standalone. Disable or configure any of the three anytime.
- **Local-first and transparent:** No external servers or telemetry. All session scanning runs locally in VS Code.
- **Reversible by design:** Git checkpoints (`refs/eien/checkpoint`), rule rollbacks, and draft-only handoff prompts keep you in full control.

## Related tools

| When you need... | Extension | Role |
| --- | --- | --- |
| Long-term recall across chats | [Kioku](https://marketplace.visualstudio.com/items?itemName=ShunsukeF.kioku-search) | Saves and searches lessons from earlier tasks. |
| Structured test and build diagnostics | [Zuma MCP](https://marketplace.visualstudio.com/items?itemName=ShunsukeF.inazuma-pwsh) | Returns concise failures from supported development tools. |
| A reusable workflow from a completed task | [Waza](https://marketplace.visualstudio.com/items?itemName=ShunsukeF.waza) | Compiles a selected workflow into an Agent Skill. |

[Japanese README](https://github.com/furukawa658/vscode-chat-tools/blob/main/extensions/pack/README.ja.md)

Source and bug reports: [GitHub](https://github.com/furukawa658/vscode-chat-tools). License: MIT.
