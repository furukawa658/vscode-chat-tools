# Makaseru MCP

**Task Handoff & Verification for lightweight agents**

Makaseru gives Copilot Chat a Model Context Protocol server for bounded subagent work. A parent registers one small task, a child accepts it, asks the parent instead of guessing, and submits evidence for Makaseru to verify against allowed paths, Git state, file references, and optional command gates.

## Tools

- `makaseru_dispatch_subtask`
- `makaseru_accept_subtask`
- `makaseru_ask_parent`
- `makaseru_answer_question`
- `makaseru_complete_subtask`
- `makaseru_review_completion`
- `makaseru_collect_report`
- `makaseru_list_tasks`

The parent must keep `parentSecret` private. Pass only `childHandoffPrompt` to the child agent. Completion with unverified assumptions moves to `NEEDS_PARENT_REVIEW` instead of completing automatically.

## Verification

Makaseru stores state in a SQLite-compatible database with cross-process file locking. It checks:

- task identity and state transitions;
- allowed file scope;
- actual workspace file changes;
- evidence for every criterion;
- file and line references;
- optional file-content and command-exit gates.

Verification commands are restricted by the `makaseru.allowedCommands` setting.
