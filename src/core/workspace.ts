import * as vscode from "vscode";
import { dirname, join } from "node:path";
import { Json } from "./session";
import { chatSelection } from "./usage";

export interface ChatLaunchSelection {
  mode: string;
  modelSelector?: { id: string; vendor: string; family: string };
}

/** context.storageUri = workspaceStorage/<hash>/<拡張ID>。親がチャット保存先の親になる。 */
export function chatSessionsDir(ctx: vscode.ExtensionContext): string | undefined {
  const s = ctx.storageUri ?? ctx.globalStorageUri;
  if (!ctx.storageUri) return undefined;
  return join(dirname(s.fsPath), "chatSessions");
}

export function workspaceFolders(): string[] {
  return (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
}

export async function resolveChatLaunchSelection(session: Json): Promise<ChatLaunchSelection> {
  const saved = chatSelection(session);
  const models = await vscode.lm.selectChatModels({});
  const compactId = saved.modelId.includes("/") ? saved.modelId.split("/").at(-1) : saved.modelId;
  const model = models.find((candidate) => candidate.id === saved.modelId || candidate.id === compactId || `${candidate.vendor}/${candidate.id}` === saved.modelId);
  return {
    mode: saved.mode || "agent",
    modelSelector: model ? { id: model.id, vendor: model.vendor, family: model.family } : undefined,
  };
}

export async function sendToNewChat(text: string, submit: boolean, selection?: ChatLaunchSelection): Promise<void> {
  await vscode.commands.executeCommand("workbench.action.chat.newChat");
  await vscode.commands.executeCommand("workbench.action.chat.open", {
    query: text,
    isPartialQuery: !submit,
    mode: selection?.mode,
    modelSelector: selection?.modelSelector,
  });
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
