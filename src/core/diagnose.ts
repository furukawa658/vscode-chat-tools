import { listSessionFiles, loadSession } from "./session";

export interface Diagnosis {
  ok: boolean;
  message: string;
}

/** 保存形式が想定どおりか検査する。失敗時は機能を止める側が使う。 */
export function diagnose(chatSessionsDir: string): Diagnosis {
  const files = listSessionFiles(chatSessionsDir);
  if (files.length === 0) return { ok: false, message: "チャット保存ファイルが見つからない" };
  try {
    const s = loadSession(files[0].path);
    if (!Array.isArray(s?.requests)) return { ok: false, message: "requests配列がない" };
    return { ok: true, message: "保存形式を読めた" };
  } catch (e) {
    return { ok: false, message: `読み取り失敗: ${(e as Error).message}` };
  }
}
