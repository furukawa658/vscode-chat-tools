import * as vscode from "vscode";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { listSessionFiles, loadSession } from "../core/session";
import { diagnose } from "../core/diagnose";
import { askModel, chatSessionsDir } from "../core/workspace";
import { clusterCorrections, Correction, FrictionCluster, detectCorrections, parseRuleProposal, RuleProposal } from "./detect";

type RuleScope = "Global" | "Workspace";

interface Entry {
  id: string;
  rule: string;
  at: number;
  scope: RuleScope;
  filePath: string;
}

interface RuleWrite {
  filePath: string;
  rule: string;
  replacedRule?: string;
}

interface Proposal {
  id: string;
  rule: string;
  phenomenon: string;
  cause: string;
  evidence: string;
  scope: RuleScope;
  mergeTargetRule?: string;
  registered?: RuleWrite;
  documentUri?: vscode.Uri;
  timer?: NodeJS.Timeout;
}

const RULE_START = "<!-- ne-rule-start -->";
const RULE_END = "<!-- ne-rule-end -->";

function ruleLines(text: string): string[] {
  return text.split(/\r?\n/).filter((line) => line.startsWith("- ")).map((line) => line.slice(2).trim()).filter(Boolean);
}

export function activate(ctx: vscode.ExtensionContext) {
  const historyPath = join(ctx.globalStorageUri.fsPath, "history.json");
  const proposals = new Map<string, Proposal>();
  const codeLensChanged = new vscode.EventEmitter<void>();
  const configuration = () => vscode.workspace.getConfiguration("ne");
  const currentSessionDir = chatSessionsDir(ctx);
  const globalRulesFile = () => join(dirname(ctx.globalStorageUri.fsPath), "github.copilot-chat", "memory-tool", "memories", "user-preferences.instructions.md");
  const workspaceRulesFile = () => {
    const folder = vscode.workspace.workspaceFolders?.[0];
    return folder ? join(folder.uri.fsPath, ".github", "copilot-instructions.md") : "";
  };
  const targetFile = (scope: RuleScope) => scope === "Global" ? globalRulesFile() : workspaceRulesFile();

  const loadHistory = (): Entry[] => {
    if (!existsSync(historyPath)) return [];
    return (JSON.parse(readFileSync(historyPath, "utf8")) as Array<Partial<Entry>>).map((entry) => ({
      id: entry.id ?? String(entry.at ?? Date.now()),
      rule: entry.rule ?? "",
      at: entry.at ?? Date.now(),
      scope: entry.scope ?? "Global",
      filePath: entry.filePath ?? join(dirname(globalRulesFile()), "ne-rules.md"),
    }));
  };
  const saveHistory = (history: Entry[]) => {
    mkdirSync(ctx.globalStorageUri.fsPath, { recursive: true });
    writeFileSync(historyPath, JSON.stringify(history, null, 2), "utf8");
  };

  const removeRule = (write: RuleWrite) => {
    if (!existsSync(write.filePath)) return;
    const current = readFileSync(write.filePath, "utf8");
    let next: string;
    if (write.replacedRule) {
      next = current.replace(`- ${write.rule}`, `- ${write.replacedRule}`);
    } else {
      const currentRule = `- ${write.rule}`;
      next = current.replace(new RegExp(`^${currentRule.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\r?\\n?`, "m"), "");
    }
    if (next !== current) writeFileSync(write.filePath, next, "utf8");
  };

  const writeRule = (proposal: Proposal, rule: string): RuleWrite => {
    const filePath = targetFile(proposal.scope);
    if (!filePath) throw new Error("No workspace folder is available for a Workspace rule.");
    mkdirSync(dirname(filePath), { recursive: true });
    const current = existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
    let next = current;
    let replacedRule: string | undefined;
    if (proposal.mergeTargetRule) {
      const before = `- ${proposal.mergeTargetRule}`;
      if (!current.includes(before)) throw new Error("The selected merge target no longer exists.");
      next = current.replace(before, `- ${rule}`);
      replacedRule = proposal.mergeTargetRule;
    } else if (ruleLines(current).includes(rule)) {
      throw new Error("The same rule is already present in the selected scope.");
    } else {
      next = `${current.replace(/\s*$/, "")}\n\n## Rules registered by Ne\n\n- ${rule}\n`;
    }
    if (next !== current) writeFileSync(filePath, next, "utf8");
    return { filePath, rule, replacedRule };
  };

  const remember = (proposal: Proposal, rule: string, write: RuleWrite) => {
    const history = loadHistory();
    const existing = history.find((entry) => entry.id === proposal.id);
    if (existing) {
      existing.rule = rule;
      existing.scope = proposal.scope;
      existing.filePath = write.filePath;
    } else {
      history.push({ id: proposal.id, rule, at: Date.now(), scope: proposal.scope, filePath: write.filePath });
    }
    saveHistory(history);
  };

  const register = (proposal: Proposal, rule = proposal.rule) => {
    if (proposal.registered) removeRule(proposal.registered);
    const write = writeRule(proposal, rule);
    proposal.rule = rule;
    proposal.registered = write;
    remember(proposal, rule, write);
    codeLensChanged.fire();
    return write;
  };

  const rollback = (proposal: Proposal) => {
    if (!proposal.registered) return;
    removeRule(proposal.registered);
    proposal.registered = undefined;
    saveHistory(loadHistory().filter((entry) => entry.id !== proposal.id));
    codeLensChanged.fire();
  };

  const sessionFiles = () => {
    if (!currentSessionDir) return [];
    const allWorkspaces = configuration().get<boolean>("scanAllWorkspaces", false)
      || configuration().get<string>("scope", "currentWorkspace") === "allWorkspaces";
    if (!allWorkspaces) return listSessionFiles(currentSessionDir);
    const storageRoot = dirname(dirname(currentSessionDir));
    const files = readdirSync(storageRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .flatMap((entry) => listSessionFiles(join(storageRoot, entry.name, "chatSessions")));
    const unique = new Map(files.map((file) => [file.path, file]));
    unique.set(...(listSessionFiles(currentSessionDir).slice(0, 1).map((file) => [file.path, file] as const)[0] ?? ["", { path: "", mtimeMs: 0 }]));
    return [...unique.values()].filter((file) => file.path).sort((a, b) => b.mtimeMs - a.mtimeMs);
  };

  const collect = () => {
    const files = sessionFiles().slice(0, configuration().get<number>("maxSessions", 100));
    const corrections: Correction[] = [];
    let messageCount = 0;
    for (const file of files) {
      try {
        const session = loadSession(file.path);
        messageCount += Math.max(0, (session.requests?.length ?? 0) - 1);
        corrections.push(...detectCorrections(session, session.sessionId ?? basename(file.path, ".jsonl")));
      } catch {}
    }
    return { files, messageCount, corrections };
  };

  const evidenceFor = (cluster: FrictionCluster) => cluster.corrections.map((correction, index) => {
    const response = correction.previousResponse;
    return `### Evidence ${index + 1}\n- Session: ${correction.sessionId}\n- Correction: ${correction.text.replace(/\n/g, " ")}\n- AI output: ${response.outputCharacters} characters, ${response.codeBlockLines} code lines\n- Tools: ${response.toolNames.join(", ") || "none"}\n- Direct file references: ${response.directlyEditedFiles.join(", ") || "none"}`;
  }).join("\n\n");

  const reviewText = (proposal: Proposal) => `# Ne rule review\n\n- Scope: ${proposal.scope}\n- State: ${proposal.registered ? "registered; edits are reviewed before replacement" : "pending"}\n- Merge target: ${proposal.mergeTargetRule ?? "append a new rule"}\n\n## Proposed rule\n\n${RULE_START}\n${proposal.rule}\n${RULE_END}\n\n## Phenomenon\n\n${proposal.phenomenon}\n\n## Root cause\n\n${proposal.cause}\n\n## Evidence\n\n${proposal.evidence}\n`;

  const extractRule = (document: vscode.TextDocument) => {
    const text = document.getText();
    const start = text.indexOf(RULE_START);
    const end = text.indexOf(RULE_END);
    return start >= 0 && end > start ? text.slice(start + RULE_START.length, end).trim() : "";
  };

  const closeReview = async (uri?: vscode.Uri) => {
    if (!uri || vscode.window.activeTextEditor?.document.uri.toString() !== uri.toString()) return;
    await vscode.commands.executeCommand("workbench.action.revertAndCloseActiveEditor");
  };

  const openReview = async (proposal: Proposal) => {
    const document = await vscode.workspace.openTextDocument({ language: "markdown", content: reviewText(proposal) });
    proposal.documentUri = document.uri;
    proposals.set(document.uri.toString(), proposal);
    await vscode.window.showTextDocument(document, { preview: false });
    codeLensChanged.fire();
  };

  const autoRegister = (proposal: Proposal) => {
    if (proposal.documentUri || proposal.registered) return;
    try {
      register(proposal);
      vscode.window.setStatusBarMessage(`Ne: rule registered in ${proposal.scope}`, 5000);
    } catch (error) {
      vscode.window.showErrorMessage(`Ne: automatic registration failed: ${(error as Error).message}`);
    }
  };

  const propose = async (proposal: Proposal) => {
    const delaySeconds = configuration().get<number>("autoRegisterSeconds", 5);
    proposal.timer = setTimeout(() => autoRegister(proposal), delaySeconds * 1000);
    const action = await vscode.window.showInformationMessage(
      `Ne: ${proposal.rule} (${delaySeconds} seconds before automatic registration)`,
      "Review, edit, and register",
      "Ignore",
    );
    if (action === "Review, edit, and register") {
      if (proposal.timer) clearTimeout(proposal.timer);
      await openReview(proposal);
    } else if (action === "Ignore") {
      if (proposal.timer) clearTimeout(proposal.timer);
      rollback(proposal);
    }
  };

  class ProposalCodeLensProvider implements vscode.CodeLensProvider {
    readonly onDidChangeCodeLenses = codeLensChanged.event;
    provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
      const proposal = proposals.get(document.uri.toString());
      if (!proposal) return [];
      const marker = document.getText().split(/\r?\n/).findIndex((line) => line === RULE_END);
      const line = Math.max(0, marker);
      const range = new vscode.Range(line, 0, line, 0);
      return [
        new vscode.CodeLens(range, { title: "Confirm rule", command: "ne.review.confirm", arguments: [document.uri] }),
        new vscode.CodeLens(range, { title: "Ignore / rollback", command: "ne.review.ignore", arguments: [document.uri] }),
        new vscode.CodeLens(range, { title: `Switch to ${proposal.scope === "Global" ? "Workspace" : "Global"}`, command: "ne.review.switchScope", arguments: [document.uri] }),
        new vscode.CodeLens(range, { title: "Select merge target", command: "ne.review.mergeTarget", arguments: [document.uri] }),
      ];
    }
  }

  ctx.subscriptions.push(
    vscode.languages.registerCodeLensProvider({ language: "markdown", scheme: "untitled" }, new ProposalCodeLensProvider()),
    codeLensChanged,
    vscode.commands.registerCommand("ne.review.confirm", async (uri: vscode.Uri) => {
      const proposal = proposals.get(uri.toString());
      if (!proposal) return;
      const document = await vscode.workspace.openTextDocument(uri);
      const rule = extractRule(document);
      if (!rule) return vscode.window.showWarningMessage("Ne: the rule is empty.");
      register(proposal, rule);
      await closeReview(uri);
      vscode.window.setStatusBarMessage(`Ne: rule registered in ${proposal.scope}`, 5000);
    }),
    vscode.commands.registerCommand("ne.review.ignore", async (uri: vscode.Uri) => {
      const proposal = proposals.get(uri.toString());
      if (!proposal) return;
      rollback(proposal);
      await closeReview(uri);
    }),
    vscode.commands.registerCommand("ne.review.switchScope", async (uri: vscode.Uri) => {
      const proposal = proposals.get(uri.toString());
      if (!proposal) return;
      proposal.scope = proposal.scope === "Global" ? "Workspace" : "Global";
      proposal.mergeTargetRule = undefined;
      const document = await vscode.workspace.openTextDocument(uri);
      proposal.rule = extractRule(document) || proposal.rule;
      const edit = new vscode.WorkspaceEdit();
      edit.replace(uri, new vscode.Range(document.positionAt(0), document.positionAt(document.getText().length)), reviewText(proposal));
      await vscode.workspace.applyEdit(edit);
      codeLensChanged.fire();
    }),
    vscode.commands.registerCommand("ne.review.mergeTarget", async (uri: vscode.Uri) => {
      const proposal = proposals.get(uri.toString());
      if (!proposal) return;
      const target = targetFile(proposal.scope);
      const rules = target && existsSync(target) ? ruleLines(readFileSync(target, "utf8")) : [];
      if (rules.length === 0) return vscode.window.showInformationMessage("Ne: no existing rule is available in this scope.");
      const selected = await vscode.window.showQuickPick(rules, { placeHolder: "Select the rule to replace" });
      if (!selected) return;
      proposal.mergeTargetRule = selected;
      codeLensChanged.fire();
    }),
    vscode.commands.registerCommand("ne.measure", () => {
      if (!currentSessionDir || !diagnose(currentSessionDir).ok) return vscode.window.showWarningMessage("チャット保存ファイルを読めない。");
      const collected = collect();
      const clusters = clusterCorrections(collected.corrections);
      const repeated = clusters.filter((cluster) => cluster.uniqueSessions >= configuration().get<number>("minimumSessions", 2));
      vscode.window.showInformationMessage(`Scanned ${collected.files.length} chats and ${collected.messageCount} messages. Detected ${collected.corrections.length} corrections; ${repeated.length} repeated clusters across different sessions.`);
    }),
    vscode.commands.registerCommand("ne.analyze", async () => {
      if (!currentSessionDir || !diagnose(currentSessionDir).ok) return vscode.window.showWarningMessage("チャット保存ファイルを読めない。");
      const collected = collect();
      const minimumSessions = configuration().get<number>("minimumSessions", 2);
      const clusters = clusterCorrections(collected.corrections).filter((cluster) => cluster.uniqueSessions >= minimumSessions).sort((a, b) => b.uniqueSessions - a.uniqueSessions);
      if (clusters.length === 0) return vscode.window.showInformationMessage(`No correction repeated across ${minimumSessions} different chat sessions was found.`);
      const cluster = clusters[0];
      const ok = await vscode.window.showWarningMessage(
        `Send ${cluster.corrections.length} correction examples from ${cluster.uniqueSessions} sessions to the selected language model?`,
        { modal: true },
        "Send",
      );
      if (!ok) return;
      const prompt = `Analyze repeated corrections as: surface instruction -> root cause -> actionable rule. Return only JSON with non-empty string fields rule, phenomenon, and cause. Separate the observed user instruction from the inferred process or design failure. The cause must be supported by the evidence and distinguish implementation ordering, change scope, and environment/type/dependency diagnosis where applicable. The rule must state a concrete action or check, not merely repeat the user's phrase. Include output size, code lines, tools, edited files, and cross-session repetition in the causal reasoning.\n\n${evidenceFor(cluster)}`;
      let parsed: RuleProposal;
      try {
        parsed = parseRuleProposal(await askModel(prompt, new vscode.CancellationTokenSource().token));
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown error";
        return vscode.window.showWarningMessage(`Ne: the rule proposal was invalid (${message}). No rule was registered.`);
      }
      await propose({
        id: String(Date.now()),
        rule: parsed.rule,
        phenomenon: parsed.phenomenon,
        cause: parsed.cause,
        evidence: evidenceFor(cluster),
        scope: configuration().get<string>("defaultScope", "Global") === "Workspace" ? "Workspace" : "Global",
      });
    }),
    vscode.commands.registerCommand("ne.undo", async () => {
      const history = loadHistory();
      if (history.length === 0) return vscode.window.showInformationMessage("Ne: no registration history exists.");
      const selected = await vscode.window.showQuickPick(history.slice().reverse().map((entry) => ({ label: entry.rule, description: `${entry.scope} · ${entry.filePath}`, id: entry.id })), { placeHolder: "Select a rule to undo" });
      if (!selected) return;
      const entry = history.find((item) => item.id === selected.id);
      if (entry && existsSync(entry.filePath)) removeRule({ filePath: entry.filePath, rule: entry.rule });
      saveHistory(history.filter((item) => item.id !== selected.id));
      vscode.window.setStatusBarMessage("Ne: rule removed", 5000);
    }),
  );
}

export function deactivate() {}
