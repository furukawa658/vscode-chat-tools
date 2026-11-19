import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { replaySession, SessionFormatError } from "../src/core/session";
import { chatSelection, computeUsage, lastRequestState } from "../src/core/usage";
import { diagnose } from "../src/core/diagnose";
import { clusterCorrections, detectCorrections, summarizeAiResponse } from "../src/ne/detect";
import { buildHandoff } from "../src/core/handoff";

const L = (...o: object[]) => o.map((x) => JSON.stringify(x)).join("\n");
const sample = L(
  { kind: 0, v: { requests: [] } },
  { kind: 2, k: ["requests"], v: [{ message: { text: "最初の依頼" }, modelId: "m", modelConfiguration: { contextSize: 200000 } }] },
  { kind: 1, k: ["requests", 0, "promptTokens"], v: 100000 },
  { kind: 1, k: ["requests", 0, "modelState"], v: { value: 0 } },
  { kind: 2, k: ["requests"], v: [{ message: { text: "そうじゃない、やり直して" }, modelState: { value: 1 } }] },
);

describe("session", () => {
  test("差分を復元する", () => {
    const s = replaySession(sample);
    expect(s.requests.length).toBe(2);
    expect(s.requests[0].promptTokens).toBe(100000);
  });
  test("iを指定した追加は置換する", () => {
    const s = replaySession(L({ kind: 0, v: { requests: [{ response: [1, 2, 3] }] } }, { kind: 2, k: ["requests", 0, "response"], v: [9], i: 1 }));
    expect(s.requests[0].response).toEqual([1, 9]);
  });
  test("vなしのkind2は位置i以降を削除する", () => {
    const s = replaySession(L({ kind: 0, v: { pendingRequests: [1, 2] } }, { kind: 2, k: ["pendingRequests"], i: 0 }));
    expect(s.pendingRequests).toEqual([]);
  });
  test("形式違反はエラー", () => {
    expect(() => replaySession(L({ kind: 9 }))).toThrow(SessionFormatError);
    expect(() => replaySession("not json")).toThrow(SessionFormatError);
  });
  test("使用率と状態", () => {
    const s = replaySession(sample);
    expect(computeUsage(s)?.ratio).toBeCloseTo(0.5);
    expect(lastRequestState(s)).toBe("complete");
  });
  test("最新ターンのpromptとcompletionだけを使う", () => {
    const sessionText = L({
      kind: 0,
      v: {
        requests: [
          { promptTokens: 90000, completionTokens: 5000, modelConfiguration: { contextSize: 200000 } },
          {
            promptTokens: 110000,
            completionTokens: 2000,
            modelId: "copilot/example",
            modeInfo: { kind: "agent" },
            modelConfiguration: { contextSize: 200000 },
            response: [{ kind: "toolInvocationSerialized", toolId: "run_in_terminal" }],
          },
        ],
        inputState: { mode: { kind: "ask" } },
      },
    });
    const s = replaySession(sessionText);
    const usage = computeUsage(s);
    expect(usage?.occupiedTokens).toBe(112000);
    expect(usage?.ratio).toBeCloseTo(0.56);
    expect(usage?.toolNames).toEqual(["run_in_terminal"]);
    expect(chatSelection(s)).toEqual({ modelId: "copilot/example", mode: "agent" });
  });
});

describe("diagnose", () => {
  test("形式が違うデータで失敗を返す", () => {
    const d = mkdtempSync(join(tmpdir(), "chat-"));
    writeFileSync(join(d, "a.jsonl"), L({ kind: 7 }));
    expect(diagnose(d).ok).toBe(false);
    writeFileSync(join(d, "b.jsonl"), sample);
    expect(diagnose(d).ok).toBe(true);
  });
});

describe("ne", () => {
  test("最初の発話は対象外、通常依頼は誤検知しない", () => {
    const s = replaySession(L({ kind: 0, v: { requests: [{ message: { text: "そうじゃない" } }, { message: { text: "これだけ必ず先に実装して" } }, { message: { text: "勝手に消さないで" } }] } }));
    expect(detectCorrections(s).map((c) => c.text)).toEqual(["勝手に消さないで"]);
  });
  test("同一セッションの連投を別セッション反復と数えない", () => {
    const first = replaySession(L({ kind: 0, v: { sessionId: "a", requests: [{ message: { text: "start" } }, { message: { text: "勝手に消さないで" } }, { message: { text: "勝手に消さないで" } }] } }));
    const second = replaySession(L({ kind: 0, v: { sessionId: "b", requests: [{ message: { text: "start" } }, { message: { text: "勝手に消さないで" } }] } }));
    const cluster = clusterCorrections([...detectCorrections(first), ...detectCorrections(second)])[0];
    expect(cluster.corrections).toHaveLength(3);
    expect(cluster.uniqueSessions).toBe(2);
  });
  test("AI応答の量、コード行、ツール、編集ファイルを要約する", () => {
    const summary = summarizeAiResponse({ response: [
      { kind: "markdownContent", value: "hello\n```ts\na()\nb()\n```" },
      { kind: "toolInvocationSerialized", toolId: "edit_file", invocationMessage: { uris: { first: { path: "/c:/repo/a.ts" } } } },
    ] });
    expect(summary.codeBlockLines).toBe(2);
    expect(summary.outputCharacters).toBeGreaterThan(0);
    expect(summary.toolNames).toEqual(["edit_file"]);
    expect(summary.directlyEditedFiles).toEqual(["c:/repo/a.ts"]);
  });
});

describe("handoff", () => {
  test("最初の依頼と状態を含む", () => {
    const t = buildHandoff(replaySession(sample), "STATUS");
    expect(t).toContain("最初の依頼");
    expect(t).toContain("STATUS");
  });
});

