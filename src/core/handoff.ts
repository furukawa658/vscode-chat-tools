import { Json, userText, responseText } from "./session";

export function buildHandoff(session: Json, gitSummary: string, maxChars = 6000): string {
  const reqs: Json[] = session?.requests ?? [];
  const first = reqs.length ? userText(reqs[0]) : "";
  const recent = reqs.slice(-3).map((r, i) => `#### 直近${i + 1}\n利用者: ${userText(r).slice(0, 800)}\n応答: ${responseText(r).slice(-800)}`);
  const head = ["# 引き継ぎ", "前のチャットの作業を続ける。以下を前提に、未完了の作業から再開する。"].join("\n\n");
  const git = `## 作業ツリーの状態\n${gitSummary || "(Git管理下のフォルダーなし)"}`;
  const sections = [`## 最初の依頼\n${first.slice(0, 1500)}`, `## 直近のやり取り\n${recent.join("\n\n")}`];
  const joined = [head, ...sections, git].join("\n\n");
  if (joined.length <= maxChars) return joined;
  // 作業ツリーの状態を残し、依頼とやり取りだけを削る
  const mark = "\n…(省略)";
  const gitPart = git.length > maxChars / 2 ? cut(git, Math.floor(maxChars / 2)) : git;
  const room = Math.max(0, maxChars - head.length - gitPart.length - 4 - mark.length);
  return [head, cut(sections.join("\n\n"), room) + mark, gitPart].join("\n\n");
}

/** サロゲートペアを分断せずに切る。 */
function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  let end = max;
  const c = text.charCodeAt(end - 1);
  if (c >= 0xd800 && c <= 0xdbff) end--;
  return text.slice(0, end);
}
