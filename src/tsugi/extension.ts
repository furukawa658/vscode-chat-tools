import * as vscode from "vscode";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { listSessionFiles, loadSession } from "../core/session";
import { computeUsage } from "../core/usage";
import { diagnose } from "../core/diagnose";
import { diffSummary } from "../core/git";
import { buildHandoff } from "../core/handoff";
import { chatSessionsDir, workspaceFolders, sendToNewChat } from "../core/workspace";

export function activate(ctx: vscode.ExtensionContext) {
  const bar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  bar.command = "tsugi.handoff";
  ctx.subscriptions.push(bar);
  const dir = chatSessionsDir(ctx);

  const refresh = () => {
    if (!dir) return bar.hide();
    const d = diagnose(dir);
    if (!d.ok) {
      bar.text = "$(warning) Tsugi停止";
      bar.tooltip = `${d.message}\nVS Code ${vscode.version}。保存形式が変わった可能性がある。`;
      return bar.show();
    }
    try {
      const u = computeUsage(loadSession(listSessionFiles(dir)[0].path));
      if (!u) return bar.hide();
      const pct = Math.round(u.ratio * 100);
      bar.text = `$(comment-discussion) ${pct}%`;
      bar.tooltip = `${u.promptTokens.toLocaleString()} / ${u.contextSize.toLocaleString()} トークン。クリックで新しいチャットへ引き継ぐ。\n最新の更新ファイルを対象とするため、表示中のチャットと異なる場合がある。`;
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
      await sendToNewChat(text, false);
    }),
  );
  const t = setInterval(refresh, 10000);
  ctx.subscriptions.push({ dispose: () => clearInterval(t) });
  refresh();
}

export function deactivate() {}
