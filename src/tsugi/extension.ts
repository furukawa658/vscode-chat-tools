import * as vscode from "vscode";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { listSessionFiles, loadSession, userText, responseText } from "../core/session";
import { computeUsage } from "../core/usage";
import { diagnose } from "../core/diagnose";
import { computeUsageWithZig } from "../core/zig";
import { diffSummary } from "../core/git";
import { buildHandoff } from "../core/handoff";
import { askModel, chatSessionsDir, workspaceFolders, resolveChatLaunchSelection, sendToNewChat } from "../core/workspace";

export function activate(ctx: vscode.ExtensionContext) {
  const bar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  bar.command = "tsugi.handoff";
  ctx.subscriptions.push(bar);
  const dir = chatSessionsDir(ctx);

  const refresh = () => {
    if (!dir) return bar.hide();
    const file = listSessionFiles(dir)[0];
    if (!file) return bar.hide();
    try {
      const baseOverheadTokens = vscode.workspace.getConfiguration("tsugi").get<number>("baseOverheadTokens", 0);
      const accelerated = computeUsageWithZig(file.path, ctx.extensionUri.fsPath, baseOverheadTokens);
      if (!accelerated) {
        const diagnosis = diagnose(dir);
        if (!diagnosis.ok) {
          bar.text = "$(warning) Tsugi停止";
          bar.tooltip = `${diagnosis.message}\nVS Code ${vscode.version}。保存形式が変わった可能性がある。`;
          return bar.show();
        }
      }
      const u = accelerated ?? computeUsage(loadSession(file.path), baseOverheadTokens);
      if (!u) return bar.hide();
      const pct = Math.round(u.ratio * 100);
      const categories = u.promptBreakdown.map((part) => `${part.label} ${part.percentage}%`).join(" · ");
      const tools = u.toolNames.length ? `\nTools in this turn: ${u.toolNames.join(", ")}` : "";
      bar.text = `$(comment-discussion) ${pct}%`;
      bar.tooltip = `${u.occupiedTokens.toLocaleString()} / ${u.contextSize.toLocaleString()} tokens (${u.promptTokens.toLocaleString()} prompt + ${u.completionTokens.toLocaleString()} completion). Click to hand off.\nModel: ${u.modelId || "current"} · Mode: ${u.mode || "current"}${categories ? `\n${categories}` : ""}${tools}\nUses the most recently updated session, which can differ from the visible chat.`;
      bar.color = pct >= vscode.workspace.getConfiguration("tsugi").get<number>("warnPercent", 80) ? new vscode.ThemeColor("statusBarItem.warningForeground") : undefined;
      bar.show();
    } catch {
      bar.hide();
    }
  };

  ctx.subscriptions.push(
    vscode.commands.registerCommand("tsugi.handoff", async () => {
      if (!dir || !diagnose(dir).ok) return vscode.window.showWarningMessage("チャット保存ファイルを読めないため引き継げない。");
      const session = loadSession(listSessionFiles(dir)[0].path);
      const text = buildHandoff(session, diffSummary(workspaceFolders()));
      if (vscode.workspace.getConfiguration("tsugi").get<boolean>("saveHandoff", true)) {
        mkdirSync(ctx.globalStorageUri.fsPath, { recursive: true });
        writeFileSync(join(ctx.globalStorageUri.fsPath, `handoff-${Date.now()}.md`), text, "utf8");
      }
      const selection = await resolveChatLaunchSelection(session);
      await sendToNewChat(text, false, selection);
    }),
    vscode.commands.registerCommand("tsugi.split", async () => {
      if (!dir || !diagnose(dir).ok) return vscode.window.showWarningMessage("チャット保存ファイルを読めないため分割できない。");
      const session = loadSession(listSessionFiles(dir)[0].path);
      const transcript = (session.requests ?? []).slice(-12).map((request: any, index: number) =>
        `## Exchange ${index + 1}\nUser: ${userText(request).slice(0, 1000)}\nAssistant: ${responseText(request).slice(-1200)}`,
      ).join("\n\n");
      const consent = await vscode.window.showWarningMessage(
        "Send the latest chat transcript to the selected language model to identify independent tasks?",
        { modal: true },
        "Send",
      );
      if (!consent) return;
      const response = await askModel(
        `Find independent implementation tasks that can continue in separate chats. Return only a JSON array. Each item must have string fields title, goal, and context. Do not merge unrelated work.\n\n${transcript}`,
        new vscode.CancellationTokenSource().token,
      );
      const cleaned = response.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
      let tasks: Array<{ title: string; goal: string; context: string }>;
      try {
        tasks = JSON.parse(cleaned);
      } catch {
        return vscode.window.showWarningMessage("Tsugi: the task proposal was not valid JSON. Review the model response and try again.");
      }
      if (!Array.isArray(tasks)) return vscode.window.showWarningMessage("Tsugi: the task proposal was not an array.");
      tasks = tasks.filter((task) => task && typeof task.title === "string" && typeof task.goal === "string" && typeof task.context === "string");
      if (tasks.length === 0) return vscode.window.showInformationMessage("Tsugi: no independent tasks were found.");
      const selected = await vscode.window.showQuickPick(tasks.map((task) => ({ label: task.title, description: task.goal, task })), {
        canPickMany: true,
        title: "Select tasks to open in separate chats",
        placeHolder: "One chat will be created for each selected task",
      });
      if (!selected?.length) return;
      const selection = await resolveChatLaunchSelection(session);
      const common = buildHandoff(session, diffSummary(workspaceFolders()));
      for (const item of selected) {
        const task = item.task;
        const handoff = `# Task split\n\n## Task\n${task.title}\n\n## Goal\n${task.goal}\n\n## Task context\n${task.context}\n\n${common}`;
        if (vscode.workspace.getConfiguration("tsugi").get<boolean>("saveHandoff", true)) {
          mkdirSync(ctx.globalStorageUri.fsPath, { recursive: true });
          writeFileSync(join(ctx.globalStorageUri.fsPath, `split-${Date.now()}-${tasks.indexOf(task)}.md`), handoff, "utf8");
        }
        await sendToNewChat(handoff, false, selection);
      }
    }),
  );
  if (dir) {
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(dir, "*.jsonl"));
    ctx.subscriptions.push(watcher, watcher.onDidCreate(refresh), watcher.onDidChange(refresh), watcher.onDidDelete(refresh));
  }
  const t = setInterval(refresh, 5000);
  ctx.subscriptions.push({ dispose: () => clearInterval(t) });
  refresh();
}

export function deactivate() {}
