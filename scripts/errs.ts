import { listSessionFiles, loadSession } from "../src/core/session";
const d = process.env.APPDATA + "/Code/User/workspaceStorage/d55a910a560f4e8fd1f0dd01c9a78e39/chatSessions";
const c: Record<string, number> = {};
let ex = "";
for (const f of listSessionFiles(d)) {
  try { loadSession(f.path); } catch (e) { const m = (e as Error).message.replace(/^\d+行目/, "N行目"); c[m] = (c[m] ?? 0) + 1; ex ||= f.path; }
}
console.log(JSON.stringify(c, null, 1), ex);
