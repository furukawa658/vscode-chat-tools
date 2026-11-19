import { describe, expect, test } from "bun:test";
import { calculateSessionCreditDelta, hasUnmeasuredCompletedRequest, isBudgetReached, snapshotSessionCredits } from "../src/eien/budget";

describe("eien credit circuit breaker", () => {
  test("開始前からあったリクエストは開始後の増分だけを数える", () => {
    const baseline = snapshotSessionCredits({
      requests: [
        { requestId: "existing", copilotCredits: 4 },
        { requestId: "without-credits" },
      ],
    });

    const consumed = calculateSessionCreditDelta({
      requests: [
        { requestId: "existing", copilotCredits: 4.75 },
        { requestId: "without-credits" },
        { requestId: "new", copilotCredits: 2.25 },
      ],
    }, baseline);

    expect(consumed).toBe(3);
  });

  test("新規リクエストのクレジットが未確定でも既知の消費量は保持する", () => {
    const consumed = calculateSessionCreditDelta({
      requests: [
        { requestId: "complete", copilotCredits: 1.5 },
        { requestId: "streaming", modelState: { value: 0 } },
      ],
    }, {});

    expect(consumed).toBe(1.5);
  });

  test("開始直後のリクエストを基準取得中に保存しても全量を数える", () => {
    const consumed = calculateSessionCreditDelta({
      requests: [
        { requestId: "existing", timestamp: 99, copilotCredits: 4.5 },
        { requestId: "race", timestamp: 100, copilotCredits: 2 },
      ],
    }, { existing: 4, race: 2 }, 100);

    expect(consumed).toBe(2.5);
  });

  test("小数の予算も上限到達で遮断する", () => {
    expect(isBudgetReached(2.49, 2.5)).toBe(false);
    expect(isBudgetReached(2.5, 2.5)).toBe(true);
  });

  test("開始後に完了したがクレジット値がないリクエストを失敗安全に検出する", () => {
    const requests = { requests: [
      { timestamp: 99, modelState: { value: 1 } },
      { timestamp: 100, modelState: { value: 0 } },
      { timestamp: 101, modelState: { value: 1 } },
      { timestamp: 102, modelState: { value: 1 }, copilotCredits: 1.25 },
    ] };

    expect(hasUnmeasuredCompletedRequest(requests, 100)).toBe(true);
    expect(hasUnmeasuredCompletedRequest({ requests: requests.requests.filter((request) => request.timestamp !== 101) }, 100)).toBe(false);
  });
});
