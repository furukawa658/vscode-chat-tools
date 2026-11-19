import { Json, responseText, userText } from "./session";

export interface SplitTask {
  title: string;
  goal: string;
  context: string;
  relevantFiles: string[];
  decisions: string[];
  acceptanceChecks: string[];
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be a non-empty string`);
  return value.trim();
}

function textArray(value: unknown, field: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${field} must be an array of strings`);
  }
  return value.map((item) => item.trim()).filter(Boolean);
}

export function parseSplitTasks(response: string): SplitTask[] {
  const cleaned = response.trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
  const parsed: unknown = JSON.parse(cleaned);
  if (!Array.isArray(parsed)) throw new Error("response must be an array");
  return parsed.map((value, index) => {
    if (!value || typeof value !== "object") throw new Error(`task ${index + 1} must be an object`);
    const task = value as Record<string, unknown>;
    return {
      title: text(task.title, `task ${index + 1}.title`),
      goal: text(task.goal, `task ${index + 1}.goal`),
      context: text(task.context, `task ${index + 1}.context`),
      relevantFiles: textArray(task.relevantFiles, `task ${index + 1}.relevantFiles`),
      decisions: textArray(task.decisions, `task ${index + 1}.decisions`),
      acceptanceChecks: textArray(task.acceptanceChecks, `task ${index + 1}.acceptanceChecks`),
    };
  });
}

function selectedFileLines(files: string[]): string {
  return files.length ? files.map((file) => `- ${file}`).join("\n") : "- 該当ファイル未特定";
}

function selectedDecisionLines(decisions: string[]): string {
  return decisions.length ? decisions.map((decision) => `- ${decision}`).join("\n") : "- 前チャットで確定した事項なし";
}

function selectedCheckLines(checks: string[]): string {
  return checks.length ? checks.map((check) => `- ${check}`).join("\n") : "- 実装後に対象範囲のテストと型検査を実行する";
}

function taskEvidence(session: Json, task: SplitTask): string {
  const requests: Json[] = Array.isArray(session?.requests) ? session.requests : [];
  const haystacks = [task.title, task.goal, task.context, ...task.relevantFiles]
    .join(" ")
    .split(/[\s/\\,.:()\[\]{}]+/)
    .filter((word) => word.length >= 4)
    .slice(0, 30);
  const relevant = requests
    .slice(-12)
    .map((request) => ({
      user: userText(request).slice(0, 1200),
      assistant: responseText(request).slice(-1600),
    }))
    .filter((exchange) => haystacks.some((word) => exchange.user.includes(word) || exchange.assistant.includes(word)))
    .slice(-3);
  if (!relevant.length) return "関連する直近のやり取りは抽出できなかった。上のタスク文脈を正本として扱う。";
  return relevant.map((exchange, index) => `### 関連${index + 1}\n利用者: ${exchange.user}\n応答: ${exchange.assistant}`).join("\n\n");
}

export function buildSplitHandoff(session: Json, task: SplitTask, gitSummary: string): string {
  return [
    "# 分割タスク",
    "このチャットでは、指定された独立タスクだけを進める。ほかの候補タスクへ範囲を広げない。",
    `## タスク\n${task.title}`,
    `## 目標\n${task.goal}`,
    `## 前チャットからの文脈\n${task.context}`,
    `## 関連ファイル\n${selectedFileLines(task.relevantFiles)}`,
    `## 確定事項\n${selectedDecisionLines(task.decisions)}`,
    `## 受入確認\n${selectedCheckLines(task.acceptanceChecks)}`,
    `## 関連する直近のやり取り\n${taskEvidence(session, task)}`,
    `## 作業ツリーの状態\n${gitSummary || "(関連ファイルのGit変更なし)"}`,
  ].join("\n\n");
}
