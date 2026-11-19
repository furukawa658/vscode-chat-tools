import * as vscode from "vscode";
import { mkdirSync, appendFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, platform } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { listSessionFiles, loadSession } from "../core/session";
import { lastRequestState } from "../core/usage";
import { diagnose } from "../core/diagnose";
import { checkpoint } from "../core/git";
import { chatSessionsDir, workspaceFolders, sendToCurrentChat } from "../core/workspace";
import { calculateSessionCreditDelta, CreditBaseline, hasUnmeasuredCompletedRequest, isBudgetReached, snapshotSessionCredits } from "./budget";

const CONTINUE_PROMPT =
  "作業を続ける。利用者への質問で止まらず、判断できない事項は eien-questions.md に書き、他の作業を先に進める。完了したら完了条件を満たしたか確認して報告する。";
const execFileAsync = promisify(execFile);

async function clickApproval(ctx: vscode.ExtensionContext): Promise<{ clicked: boolean; detail: string }> {
  const scripts = vscode.Uri.joinPath(ctx.extensionUri, "scripts").fsPath;
  let command = "";
  let args: string[] = [];
  if (platform() === "win32") {
    command = "powershell.exe";
    args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", join(scripts, "auto-click.ps1")];
  } else if (platform() === "darwin") {
    command = "osascript";
    args = [join(scripts, "auto-click.applescript")];
  } else if (platform() === "linux") {
    command = "python3";
    args = [join(scripts, "auto-click.py")];
  } else {
    return { clicked: false, detail: "unsupported platform" };
  }
  try {
    const { stdout } = await execFileAsync(command, args, { timeout: 5000, windowsHide: true });
    const result = stdout.trim();
    if (platform() === "darwin") {
      return result && result !== "button-not-found" && !result.startsWith("error:")
        ? { clicked: true, detail: result }
        : { clicked: false, detail: result };
    }
    const parsed = JSON.parse(result || "{}");
    return { clicked: parsed.clicked === true, detail: parsed.button ?? parsed.reason ?? "unknown" };
  } catch (error) {
    const output = (error as { stdout?: string; message?: string }).stdout?.trim();
    return { clicked: false, detail: output || (error as Error).message };
  }
}

export function activate(ctx: vscode.ExtensionContext) {
  const cfg = () => vscode.workspace.getConfiguration("eien");
  const dir = chatSessionsDir(ctx);
  const reportPath = join(ctx.globalStorageUri.fsPath, "morning-report.md");
  const log: string[] = [];
  let active = false;
  let startedAt = 0;
  let interventions = 0;
  let creditBudget = 0;
  let creditBaselines: Record<string, CreditBaseline> = {};
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

  const saveCheckpoint = (number: number, label: string) => {
    for (const folder of workspaceFolders()) {
      try {
        const commit = checkpoint(folder, "refs/eien/checkpoint", join(tmpdir(), `eien-index-${Date.now()}`), `eien checkpoint #${number}${label ? ` (${label})` : ""}`);
        if (commit) report(`チェックポイント#${number} ${folder} ${commit.slice(0, 8)}`);
      } catch (error) {
        report(`チェックポイント#${number}失敗 ${folder}: ${(error as Error).message}`);
      }
    }
  };

  const captureCreditBaselines = () => {
    if (!dir) return;
    const next: Record<string, CreditBaseline> = {};
    for (const file of listSessionFiles(dir)) next[file.path] = snapshotSessionCredits(loadSession(file.path));
    creditBaselines = next;
  };

  const consumedCredits = () => {
    if (!dir) return 0;
    let consumed = 0;
    for (const file of listSessionFiles(dir)) {
      const session = loadSession(file.path);
      if (hasUnmeasuredCompletedRequest(session, startedAt)) throw new Error(`${file.path} にAIクレジット値のない完了済みリクエストがある`);
      consumed += calculateSessionCreditDelta(session, creditBaselines[file.path] ?? {}, startedAt);
    }
    return consumed;
  };

  const tripCircuitBreaker = async (reason: string) => {
    stop(reason);
    try {
      await vscode.commands.executeCommand("workbench.action.chat.cancel");
      report("サーキットブレーカー: 実行中のChatをキャンセル");
    } catch (error) {
      report(`サーキットブレーカー: Chatキャンセル失敗: ${(error as Error).message}`);
    }
  };

  let tickRunning = false;
  const tick = async () => {
    if (!active || !dir || tickRunning) return;
    tickRunning = true;
    try {
      const maxHours = cfg().get<number>("maxHours", 8);
      const maxInt = cfg().get<number>("maxInterventions", 20);
      let consumed: number;
      try {
        consumed = consumedCredits();
      } catch (error) {
        return void (await tripCircuitBreaker(`厳格モード: クレジット消費量を確認できない: ${(error as Error).message}`));
      }
      bar.text = `$(shield) Eien ${consumed.toFixed(2)}/${creditBudget} AIC`;
      if (isBudgetReached(consumed, creditBudget)) return void (await tripCircuitBreaker(`厳格モード: AIクレジットが予算${creditBudget}へ到達(消費${consumed.toFixed(4)})`));
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
      if (state !== "streaming") return;
      saveCheckpoint(interventions + 1, "intervention");
      interventions++;
      if (cfg().get<boolean>("autoClickApprovals", false)) {
        const result = await clickApproval(ctx);
        if (result.clicked) {
          report(`停止理由=処理中のまま${Math.round(idleSec)}秒更新なし。承認ボタンを自動クリック: ${result.detail}`);
          return;
        }
        report(`承認ボタンの自動クリックをスキップ: ${result.detail}`);
      }
      report(`停止理由=処理中のまま${Math.round(idleSec)}秒更新なし(承認待ちの可能性)。継続指示を送信`);
      await sendToCurrentChat(CONTINUE_PROMPT);
    } finally {
      tickRunning = false;
    }
  };

  ctx.subscriptions.push(
    vscode.commands.registerCommand("eien.start", async () => {
      if (active) return vscode.window.showInformationMessage("Eienはすでに監視中です。");
      if (!dir || !diagnose(dir).ok) return vscode.window.showWarningMessage("チャット保存ファイルを読めないため開始できない。");
      const previousBudget = ctx.globalState.get<number>("eien.nightCreditBudget");
      const input = await vscode.window.showInputBox({
        title: "Eien: 厳格なAIクレジット予算",
        prompt: "今夜Eienに使わせるAIクレジット上限を入力する。上限へ到達するとChatをキャンセルして再開を停止する。",
        placeHolder: "例: 50",
        value: previousBudget ? String(previousBudget) : undefined,
        validateInput: (value) => {
          const parsed = Number(value);
          return Number.isFinite(parsed) && parsed > 0 ? undefined : "0より大きい数値を入力してください。";
        },
      });
      if (input === undefined) return;
      const parsedBudget = Number(input);
      if (!Number.isFinite(parsedBudget) || parsedBudget <= 0) return;
      startedAt = Date.now();
      try {
        captureCreditBaselines();
      } catch (error) {
        return vscode.window.showWarningMessage(`クレジット基準値を読めないため開始できない: ${(error as Error).message}`);
      }
      await ctx.globalState.update("eien.nightCreditBudget", parsedBudget);
      creditBudget = parsedBudget;
      active = true;
      interventions = 0;
      report(`開始: 厳格なAIクレジット予算=${creditBudget}`);
      saveCheckpoint(0, "baseline");
      bar.text = `$(shield) Eien 0/${creditBudget} AIC`;
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
