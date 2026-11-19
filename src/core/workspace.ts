import * as vscode from "vscode";
import { dirname, join } from "node:path";

/** context.storageUri = workspaceStorage/<hash>/<拡張ID>。親がチャット保存先の親になる。 */
export function chatSessionsDir(ctx: vscode.ExtensionContext): string | undefined {
  const s = ctx.storageUri ?? ctx.globalStorageUri;
  if (!ctx.storageUri) return undefined;
  return join(dirname(s.fsPath), "chatSessions");
}

export function workspaceFolders(): string[] {
  return (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
}

export async function sendToNewChat(text: string, submit: boolean): Promise<void> {
  await vscode.commands.executeCommand("workbench.action.chat.newChat");
  await vscode.commands.executeCommand("workbench.action.chat.open", { query: text, isPartialQuery: !submit });
}

export async function sendToCurrentChat(text: string): Promise<void> {
  await vscode.commands.executeCommand("workbench.action.chat.open", { query: text });
}

export async function askModel(prompt: string, token: vscode.CancellationToken): Promise<string> {
  const models = await vscode.lm.selectChatModels({});
  if (models.length === 0) throw new Error("利用できる言語モデルがない");
  const res = await models[0].sendRequest([vscode.LanguageModelChatMessage.User(prompt)], {}, token);
  let out = "";
  for await (const part of res.text) out += part;
  return out;
}
