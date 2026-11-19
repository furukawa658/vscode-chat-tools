import { Json } from "./session";

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  occupiedTokens: number;
  contextSize: number;
  ratio: number;
  modelId: string;
  mode: string;
  promptBreakdown: PromptTokenCategory[];
  toolNames: string[];
}

export interface PromptTokenCategory {
  label: string;
  category: string;
  percentage: number;
}

function toolNames(request: Json): string[] {
  return [...new Set<string>((request?.response ?? [])
    .filter((part: Json) => part?.kind === "toolInvocationSerialized" && typeof part?.toolId === "string")
    .map((part: Json) => part.toolId as string))];
}

/** promptTokens is the latest full request; completionTokens is the response that follows it. */
export function computeUsage(session: Json, baseOverheadTokens = 0): Usage | undefined {
  const requests: Json[] = session?.requests ?? [];
  for (let index = requests.length - 1; index >= 0; index--) {
    const request = requests[index];
    if (typeof request?.promptTokens !== "number") continue;
    const selectedMetadata = session?.inputState?.selectedModel?.metadata;
    const contextSize =
      request.modelConfiguration?.contextSize ??
      selectedMetadata?.maxInputTokens ??
      0;
    if (!contextSize) return undefined;
    const completionTokens = typeof request.completionTokens === "number" ? request.completionTokens : 0;
    const occupiedTokens = request.promptTokens + completionTokens + Math.max(0, baseOverheadTokens);
    const promptBreakdown: PromptTokenCategory[] = (request.promptTokenDetails ?? [])
      .filter((part: Json) => typeof part?.label === "string" && typeof part?.percentageOfPrompt === "number")
      .map((part: Json) => ({ label: part.label, category: part.category ?? "Other", percentage: part.percentageOfPrompt }));
    return {
      promptTokens: request.promptTokens,
      completionTokens,
      occupiedTokens,
      contextSize,
      ratio: occupiedTokens / contextSize,
      modelId: request.modelId ?? selectedMetadata?.id ?? "",
      mode: request.modeInfo?.kind ?? session?.inputState?.mode?.kind ?? session?.inputState?.mode?.id ?? "",
      promptBreakdown,
      toolNames: toolNames(request),
    };
  }
  return undefined;
}

export function chatSelection(session: Json): { modelId: string; mode: string } {
  const request: Json | undefined = [...(session?.requests ?? [])].reverse().find((item: Json) => item?.modelId);
  return {
    modelId: request?.modelId ?? session?.inputState?.selectedModel?.identifier ?? session?.inputState?.selectedModel?.metadata?.id ?? "",
    mode: request?.modeInfo?.kind ?? session?.inputState?.mode?.kind ?? session?.inputState?.mode?.id ?? "agent",
  };
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
