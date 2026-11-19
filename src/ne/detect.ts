import { Json, responseText, userText } from "../core/session";

const CUES = [/そうじゃない/, /違う(?:よ|って|です)/, /やり直/, /しないで/, /ではなく/, /って言った/, /勝手に/, /何度も/, /また(?:同じ|間違)/, /\bI said\b/i, /\bdon'?t\b/i, /\bnot what I\b/i];

export interface AiResponseSummary {
  outputCharacters: number;
  codeBlockLines: number;
  toolNames: string[];
  directlyEditedFiles: string[];
}

export interface Correction {
  text: string;
  cue: string;
  sessionId: string;
  previousResponse: AiResponseSummary;
}

export interface FrictionCluster {
  cue: string;
  corrections: Correction[];
  uniqueSessions: number;
}

function editedFiles(parts: Json[]): string[] {
  const files = new Set<string>();
  for (const part of parts) {
    if (part?.kind !== "toolInvocationSerialized") continue;
    const toolId = String(part?.toolId ?? "").toLowerCase();
    if (!/(edit|replace|write|create|patch)/.test(toolId)) continue;
    for (const value of Object.values(part?.invocationMessage?.uris ?? {})) {
      const path = (value as Json)?.path;
      if (typeof path === "string") files.add(path.replace(/^\/[a-z]:/i, (match) => match.slice(1)));
    }
  }
  return [...files];
}

export function summarizeAiResponse(request: Json): AiResponseSummary {
  const text = responseText(request);
  const codeBlockLines = [...text.matchAll(/```[^\n]*\n([\s\S]*?)```/g)]
    .reduce((total, match) => total + match[1].split(/\r?\n/).filter(Boolean).length, 0);
  const parts: Json[] = request?.response ?? [];
  return {
    outputCharacters: text.length,
    codeBlockLines,
    toolNames: [...new Set<string>(parts.filter((part) => part?.kind === "toolInvocationSerialized" && part?.toolId).map((part) => part.toolId))],
    directlyEditedFiles: editedFiles(parts),
  };
}

export function detectCorrections(session: Json, sessionId = session?.sessionId ?? "unknown"): Correction[] {
  const out: Correction[] = [];
  const requests: Json[] = session?.requests ?? [];
  for (let index = 1; index < requests.length; index++) {
    const text = userText(requests[index]);
    const cue = CUES.find((pattern) => pattern.test(text));
    if (cue) {
      out.push({
        text: text.slice(0, 400),
        cue: cue.source,
        sessionId: String(sessionId),
        previousResponse: summarizeAiResponse(requests[index - 1]),
      });
    }
  }
  return out;
}

export function clusterCorrections(corrections: Correction[]): FrictionCluster[] {
  const groups = new Map<string, Correction[]>();
  for (const correction of corrections) {
    const key = correction.cue;
    groups.set(key, [...(groups.get(key) ?? []), correction]);
  }
  return [...groups.entries()].map(([cue, items]) => ({
    cue,
    corrections: items,
    uniqueSessions: new Set(items.map((item) => item.sessionId)).size,
  }));
}

/** 修正指示と応答の重複を除いた同一内容の再発回数。 */
export function countRecurrence(corrections: Correction[], ruleText: string): number {
  const words = ruleText.split(/[\s、。]+/).filter((word) => word.length >= 3);
  if (words.length === 0) return 0;
  return corrections.filter((correction) => words.some((word) => correction.text.includes(word))).length;
}
