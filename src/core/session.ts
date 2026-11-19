// Copilot Chatのchatセッション(.jsonl)を復元する。形式は非公開で、実機(VS Code 1.147 / Copilot Chat 0.75)の観測に基づく。
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

export type Json = any;

export class SessionFormatError extends Error {}

/** kind0=全体設定、kind1=pathの値を置換、kind2=pathの配列へ追加(iがあればその位置から置換)。 */
export function replaySession(text: string): Json {
  let root: Json;
  let n = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    n++;
    let op: Json;
    try {
      op = JSON.parse(line);
    } catch {
      throw new SessionFormatError(`${n}行目がJSONではない`);
    }
    if (op.kind === 0) {
      root = op.v;
    } else if (op.kind === 1 || op.kind === 2) {
      if (root === undefined || !Array.isArray(op.k)) throw new SessionFormatError(`${n}行目: 先頭がkind0ではない/kが配列ではない`);
      const parent = op.k.slice(0, -1).reduce((o: Json, key: string | number) => o?.[key], root);
      const last = op.k[op.k.length - 1];
      if (parent === undefined || parent === null) throw new SessionFormatError(`${n}行目: 親が存在しない`);
      if (op.kind === 1) {
        parent[last] = op.v;
      } else {
        if (!Array.isArray(parent[last])) parent[last] = [];
        // vがない行(例: pendingRequestsのi=0)は、位置i以降の削除を表す。
        const items: Json[] = op.v ?? [];
        if (typeof op.i === "number") parent[last].splice(op.i, parent[last].length - op.i, ...items);
        else parent[last].push(...items);
      }
    } else {
      throw new SessionFormatError(`${n}行目: 未知のkind=${op.kind}`);
    }
  }
  if (root === undefined) throw new SessionFormatError("空のファイル");
  return root;
}

export interface SessionFile {
  path: string;
  mtimeMs: number;
}

export function listSessionFiles(chatSessionsDir: string): SessionFile[] {
  if (!existsSync(chatSessionsDir)) return [];
  return readdirSync(chatSessionsDir)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => {
      const path = join(chatSessionsDir, f);
      return { path, mtimeMs: statSync(path).mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
}

export function loadSession(path: string): Json {
  return replaySession(readFileSync(path, "utf8"));
}

export function userText(request: Json): string {
  const m = request?.message;
  if (typeof m?.text === "string") return m.text;
  if (Array.isArray(m?.parts)) return m.parts.map((p: Json) => p.text ?? "").join("");
  return "";
}

/** 応答の本文(markdown要素)だけを連結する。 */
export function responseText(request: Json): string {
  const items: Json[] = Array.isArray(request?.response) ? request.response : [];
  return items
    .map((i) => (typeof i?.value === "string" && (i.kind === undefined || i.kind === "markdownContent") ? i.value : i?.content?.value ?? ""))
    .join("");
}
