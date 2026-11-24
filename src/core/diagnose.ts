import { listSessionFiles, loadSession } from "./session";

export interface Diagnosis {
  ok: boolean;
  message: string;
}

/** 保存形式が想定どおりか検査する。失敗時は機能を止める側が使う。 */
export function diagnose(chatSessionsDir: string, selectedPath?: string): Diagnosis {
  const files = listSessionFiles(chatSessionsDir);
  if (files.length === 0) return { ok: false, message: "チャット保存ファイルが見つからない" };
  try {
    const s = loadSession(selectedPath ?? files[0].path);
    if (!Array.isArray(s?.requests)) return { ok: false, message: "requests配列がない" };
    const hasTokens = s.requests.some((request: { promptTokens?: unknown }) => typeof request?.promptTokens === "number");
    if (!hasTokens) return { ok: false, message: "promptTokensがない。Developer: Set Log Level... でGitHub Copilot ChatをDebugまたはTraceに設定する" };
    return { ok: true, message: "保存形式とトークン情報を読めた" };
  } catch (e) {
    return { ok: false, message: `読み取り失敗: ${(e as Error).message}` };
  }
}
