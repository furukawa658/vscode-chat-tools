import * as vscode from "vscode";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

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
  const databasePath = join(storagePath, "state.sqlite");
  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? storagePath;
  const allowedCommands = vscode.workspace.getConfiguration("makaseru").get<string>("allowedCommands", "cargo,npm,bun,pnpm,yarn,dotnet,pytest,python,go,git");

  const provider = {
    provideMcpServerDefinitions() {
      const Definition = (vscode as unknown as { McpStdioServerDefinition: new (label: string, command: string, args?: string[], env?: Record<string, string | number | null>, version?: string) => unknown }).McpStdioServerDefinition;
      return [new Definition(
        "Makaseru MCP - Task Handoff & Verification",
        process.execPath,
        [serverPath, "--workspace", workspaceRoot, "--db", databasePath],
        { ELECTRON_RUN_AS_NODE: "1", MAKASERU_ALLOWED_CMDS: allowedCommands, MAKASERU_SQL_WASM_PATH: wasmPath },
        "0.1.0",
      )];
    },
  };

  ctx.subscriptions.push(lm.registerMcpServerDefinitionProvider("shunsukef.makaseru-mcp", provider));
  const bar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 99);
  bar.text = "$(git-compare) Makaseru";
  bar.tooltip = "Makaseru MCP is available to delegate, pause, verify, and collect lightweight-agent tasks.";
  bar.command = "makaseru.showStatus";
  bar.show();
  ctx.subscriptions.push(bar, vscode.commands.registerCommand("makaseru.showStatus", async () => {
    await vscode.window.showInformationMessage("Makaseru MCP: use the makaseru_* tools in Copilot Chat agent mode.");
  }));
}

export function deactivate() {}
