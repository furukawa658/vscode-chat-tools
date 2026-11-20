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

class TsugiSidebarProvider implements vscode.WebviewViewProvider {
  constructor(private readonly ctx: vscode.ExtensionContext) {}

  resolveWebviewView(view: vscode.WebviewView) {
    view.webview.options = { enableScripts: true, localResourceRoots: [this.ctx.extensionUri] };
    view.webview.html = this.render(view.webview);
    view.webview.onDidReceiveMessage(async (message) => {
      const config = vscode.workspace.getConfiguration("tsugi");
      if (message.type === "setLanguage") await config.update("language", message.value, vscode.ConfigurationTarget.Global);
      if (message.type === "setCredits") await config.update("nextChatCredits", message.value, vscode.ConfigurationTarget.Global);
      if (message.type === "setHandoffMode") await config.update("handoffMode", message.value, vscode.ConfigurationTarget.Global);
      if (message.type === "setAutoOpen") await config.update("autoOpenNewChat", message.value, vscode.ConfigurationTarget.Global);
      if (message.type === "handoff") await vscode.commands.executeCommand("tsugi.handoff");
      if (["setLanguage", "setCredits", "setHandoffMode", "setAutoOpen"].includes(message.type)) view.webview.html = this.render(view.webview);
    });
  }

  private render(webview: vscode.Webview): string {
    const config = vscode.workspace.getConfiguration("tsugi");
    const language = config.get<string>("language", "en");
    const credits = config.get<number>("nextChatCredits", 20);
    const mode = config.get<string>("handoffMode", "summary-decisions");
    const autoOpen = config.get<boolean>("autoOpenNewChat", true);
    const ja = language === "ja";
    const t = ja
      ? { title: "次のチャット", credits: "クレジット予算", mode: "引継ぎ内容", summaryOnly: "要約のみ", summaryDecisions: "要約＋判断事項", full: "すべて含める", auto: "新チャットを自動で開く", handoff: "新しいチャットへ引き継ぐ", note: "予算はプロンプトへ記載します。VS Codeの課金上限を強制するものではありません。" }
      : { title: "Next Chat", credits: "Credit budget", mode: "Handoff content", summaryOnly: "Summary only", summaryDecisions: "Summary and decisions", full: "Include all context", auto: "Open a new chat automatically", handoff: "Hand off to a new chat", note: "The budget is added to the prompt. It does not enforce a VS Code billing limit." };
    const nonce = `${Date.now()}`;
    return `<!doctype html><html><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'"><style nonce="${nonce}">${this.styles()}</style></head><body>
      <main><div class="head"><h1>${t.title}</h1><div class="lang" aria-label="Language"><button class="${!ja ? "active" : ""}" data-message="setLanguage" data-value="en">EN</button><button class="${ja ? "active" : ""}" data-message="setLanguage" data-value="ja">日本語</button></div></div>
      <label>${t.credits}<input id="credits" type="number" min="1" step="1" value="${credits}" /></label>
      <label>${t.mode}<select id="mode"><option value="summary-only" ${mode === "summary-only" ? "selected" : ""}>${t.summaryOnly}</option><option value="summary-decisions" ${mode === "summary-decisions" ? "selected" : ""}>${t.summaryDecisions}</option><option value="full" ${mode === "full" ? "selected" : ""}>${t.full}</option></select></label>
      <label class="check"><input id="auto" type="checkbox" ${autoOpen ? "checked" : ""}/><span>${t.auto}</span></label>
      <button id="handoff" class="primary">${t.handoff}</button><p class="note">${t.note}</p></main>
      <script nonce="${nonce}">const vscode=acquireVsCodeApi();document.querySelectorAll('[data-message]').forEach(b=>b.addEventListener('click',()=>vscode.postMessage({type:b.dataset.message,value:b.dataset.value})));document.getElementById('credits').addEventListener('change',e=>vscode.postMessage({type:'setCredits',value:Math.max(1,Math.round(Number(e.target.value)||20))}));document.getElementById('mode').addEventListener('change',e=>vscode.postMessage({type:'setHandoffMode',value:e.target.value}));document.getElementById('auto').addEventListener('change',e=>vscode.postMessage({type:'setAutoOpen',value:e.target.checked}));document.getElementById('handoff').addEventListener('click',()=>vscode.postMessage({type:'handoff'}));</script></body></html>`;
  }

  private styles(): string {
    return `body{font-family:var(--vscode-font-family);color:var(--vscode-foreground);font-size:13px;padding:10px}main{display:flex;flex-direction:column;gap:12px}.head{display:flex;align-items:center;justify-content:space-between}h1{font-size:14px;margin:0}.lang{display:flex;gap:2px}.lang button{border:1px solid var(--vscode-button-border,transparent);background:var(--vscode-input-background);color:var(--vscode-foreground);padding:4px 6px}.lang button.active{background:var(--vscode-button-background);color:var(--vscode-button-foreground)}label{display:flex;flex-direction:column;gap:5px}input[type=number],select{box-sizing:border-box;width:100%;background:var(--vscode-input-background);color:var(--vscode-input-foreground);border:1px solid var(--vscode-input-border,var(--vscode-widget-border));padding:7px}.check{flex-direction:row;align-items:center}.check input{margin:0}.primary{border:0;background:var(--vscode-button-background);color:var(--vscode-button-foreground);padding:8px 10px}.note{color:var(--vscode-descriptionForeground);font-size:11px;line-height:1.45;margin:0}`;
  }
}

export function activate(ctx: vscode.ExtensionContext) {
  ctx.subscriptions.push(vscode.window.registerWebviewViewProvider("tsugi.sidebar", new TsugiSidebarProvider(ctx)));
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
      if (vscode.workspace.getConfiguration("tsugi").get<boolean>("saveHandoff", true)) {
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
