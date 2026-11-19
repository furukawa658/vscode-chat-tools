import { Json, userText } from "../core/session";

// 通常の依頼に頻出する語(だけ・必ず・先に・only)は誤検知が多いため含めない。
const CUES = [/そうじゃない/, /違う(?:よ|って|です)/, /やり直/, /しないで/, /ではなく/, /って言った/, /勝手に/, /何度も/, /また(?:同じ|間違)/, /\bI said\b/i, /\bdon'?t\b/i, /\bnot what I\b/i];

export interface Correction {
  text: string;
  cue: string;
}

export function detectCorrections(session: Json): Correction[] {
  const out: Correction[] = [];
  const reqs: Json[] = session?.requests ?? [];
  // 最初の発話は依頼であり修正指示ではない。
  for (let i = 1; i < reqs.length; i++) {
    const t = userText(reqs[i]);
    const c = CUES.find((re) => re.test(t));
    if (c) out.push({ text: t.slice(0, 400), cue: c.source });
  }
  return out;
}

/** 修正指示と応答の重複を除いた同一内容の再発回数。 */
export function countRecurrence(corrections: Correction[], ruleText: string): number {
  const words = ruleText.split(/[\s、。]+/).filter((w) => w.length >= 3);
  if (words.length === 0) return 0;
  return corrections.filter((c) => words.some((w) => c.text.includes(w))).length;
}
