import { Json } from "../core/session";

export type CreditBaseline = Record<string, number>;

function requestKey(request: Json, index: number): string {
  if (typeof request?.requestId === "string" && request.requestId) return request.requestId;
  if (typeof request?.timestamp === "number") return `timestamp:${request.timestamp}`;
  return `index:${index}`;
}

export function snapshotSessionCredits(session: Json): CreditBaseline {
  const baseline: CreditBaseline = {};
  for (const [index, request] of (session?.requests ?? []).entries()) {
    if (typeof request?.copilotCredits !== "number" || !Number.isFinite(request.copilotCredits)) continue;
    baseline[requestKey(request, index)] = request.copilotCredits;
  }
  return baseline;
}

export function calculateSessionCreditDelta(session: Json, baseline: CreditBaseline, sinceTimestamp?: number): number {
  let consumed = 0;
  for (const [index, request] of (session?.requests ?? []).entries()) {
    if (typeof request?.copilotCredits !== "number" || !Number.isFinite(request.copilotCredits)) continue;
    const startedAfterMonitoring = sinceTimestamp !== undefined && typeof request?.timestamp === "number" && request.timestamp >= sinceTimestamp;
    const previous = startedAfterMonitoring ? 0 : baseline[requestKey(request, index)] ?? 0;
    consumed += Math.max(0, request.copilotCredits - previous);
  }
  return consumed;
}

export function hasUnmeasuredCompletedRequest(session: Json, sinceTimestamp: number): boolean {
  return (session?.requests ?? []).some((request: Json) => {
    if (typeof request?.timestamp !== "number" || request.timestamp < sinceTimestamp) return false;
    if (request?.modelState?.value === 0) return false;
    return typeof request?.copilotCredits !== "number" || !Number.isFinite(request.copilotCredits);
  });
}

export function isBudgetReached(consumed: number, budget: number): boolean {
  return budget > 0 && consumed >= budget;
}
