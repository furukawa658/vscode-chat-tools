import * as vscode from "vscode";
import { mkdirSync, appendFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { listSessionFiles, loadSession } from "../core/session";
import { lastRequestState } from "../core/usage";
import { diagnose } from "../core/diagnose";
import { checkpoint } from "../core/git";
import { chatSessionsDir, workspaceFolders, sendToCurrentChat } from "../core/workspace";

const CONTINUE_PROMPT =
  "作業を続ける。利用者への質問で止まらず、判断できない事項は eien-questions.md に書き、他の作業を先に進める。完了したら完了条件を満たしたか確認して報告する。";

export function activate(ctx: vscode.ExtensionContext) {
  const cfg = () => vscode.workspace.getConfiguration("eien");
  const dir = chatSessionsDir(ctx);
  const reportPath = join(ctx.globalStorageUri.fsPath, "morning-report.md");
  const log: string[] = [];
  let active = false;
  let startedAt = 0;
  let interventions = 0;
  let timer: NodeJS.Timeout | undefined;
  const bar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  ctx.subscriptions.push(bar);

  const report = (line: string) => {
    const l = `- ${new Date().toISOString()} ${line}`;
    log.push(l);
    mkdirSync(ctx.globalStorageUri.fsPath, { recursive: true });
    appendFileSync(reportPath, l + "\n", "utf8");
  };

  const stop = (why: string) => {
    active = false;
    if (timer) clearInterval(timer);
    bar.hide();
    report(`停止: ${why}`);
    vscode.window.showInformationMessage(`Eien停止: ${why}。朝の報告を開く`, "開く").then((p) => p && vscode.commands.executeCommand("eien.report"));
  };

  const tick = async () => {
    if (!active || !dir) return;
    const maxHours = cfg().get<number>("maxHours", 8);
    const maxInt = cfg().get<number>("maxInterventions", 20);
    if (Date.now() - startedAt > maxHours * 3600_000) return stop(`経過${maxHours}時間の上限`);
    if (interventions >= maxInt) return stop(`介入${maxInt}回の上限`);
    const files = listSessionFiles(dir);
    if (files.length === 0) return;
    const idleSec = (Date.now() - statSync(files[0].path).mtimeMs) / 1000;
    if (idleSec < cfg().get<number>("idleSeconds", 120)) return;
    let state;
    try {
      state = lastRequestState(loadSession(files[0].path));
    } catch (e) {
      return stop(`保存形式を読めない: ${(e as Error).message}`);
    }
    // 処理中のまま更新が止まった場合だけ介入する。完了済みの応答には送らない。
    if (state !== "streaming") return;
    for (const f of workspaceFolders()) {
      try {
        const c = checkpoint(f, "refs/eien/checkpoint", join(tmpdir(), `eien-index-${Date.now()}`), "eien checkpoint");
        if (c) report(`チェックポイント ${f} ${c.slice(0, 8)}`);
      } catch (e) {
        report(`チェックポイント失敗 ${f}: ${(e as Error).message}`);
      }
    }
    interventions++;
    report(`停止理由=処理中のまま${Math.round(idleSec)}秒更新なし(承認待ちの可能性)。継続指示を送信`);
    await sendToCurrentChat(CONTINUE_PROMPT);
  };

  ctx.subscriptions.push(
    vscode.commands.registerCommand("eien.start", () => {
      if (!dir || !diagnose(dir).ok) return vscode.window.showWarningMessage("チャット保存ファイルを読めないため開始できない。");
      active = true;
      startedAt = Date.now();
      interventions = 0;
      report("開始");
      bar.text = "$(sync~spin) Eien";
      bar.command = "eien.stop";
      bar.show();
      timer = setInterval(() => void tick(), 15000);
    }),
    vscode.commands.registerCommand("eien.stop", () => stop("手動停止")),
    vscode.commands.registerCommand("eien.report", async () => {
      mkdirSync(ctx.globalStorageUri.fsPath, { recursive: true });
      appendFileSync(reportPath, "");
      await vscode.window.showTextDocument(vscode.Uri.file(reportPath));
    }),
  );
}

export function deactivate() {}
