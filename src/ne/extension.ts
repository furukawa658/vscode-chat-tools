import * as vscode from "vscode";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { listSessionFiles, loadSession } from "../core/session";
import { diagnose } from "../core/diagnose";
import { askModel, chatSessionsDir } from "../core/workspace";
import { detectCorrections } from "./detect";

// ユーザーメモリの実体(実機で確認): globalStorage/github.copilot-chat/memory-tool/memories
const memoryFile = (ctx: vscode.ExtensionContext) =>
  join(dirname(ctx.globalStorageUri.fsPath), "github.copilot-chat", "memory-tool", "memories", "ne-rules.md");

interface Entry {
  id: string;
  rule: string;
  at: number;
}

export function activate(ctx: vscode.ExtensionContext) {
  const histPath = join(ctx.globalStorageUri.fsPath, "history.json");
  const loadHist = (): Entry[] => (existsSync(histPath) ? JSON.parse(readFileSync(histPath, "utf8")) : []);
  const saveHist = (h: Entry[]) => {
    mkdirSync(ctx.globalStorageUri.fsPath, { recursive: true });
    writeFileSync(histPath, JSON.stringify(h, null, 2), "utf8");
  };
  const render = (h: Entry[]) => "# Neが登録したルール\n\n" + h.map((e) => `- ${e.rule}`).join("\n") + "\n";
  const write = (h: Entry[]) => {
    const p = memoryFile(ctx);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, render(h), "utf8");
  };

  const dir = chatSessionsDir(ctx);
  const collect = () => {
    if (!dir) return [];
    const scope = vscode.workspace.getConfiguration("ne").get<string>("scope", "currentWorkspace");
    if (scope !== "currentWorkspace") vscode.window.showInformationMessage("横断分析は未実装のため現在のワークスペースだけを対象にする。");
    return listSessionFiles(dir).slice(0, 20).flatMap((f) => {
      try {
        return detectCorrections(loadSession(f.path));
      } catch {
        return [];
      }
    });
  };

  ctx.subscriptions.push(
    vscode.commands.registerCommand("ne.measure", () => {
      if (!dir || !diagnose(dir).ok) return vscode.window.showWarningMessage("チャット保存ファイルを読めない。");
      const files = listSessionFiles(dir).slice(0, 20);
      let total = 0;
      let hit = 0;
      for (const f of files) {
        try {
          const s = loadSession(f.path);
          total += Math.max(0, (s.requests?.length ?? 0) - 1);
          hit += detectCorrections(s).length;
        } catch {}
      }
      vscode.window.showInformationMessage(`直近${files.length}件: 発話${total}件中、修正指示と判定${hit}件(${total ? Math.round((hit / total) * 100) : 0}%)。内容を目視して誤検知率を確認する。`);
    }),
    vscode.commands.registerCommand("ne.analyze", async () => {
      if (!dir || !diagnose(dir).ok) return vscode.window.showWarningMessage("チャット保存ファイルを読めない。");
      const cs = collect();
      if (cs.length === 0) return vscode.window.showInformationMessage("修正指示は見つからなかった。");
      const ok = await vscode.window.showWarningMessage(`修正指示${cs.length}件の本文を言語モデルへ送信して分析する。`, { modal: true }, "送信する");
      if (!ok) return;
      const prompt = `次は利用者がAIへ繰り返した修正指示である。共通する原因を1つ選び、今後守るべきルールを1行の日本語で出力する。ルール文だけを出力する。\n\n${cs.map((c) => "- " + c.text.replace(/\n/g, " ")).join("\n")}`;
      const rule = (await askModel(prompt, new vscode.CancellationTokenSource().token)).trim().split("\n")[0];
      const pick = await vscode.window.showInformationMessage(`登録するルール案:\n${rule}`, { modal: true }, "登録する");
      if (pick !== "登録する") return;
      const h = loadHist();
      h.push({ id: String(Date.now()), rule, at: Date.now() });
      saveHist(h);
      write(h);
      vscode.window.showInformationMessage("ユーザーメモリ(ne-rules.md)へ登録した。");
    }),
    vscode.commands.registerCommand("ne.undo", async () => {
      const h = loadHist();
      if (h.length === 0) return vscode.window.showInformationMessage("登録履歴がない。");
      const sel = await vscode.window.showQuickPick(h.map((e) => ({ label: e.rule, id: e.id })), { placeHolder: "取り消すルール" });
      if (!sel) return;
      const next = h.filter((e) => e.id !== sel.id);
      saveHist(next);
      write(next);
    }),
  );
}

export function deactivate() {}
