import * as vscode from "vscode";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Json, listSessionFiles, loadSession, userText, responseText } from "../core/session";
import { computeUsage } from "../core/usage";
import { diagnose } from "../core/diagnose";
import { computeUsageWithZig, stopZigScanner, ZigSessionMetadata } from "../core/zig";
import { diffSummary } from "../core/git";
import { buildHandoff } from "../core/handoff";
import { buildSplitHandoff, parseSplitTasks, SplitTask } from "../core/split";
import { askModel, chatSessionsDir, workspaceFolders, resolveChatLaunchSelection, sendToNewChat } from "../core/workspace";

export function activate(ctx: vscode.ExtensionContext) {
  const bar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  bar.command = "tsugi.handoff";
  ctx.subscriptions.push(bar);
  const dir = chatSessionsDir(ctx);
  let metadataCache: (ZigSessionMetadata & { path: string }) | undefined;
  let zigDisabled = false;
  let refreshing = false;

  const refresh = async () => {
    if (!dir || refreshing) return bar.hide();
    refreshing = true;
    try {
      const file = listSessionFiles(dir)[0];
      if (!file) return bar.hide();
      const baseOverheadTokens = vscode.workspace.getConfiguration("tsugi").get<number>("baseOverheadTokens", 0);
      let baseline;
      if (!metadataCache || metadataCache.path !== file.path || zigDisabled) {
        const diagnosis = diagnose(dir);
        if (!diagnosis.ok) {
          bar.text = "$(warning) Tsugi停止";
          bar.tooltip = `${diagnosis.message}\nVS Code ${vscode.version}。保存形式が変わった可能性がある。`;
          return bar.show();
        }
        baseline = computeUsage(loadSession(file.path), baseOverheadTokens);
        if (!baseline) return bar.hide();
        metadataCache = {
          path: file.path,
          contextSize: baseline.contextSize,
          modelId: baseline.modelId,
          mode: baseline.mode,
        };
      }
      let accelerated;
      if (!zigDisabled) {
        accelerated = await computeUsageWithZig(file.path, ctx.extensionUri.fsPath, metadataCache, baseOverheadTokens);
        if (baseline && accelerated && (accelerated.promptTokens !== baseline.promptTokens || accelerated.completionTokens !== baseline.completionTokens)) {
          zigDisabled = true;
          accelerated = undefined;
        }
      }
      const u = accelerated ?? baseline ?? computeUsage(loadSession(file.path), baseOverheadTokens);
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
    } finally {
      refreshing = false;
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
      const transcript = (session.requests ?? []).slice(-12).map((request: Json, index: number) =>
        `## Exchange ${index + 1}\nUser: ${userText(request).slice(0, 1000)}\nAssistant: ${responseText(request).slice(-1200)}`,
      ).join("\n\n");
      const consent = await vscode.window.showWarningMessage(
        "Send the latest chat transcript to the selected language model to identify independent tasks?",
        { modal: true },
        "Send",
      );
      if (!consent) return;
      const response = await askModel(
        `Find independent implementation tasks that can continue in separate chats. Return only a JSON array. Each item must have non-empty string fields title, goal, and context, plus optional string arrays relevantFiles, decisions, and acceptanceChecks. Keep each task isolated and do not merge unrelated work. Include only files, decisions, and checks relevant to that task.\n\n${transcript}`,
        new vscode.CancellationTokenSource().token,
      );
      let tasks: SplitTask[];
      try {
        tasks = parseSplitTasks(response);
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown error";
        return vscode.window.showWarningMessage(`Tsugi: the task proposal was invalid (${message}). Review the model response and try again.`);
      }
      if (tasks.length === 0) return vscode.window.showInformationMessage("Tsugi: no independent tasks were found.");
      const selected = await vscode.window.showQuickPick(tasks.map((task) => ({ label: task.title, description: task.goal, task })), {
        canPickMany: true,
        title: "Select tasks to open in separate chats",
        placeHolder: "One chat will be created for each selected task",
      });
      if (!selected?.length) return;
      const selection = await resolveChatLaunchSelection(session);
      for (const [index, item] of selected.entries()) {
        const task = item.task;
        const gitSummary = task.relevantFiles.length > 0 ? diffSummary(workspaceFolders(), task.relevantFiles) : "";
        const handoff = buildSplitHandoff(session, task, gitSummary);
        if (vscode.workspace.getConfiguration("tsugi").get<boolean>("saveHandoff", true)) {
          mkdirSync(ctx.globalStorageUri.fsPath, { recursive: true });
          writeFileSync(join(ctx.globalStorageUri.fsPath, `split-${Date.now()}-${index}.md`), handoff, "utf8");
        }
        await sendToNewChat(handoff, false, selection);
      }
    }),
  );
  if (dir) {
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(dir, "*.jsonl"));
    ctx.subscriptions.push(watcher, watcher.onDidCreate(() => void refresh()), watcher.onDidChange(() => void refresh()), watcher.onDidDelete(() => void refresh()));
  }
  const t = setInterval(() => void refresh(), 5000);
  ctx.subscriptions.push({ dispose: () => clearInterval(t) }, { dispose: stopZigScanner });
  void refresh();
}

export function deactivate() {}
