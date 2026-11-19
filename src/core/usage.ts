import { Json } from "./session";

export interface Usage {
  promptTokens: number;
  contextSize: number;
  ratio: number;
  modelId: string;
}

/** 最後のリクエストのpromptTokensを現在のコンテキスト使用量とみなす(実機で値の増加を確認済み、厳密な意味は未確認)。 */
export function computeUsage(session: Json): Usage | undefined {
  const reqs: Json[] = session?.requests ?? [];
  for (let i = reqs.length - 1; i >= 0; i--) {
    const r = reqs[i];
    if (typeof r?.promptTokens !== "number") continue;
    const size =
      r.modelConfiguration?.contextSize ??
      session?.inputState?.selectedModel?.metadata?.maxInputTokens ??
      0;
    if (!size) return undefined;
    return { promptTokens: r.promptTokens, contextSize: size, ratio: r.promptTokens / size, modelId: r.modelId ?? "" };
  }
  return undefined;
}

export type StopReason = "streaming" | "complete" | "cancelled" | "unknown";

/** modelState.value: 0=処理中, 1=完了, 2=中断(観測値)。 */
export function lastRequestState(session: Json): StopReason {
  const reqs: Json[] = session?.requests ?? [];
  const v = reqs[reqs.length - 1]?.modelState?.value;
  if (v === 0) return "streaming";
  if (v === 1) return "complete";
  if (v === 2) return "cancelled";
  return "unknown";
}
