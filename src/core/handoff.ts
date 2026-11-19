import { Json, userText, responseText } from "./session";

export function buildHandoff(session: Json, gitSummary: string, maxChars = 6000): string {
  const reqs: Json[] = session?.requests ?? [];
  const first = reqs.length ? userText(reqs[0]) : "";
  const recent = reqs.slice(-3).map((r, i) => `#### 直近${i + 1}\n利用者: ${userText(r).slice(0, 800)}\n応答: ${responseText(r).slice(-800)}`);
  const body = [
    "# 引き継ぎ",
    "前のチャットの作業を続ける。以下を前提に、未完了の作業から再開する。",
    `## 最初の依頼\n${first.slice(0, 1500)}`,
    `## 直近のやり取り\n${recent.join("\n\n")}`,
    `## 作業ツリーの状態\n${gitSummary || "(Git管理下のフォルダーなし)"}`,
  ].join("\n\n");
  return body.length > maxChars ? body.slice(0, maxChars) + "\n…(省略)" : body;
}
