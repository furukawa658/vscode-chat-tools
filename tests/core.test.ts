import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findSessionFile, replaySession, SessionFormatError, sessionFileId } from "../src/core/session";
import { chatSelection, computeUsage, lastRequestState } from "../src/core/usage";
import { diagnose } from "../src/core/diagnose";
import { clusterCorrections, detectCorrections, parseRuleProposal, summarizeAiResponse } from "../src/ne/detect";
import { buildHandoff } from "../src/core/handoff";
import { buildSplitHandoff, parseSplitTasks } from "../src/core/split";

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
  test("選択したセッションIDを更新順から独立して解決する", () => {
    const files = [
      { path: join("storage", "chat-b.jsonl"), mtimeMs: 200 },
      { path: join("storage", "chat-a.jsonl"), mtimeMs: 100 },
    ];
    expect(sessionFileId(files[0].path)).toBe("chat-b");
    expect(findSessionFile(files, "chat-a")).toBe(files[1]);
    expect(findSessionFile(files, "missing")).toBeUndefined();
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
    const invalidPath = join(d, "a.jsonl");
    writeFileSync(invalidPath, L({ kind: 7 }));
    expect(diagnose(d).ok).toBe(false);
    const validPath = join(d, "b.jsonl");
    writeFileSync(validPath, sample);
    expect(diagnose(d).ok).toBe(true);
    expect(diagnose(d, invalidPath).ok).toBe(false);
    expect(diagnose(d, validPath.replaceAll("\\", "/")).ok).toBe(true);
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
  test("根本原因と実行可能なルールを検証する", () => {
    expect(parseRuleProposal(JSON.stringify({
      rule: "修正前にエラーを環境・型・依存関係の3軸で切り分ける",
      phenomenon: "同じエラーが再発している",
      cause: "エラーメッセージだけで推測修正している",
    })).rule).toContain("環境・型・依存関係");
    expect(() => parseRuleProposal('{"rule":"anyを使わないで","phenomenon":"型不足"}')).toThrow();
  });
});

describe("handoff", () => {
  test("最初の依頼と状態を含む", () => {
    const t = buildHandoff(replaySession(sample), "STATUS");
    expect(t).toContain("最初の依頼");
    expect(t).toContain("STATUS");
  });

  test("上限超過でも作業ツリーの状態を残す", () => {
    const t = buildHandoff(replaySession(sample), "STATUS", 120);
    expect(t).toContain("STATUS");
    expect(t.length).toBeLessThanOrEqual(120);
  });

  test("分割案を型検証しタスク固有の引き継ぎを作る", () => {
    const tasks = parseSplitTasks(JSON.stringify([{
      title: "共通関数を整理",
      goal: "型境界を一箇所へ寄せる",
      context: "src/core/split.ts の入力検証を分離する",
      relevantFiles: ["src/core/split.ts"],
      decisions: ["外部入力は unknown で受ける"],
      acceptanceChecks: ["bun test tests/core.test.ts"],
    }]));
    expect(tasks).toHaveLength(1);
    expect(() => parseSplitTasks('[{"title":"broken","goal":"x","context":4}]')).toThrow();
    const session = replaySession(L({
      kind: 0,
      v: { requests: [
        { message: { text: "共通関数の入力検証を整理する" }, response: [{ kind: "markdownContent", value: "src/core/split.ts を分ける" }] },
        { message: { text: "別のバグも直す" }, response: [{ kind: "markdownContent", value: "無関係な修正" }] },
      ] },
    }));
    const handoff = buildSplitHandoff(session, tasks[0], "src/core/split.ts | 3 +++");
    expect(handoff).toContain("外部入力は unknown で受ける");
    expect(handoff).toContain("src/core/split.ts を分ける");
    expect(handoff).not.toContain("別のバグも直す");
  });
});

