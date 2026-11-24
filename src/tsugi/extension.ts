import * as vscode from "vscode";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { findSessionFile, Json, listSessionFiles, loadSession, SessionFile, sessionFileId, userText, responseText } from "../core/session";
import { computeUsage } from "../core/usage";
import { diagnose } from "../core/diagnose";
import { computeUsageWithZig, stopZigScanner, ZigSessionMetadata } from "../core/zig";
import { diffSummary } from "../core/git";
import { buildHandoff } from "../core/handoff";
import { buildSplitHandoff, parseSplitTasks, SplitTask } from "../core/split";
import { askModel, chatSessionsDir, workspaceFolders, resolveChatLaunchSelection, sendToNewChat } from "../core/workspace";
import { renderSidebarHtml, SessionOption } from "./sidebar";

function createSessionOptions(files: SessionFile[], baseOverheadTokens: number): SessionOption[] {
  return files.flatMap((file) => {
    try {
      const session = loadSession(file.path);
      const requests: Json[] = Array.isArray(session?.requests) ? session.requests : [];
      const firstRequest = requests.map((request) => userText(request).trim()).find(Boolean) ?? "Untitled chat";
      const usage = computeUsage(session, baseOverheadTokens);
      return [{
        id: sessionFileId(file.path),
        title: firstRequest.replace(/\s+/g, " ").slice(0, 100),
        requestCount: requests.length,
        mtimeMs: file.mtimeMs,
        usagePercent: usage ? Math.round(usage.ratio * 100) : undefined,
      }];
    } catch {
      return [];
    }
  });
}

class TsugiSidebarProvider implements vscode.WebviewViewProvider {
  private view: vscode.WebviewView | undefined;
  private sessionOptions: SessionOption[] = [];
  private selectedSessionId: string | undefined;

  constructor(
    private readonly ctx: vscode.ExtensionContext,
    private readonly onSelectSession: (id: string) => Promise<void>,
    private readonly onResolve: () => Promise<void>,
  ) {}

  resolveWebviewView(view: vscode.WebviewView) {
    this.view = view;
    view.webview.options = { enableScripts: true, localResourceRoots: [this.ctx.extensionUri] };
    view.webview.html = this.render(view.webview);
    view.onDidDispose(() => {
      if (this.view === view) this.view = undefined;
    });
    void this.onResolve();
    view.webview.onDidReceiveMessage(async (message) => {
      const config = vscode.workspace.getConfiguration("tsugi");
      if (message.type === "selectSession" && typeof message.value === "string") await this.onSelectSession(message.value);
      if (message.type === "setLanguage") await config.update("language", message.value, vscode.ConfigurationTarget.Global);
      if (message.type === "setCredits") await config.update("nextChatCredits", message.value, vscode.ConfigurationTarget.Global);
      if (message.type === "setHandoffMode") await config.update("handoffMode", message.value, vscode.ConfigurationTarget.Global);
      if (message.type === "setAutoOpen") await config.update("autoOpenNewChat", message.value, vscode.ConfigurationTarget.Global);
      if (message.type === "handoff" && typeof message.value === "string") await vscode.commands.executeCommand("tsugi.handoff", message.value);
      if (["setLanguage", "setCredits", "setHandoffMode", "setAutoOpen"].includes(message.type) && this.view) this.view.webview.html = this.render(this.view.webview);
    });
  }

  updateSessionOptions(options: SessionOption[], selectedId: string | undefined): void {
    this.sessionOptions = options;
    this.selectedSessionId = selectedId;
    if (this.view) this.view.webview.html = this.render(this.view.webview);
  }

  private render(webview: vscode.Webview): string {
    const config = vscode.workspace.getConfiguration("tsugi");
    const language = config.get<string>("language", "en");
    const credits = config.get<number>("nextChatCredits", 20);
    const mode = config.get<string>("handoffMode", "summary-decisions");
    const autoOpen = config.get<boolean>("autoOpenNewChat", true);
    return renderSidebarHtml({
      language,
      credits,
      mode,
      autoOpen,
      sessionOptions: this.sessionOptions,
      selectedSessionId: this.selectedSessionId,
      nonce: `${Date.now()}`,
    });
  }
}

export function activate(ctx: vscode.ExtensionContext) {
  const dir = chatSessionsDir(ctx);
  const bar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  const selectedSessionKey = "tsugi.selectedSessionId";
  let selectedSessionId = ctx.workspaceState.get<string>(selectedSessionKey);
  let metadataCache: (ZigSessionMetadata & { path: string }) | undefined;
  let zigDisabled = false;
  let refreshing = false;

  async function refresh(): Promise<void> {
    if (!dir || refreshing) {
      bar.hide();
      return;
    }
    refreshing = true;
    try {
      const files = listSessionFiles(dir);
      const selectedFile = findSessionFile(files, selectedSessionId);
      const optionFiles = selectedFile && !files.slice(0, 50).some((file) => file.path === selectedFile.path)
        ? [selectedFile, ...files.slice(0, 50)]
        : files.slice(0, 50);
      const baseOverheadTokens = vscode.workspace.getConfiguration("tsugi").get<number>("baseOverheadTokens", 0);
      const options = createSessionOptions(optionFiles, baseOverheadTokens);
      const availableSelectedId = options.some((option) => option.id === selectedSessionId) ? selectedSessionId : options[0]?.id;
      const file = findSessionFile(files, availableSelectedId);
      if (!availableSelectedId || !file) {
        provider.updateSessionOptions([], undefined);
        bar.hide();
        return;
      }
      if (selectedSessionId !== availableSelectedId) {
        selectedSessionId = availableSelectedId;
        await ctx.workspaceState.update(selectedSessionKey, selectedSessionId);
        metadataCache = undefined;
      }
      provider.updateSessionOptions(options, selectedSessionId);

      let baseline;
      if (!metadataCache || metadataCache.path !== file.path || zigDisabled) {
        const diagnosis = diagnose(dir, file.path);
        if (!diagnosis.ok) {
          bar.text = "$(warning) Tsugi停止";
          bar.tooltip = `${diagnosis.message}\nVS Code ${vscode.version}。保存形式が変わった可能性がある。`;
          bar.command = { command: "tsugi.handoff", title: "Hand off selected chat", arguments: [selectedSessionId] };
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
      const usage = accelerated ?? baseline ?? computeUsage(loadSession(file.path), baseOverheadTokens);
      if (!usage) return bar.hide();
      const pct = Math.round(usage.ratio * 100);
      const categories = usage.promptBreakdown.map((part) => `${part.label} ${part.percentage}%`).join(" · ");
      const tools = usage.toolNames.length ? `\nTools in this turn: ${usage.toolNames.join(", ")}` : "";
      const title = options.find((option) => option.id === selectedSessionId)?.title ?? selectedSessionId;
      bar.text = `$(comment-discussion) ${pct}%`;
      bar.tooltip = `${usage.occupiedTokens.toLocaleString()} / ${usage.contextSize.toLocaleString()} tokens (${usage.promptTokens.toLocaleString()} prompt + ${usage.completionTokens.toLocaleString()} completion). Click to hand off.\nSelected chat: ${title}\nModel: ${usage.modelId || "current"} · Mode: ${usage.mode || "current"}${categories ? `\n${categories}` : ""}${tools}\nChange the source in the Tsugi sidebar.`;
      bar.command = { command: "tsugi.handoff", title: "Hand off selected chat", arguments: [selectedSessionId] };
      bar.color = pct >= vscode.workspace.getConfiguration("tsugi").get<number>("warnPercent", 80) ? new vscode.ThemeColor("statusBarItem.warningForeground") : undefined;
      bar.show();
    } catch {
      bar.hide();
    } finally {
      refreshing = false;
    }
  }

  async function selectSession(id: string): Promise<void> {
    if (!dir || !findSessionFile(listSessionFiles(dir), id)) return;
    selectedSessionId = id;
    metadataCache = undefined;
    await ctx.workspaceState.update(selectedSessionKey, id);
    await refresh();
  }

  async function resolveCommandSession(requestedId?: string): Promise<Json | undefined> {
    if (!dir) return undefined;
    const files = listSessionFiles(dir);
    if (!files.length) return undefined;
    let file = findSessionFile(files, requestedId);
    if (!file && files.length === 1) file = files[0];
    if (!file) {
      const options = createSessionOptions(files.slice(0, 50), 0).map((option) => ({ label: option.title, description: `${option.usagePercent ?? "?"}% · ${option.requestCount} exchanges`, id: option.id }));
      const picked = await vscode.window.showQuickPick(options, {
        title: "Select the chat to hand off",
        placeHolder: "Choose the source chat explicitly",
      });
      if (!picked) return undefined;
      file = findSessionFile(files, picked.id);
    }
    if (!file) return undefined;
    const diagnosis = diagnose(dir, file.path);
    if (!diagnosis.ok) {
      await vscode.window.showWarningMessage(`チャット保存ファイルを読めないため引き継げない。${diagnosis.message}`);
      return undefined;
    }
    selectedSessionId = sessionFileId(file.path);
    await ctx.workspaceState.update(selectedSessionKey, selectedSessionId);
    metadataCache = undefined;
    await refresh();
    return loadSession(file.path);
  }

  const provider = new TsugiSidebarProvider(ctx, selectSession, refresh);
  ctx.subscriptions.push(vscode.window.registerWebviewViewProvider("tsugi.sidebar", provider), bar);
  ctx.subscriptions.push(
    vscode.commands.registerCommand("tsugi.handoff", async (requestedId?: string) => {
      const session = await resolveCommandSession(requestedId);
      if (!session) return;
      const config = vscode.workspace.getConfiguration("tsugi");
      const credits = config.get<number>("nextChatCredits", 20);
      const mode = config.get<string>("handoffMode", "summary-decisions");
      const handoffMaxChars = mode === "summary-only" ? 1800 : mode === "summary-decisions" ? 6000 : 12000;
      let text = buildHandoff(session, diffSummary(workspaceFolders()), handoffMaxChars);
      const modeInstruction = mode === "summary-only"
        ? "Keep the next chat concise: preserve the goal and recent decisions; omit unresolved investigation details."
        : mode === "summary-decisions"
          ? "Preserve the goal, confirmed decisions, unresolved items, and relevant acceptance checks."
          : "Preserve the complete available handoff context without dropping relevant file or Git details.";
      text = `# Next-chat budget: ${credits} AI credits\n\n${modeInstruction}\n\n${text}`;
      if (config.get<boolean>("saveHandoff", true)) {
        mkdirSync(ctx.globalStorageUri.fsPath, { recursive: true });
        writeFileSync(join(ctx.globalStorageUri.fsPath, `handoff-${Date.now()}.md`), text, "utf8");
      }
      const selection = await resolveChatLaunchSelection(session);
      if (config.get<boolean>("autoOpenNewChat", true)) {
        await sendToNewChat(text, false, selection);
      } else {
        await vscode.env.clipboard.writeText(text);
        await vscode.window.showInformationMessage("Tsugi: handoff copied to the clipboard. Open a new chat and paste it.");
      }
    }),
    vscode.commands.registerCommand("tsugi.split", async (requestedId?: string) => {
      const session = await resolveCommandSession(requestedId);
      if (!session) return;
      const transcript = (session.requests ?? []).slice(-12).map((request: Json, index: number) =>
        `## Exchange ${index + 1}\nUser: ${userText(request).slice(0, 1000)}\nAssistant: ${responseText(request).slice(-1200)}`,
      ).join("\n\n");
      const consent = await vscode.window.showWarningMessage(
        "Send the selected chat transcript to the selected language model to identify independent tasks?",
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
  const timer = setInterval(() => void refresh(), 5000);
  ctx.subscriptions.push({ dispose: () => clearInterval(timer) }, { dispose: stopZigScanner });
  void refresh();
}

export function deactivate() {}
