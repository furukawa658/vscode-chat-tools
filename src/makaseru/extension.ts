import * as vscode from "vscode";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { readWorkspaceStatus, statusText, workspaceDatabasePath, workspaceHash, workspaceLabel } from "./status";

interface McpProviderApi {
  registerMcpServerDefinitionProvider(id: string, provider: object): vscode.Disposable;
}

export function activate(ctx: vscode.ExtensionContext) {
  const lm = vscode.lm as unknown as McpProviderApi;
  const serverPath = join(ctx.extensionUri.fsPath, "dist", "mcp-server.js");
  const wasmPath = join(ctx.extensionUri.fsPath, "dist", "sql-wasm.wasm");
  if (!existsSync(serverPath) || !existsSync(wasmPath)) {
    void vscode.window.showErrorMessage("Makaseru MCP could not start because its packaged server files are missing. Reinstall the extension.");
    return;
  }
  const storagePath = ctx.globalStorageUri.fsPath;
  mkdirSync(storagePath, { recursive: true });
  const workspaceRoots = vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath) ?? [storagePath];
  const databases = workspaceRoots.map((workspaceRoot) => ({
    workspaceRoot,
    databasePath: workspaceDatabasePath(storagePath, workspaceRoot),
  }));
  const allowedCommands = vscode.workspace.getConfiguration("makaseru").get<string>("allowedCommands", "cargo,npm,bun,pnpm,yarn,dotnet,pytest,python,go,git");

  const provider = {
    provideMcpServerDefinitions() {
      const Definition = (vscode as unknown as { McpStdioServerDefinition: new (label: string, command: string, args?: string[], env?: Record<string, string | number | null>, version?: string) => unknown }).McpStdioServerDefinition;
      return databases.map(({ workspaceRoot, databasePath }) => new Definition(
        `Makaseru MCP - ${workspaceLabel(workspaceRoot)} (${workspaceHash(workspaceRoot).slice(0, 6)})`,
        process.execPath,
        [serverPath, "--workspace", workspaceRoot, "--db", databasePath],
        { ELECTRON_RUN_AS_NODE: "1", MAKASERU_ALLOWED_CMDS: allowedCommands, MAKASERU_SQL_WASM_PATH: wasmPath },
        "0.2.1",
      ));
    },
  };

  ctx.subscriptions.push(lm.registerMcpServerDefinitionProvider("shunsukef.makaseru-mcp", provider));
  const bar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
  const refreshStatus = () => {
    const statuses = databases.map(({ workspaceRoot, databasePath }) => readWorkspaceStatus(databasePath, workspaceRoot));
    bar.text = statusText(statuses);
    bar.tooltip = statuses.map((status) => {
      const attention = `Q:${status.waitingParent} R:${status.needsParentReview} E:${status.escalated}`;
      return `${workspaceLabel(status.workspaceRoot)} (${status.workspaceHash.slice(0, 6)}): ${attention}`;
    }).join("\n");
  };
  refreshStatus();
  const timer = setInterval(refreshStatus, 2_000);
  bar.tooltip = bar.tooltip || "Makaseru MCP has no pending tasks.";
  bar.command = "makaseru.showStatus";
  bar.show();
  ctx.subscriptions.push(bar, { dispose: () => clearInterval(timer) }, vscode.commands.registerCommand("makaseru.showStatus", async () => {
    const statuses = databases.map(({ workspaceRoot, databasePath }) => readWorkspaceStatus(databasePath, workspaceRoot));
    await vscode.window.showInformationMessage(statuses.map((status) =>
      `${workspaceLabel(status.workspaceRoot)}: questions ${status.waitingParent}, reviews ${status.needsParentReview}, escalated ${status.escalated}`,
    ).join("\n"));
  }));
}

export function deactivate() {}
