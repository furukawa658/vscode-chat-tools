import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { MakaseruStore } from "./store";

function argumentValue(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const workspaceRoot = argumentValue("--workspace", process.cwd());
const databasePath = argumentValue("--db", process.env.MAKASERU_DB_PATH ?? `${workspaceRoot}/.makaseru/state.sqlite`);
const store = new MakaseruStore(databasePath, workspaceRoot);
const server = new McpServer({ name: "makaseru-mcp", version: "0.2.3" });
const text = (value: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(value) }] });
const resourceText = (uri: URL, value: unknown) => ({ contents: [{ uri: uri.toString(), mimeType: "application/json", text: JSON.stringify(value) }] });
const variable = (value: string | string[]) => decodeURIComponent(Array.isArray(value) ? value[0] : value);

const criterionSchema = z.object({ id: z.string().min(1), description: z.string().min(1) });
const verificationGateSchema = z.object({
  type: z.enum(["command_exit_zero", "file_non_empty", "content_contains", "require_actual_change"]),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  timeoutMs: z.number().int().positive().max(300_000).optional(),
  path: z.string().optional(),
  needle: z.string().optional(),
  mustExist: z.boolean().optional(),
});

server.registerResource(
  "makaseru-task-contract",
  new ResourceTemplate("makaseru://tasks/{taskId}/contract{?handoffToken}", { list: undefined }),
  { title: "Makaseru task contract", description: "Read the secret-free contract for one task using its handoff token.", mimeType: "application/json" },
  async (uri, variables) => resourceText(uri, await store.readContractResource(variable(variables.taskId), variable(variables.handoffToken))),
);
server.registerResource(
  "makaseru-task-state",
  new ResourceTemplate("makaseru://tasks/{taskId}/state{?handoffToken}", { list: undefined }),
  { title: "Makaseru task state", description: "Read the secret-free state and open questions for one task using its handoff token.", mimeType: "application/json" },
  async (uri, variables) => resourceText(uri, await store.readStateResource(variable(variables.taskId), variable(variables.handoffToken))),
);
server.registerResource(
  "makaseru-active-board",
  new ResourceTemplate("makaseru://board/active{?parentSessionId,parentSecret}", { list: undefined }),
  { title: "Makaseru active board", description: "Read the secret-free active board for one authenticated parent session.", mimeType: "application/json" },
  async (uri, variables) => resourceText(uri, await store.readActiveBoardResource(variable(variables.parentSessionId), variable(variables.parentSecret))),
);

server.registerTool("makaseru_dispatch_subtask", {
  title: "Register a bounded subtask",
  description: "Parent tool. Register one small task with objective acceptance criteria. Keep parentSecret private and pass childHandoffPrompt to the child agent.",
  inputSchema: {
    parentSessionId: z.string().min(1),
    kind: z.enum(["INSPECT", "EDIT", "VERIFY", "DRAFT"]),
    goal: z.string().min(1),
    constraints: z.array(z.string()).default([]),
    allowedScope: z.array(z.string()).max(5).default([]),
    criteria: z.array(criterionSchema).min(1).max(3),
    contextRefs: z.array(z.string()).default([]),
    dependsOn: z.array(z.string()).default([]),
    maxAttempts: z.number().int().min(1).max(5).default(2),
    maxQuestions: z.number().int().min(0).max(5).default(2),
    verificationGates: z.array(verificationGateSchema).default([]),
    groundTruth: z.array(z.string().min(1)).default([]),
    knownSymbols: z.array(z.string().min(1)).default([]),
    forbiddenAssumptions: z.array(z.string().min(1)).default([]),
  },
}, async (input) => text(await store.dispatch(input)));

server.registerTool("makaseru_accept_subtask", {
  title: "Accept and load a subtask",
  description: "Child tool. This must be the first Makaseru call after receiving taskId and handoffToken.",
  inputSchema: {
    taskId: z.string().min(1),
    handoffToken: z.string().length(32),
  },
}, async (input) => text(await store.accept(input.taskId, input.handoffToken)));

server.registerTool("makaseru_ask_parent", {
  title: "Pause and ask the parent",
  description: "Child tool. Use when blocked or uncertain. Supply at least two concrete options and stop until the parent answers.",
  inputSchema: {
    taskId: z.string().min(1),
    handoffToken: z.string().length(32),
    category: z.enum(["AMBIGUOUS_SPEC", "SCOPE_EXPANSION", "MISSING_CONTEXT", "BLOCKER"]),
    question: z.string().min(1),
    options: z.array(z.string()).min(2),
    blockingTarget: z.string().optional(),
  },
}, async (input) => text(await store.askParent(input.taskId, input.handoffToken, input.category, input.question, input.options, input.blockingTarget)));

server.registerTool("makaseru_answer_question", {
  title: "Answer a child question",
  description: "Parent tool. Answer an open question and resume the task. A parentSecret is required and must not be sent to the child.",
  inputSchema: {
    taskId: z.string().min(1),
    parentSecret: z.string().length(32),
    questionId: z.string().min(1),
    answer: z.string().min(1),
    addConstraint: z.string().optional(),
    addAllowedScope: z.string().optional(),
  },
}, async (input) => text(await store.answerQuestion(input.taskId, input.parentSecret, input.questionId, input.answer, input.addConstraint, input.addAllowedScope)));

server.registerTool("makaseru_complete_subtask", {
  title: "Submit objective completion evidence",
  description: "Child tool. Report all changed files, grounded facts, assumptions, and evidence for every criterion. The server independently checks paths, lines, Git state, and verification gates.",
  inputSchema: {
    taskId: z.string().min(1),
    handoffToken: z.string().length(32),
    summary: z.string().min(1),
    modifiedFiles: z.array(z.string()).default([]),
    facts: z.array(z.object({ statement: z.string().min(1), reference: z.string().min(3) })).min(1),
    assumptions: z.array(z.string()).default([]),
    criteria: z.array(z.object({ criterionId: z.string(), passed: z.boolean(), evidence: z.string() })),
  },
}, async (input) => text(await store.complete(input)));

server.registerTool("makaseru_review_completion", {
  title: "Approve or reject a completion with assumptions",
  description: "Parent tool. Resolve NEEDS_PARENT_REVIEW. Approve only after checking the reported assumptions.",
  inputSchema: {
    taskId: z.string().min(1),
    parentSecret: z.string().length(32),
    approve: z.boolean(),
    reason: z.string().optional(),
  },
}, async (input) => text(await store.review(input.taskId, input.parentSecret, input.approve, input.reason)));

server.registerTool("makaseru_collect_report", {
  title: "Collect a compact task report",
  description: "Parent tool. Return the verified task state, open questions, assumptions, final report, or escalation reason.",
  inputSchema: {
    taskId: z.string().min(1),
    parentSecret: z.string().length(32),
  },
}, async (input) => text(await store.report(input.taskId, input.parentSecret)));

server.registerTool("makaseru_list_tasks", {
  title: "List compact tasks for a parent session",
  description: "Parent tool. Return at most 30 lines: task ID, state, and goal.",
  inputSchema: {
    parentSessionId: z.string().min(1),
    parentSecret: z.string().length(32),
  },
}, async (input) => ({ content: [{ type: "text", text: await store.board(input.parentSessionId, input.parentSecret) }] }));

async function main() {
  await server.connect(new StdioServerTransport());
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
