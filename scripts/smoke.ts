import { listSessionFiles, loadSession } from "../src/core/session";
import { computeUsage, lastRequestState } from "../src/core/usage";
import { detectCorrections } from "../src/ne/detect";
const d = process.env.APPDATA + "/Code/User/workspaceStorage/d55a910a560f4e8fd1f0dd01c9a78e39/chatSessions";
let ok = 0, bad = 0, total = 0, hit = 0;
for (const f of listSessionFiles(d)) {
  try { const s = loadSession(f.path); ok++; total += Math.max(0, s.requests.length - 1); hit += detectCorrections(s).length; } catch { bad++; }
}
console.log(JSON.stringify({ ok, bad, total, hit }));
const s = loadSession(listSessionFiles(d)[0].path);
console.log(JSON.stringify(computeUsage(s)), lastRequestState(s));
