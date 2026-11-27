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

## Resources

- `makaseru://tasks/{taskId}/contract?handoffToken=...`
- `makaseru://tasks/{taskId}/state?handoffToken=...`
- `makaseru://board/active?parentSessionId=...&parentSecret=...`

Task resources expose only the child-visible contract and state. The parent board expands waiting and review tasks while keeping completed tasks compact. Resource responses never include `parentSecret` or `handoffToken`.

## Verification

Makaseru stores state in a SQLite-compatible database with cross-process file locking. It checks:

- task identity and state transitions;
- allowed file scope;
- actual workspace file changes;
- evidence for every criterion;
- file and line references;
- optional file-content and command-exit gates.

Verification commands are restricted by the `makaseru.allowedCommands` setting. Makaseru runs objective verification outside the database lock and rejects stale completion results when task state changes during verification.

## Status and storage

The status bar shows the number of tasks waiting for the parent, waiting for review, and escalated. Makaseru publishes these counts to a secret-free status file and refreshes the display periodically.

Each workspace receives a distinct MCP server definition and SQLite-compatible database, keyed by the resolved workspace path. Databases use schema version checks so existing 0.1.0 state can migrate, while unknown future versions stop without modifying the database.
