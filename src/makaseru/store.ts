import { execFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import initSqlJs, { Database } from "sql.js";
import lockfile from "proper-lockfile";

const execFileAsync = promisify(execFile);
const statuses = ["CREATED", "IN_PROGRESS", "WAITING_PARENT", "NEEDS_PARENT_REVIEW", "COMPLETED", "ESCALATED"] as const;
export type TaskStatus = typeof statuses[number];
export type TaskKind = "INSPECT" | "EDIT" | "VERIFY" | "DRAFT";

export interface Criterion {
  id: string;
  description: string;
}

export interface VerificationGate {
  type: "command_exit_zero" | "file_non_empty" | "content_contains" | "require_actual_change";
  command?: string;
  args?: string[];
  timeoutMs?: number;
  path?: string;
  needle?: string;
  mustExist?: boolean;
}

export interface DispatchInput {
  parentSessionId: string;
  kind: TaskKind;
  goal: string;
  constraints: string[];
  allowedScope: string[];
  criteria: Criterion[];
  contextRefs: string[];
  dependsOn: string[];
  maxAttempts: number;
  maxQuestions: number;
  verificationGates?: VerificationGate[];
  groundTruth?: string[];
  knownSymbols?: string[];
  forbiddenAssumptions?: string[];
}

export interface Fact {
  statement: string;
  reference: string;
}

export interface CriterionResult {
  criterionId: string;
  passed: boolean;
  evidence: string;
}

export interface CompleteInput {
  taskId: string;
  handoffToken: string;
  summary: string;
  modifiedFiles: string[];
  facts: Fact[];
  assumptions: string[];
  criteria: CriterionResult[];
}

interface Question {
  id: string;
  category: string;
  question: string;
  options: string[];
  blockingTarget?: string;
  status: "OPEN" | "ANSWERED";
  answer?: string;
  createdAt: string;
  answeredAt?: string;
}

interface TaskRecord extends DispatchInput {
  taskId: string;
  workspaceHash: string;
  handoffToken: string;
  parentSecret: string;
  status: TaskStatus;
  attemptCount: number;
  questions: Question[];
  baseline: Record<string, string>;
  finalReport?: Record<string, unknown>;
  escalationReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DispatchResult {
  taskId: string;
  handoffToken: string;
  parentSecret: string;
  workspaceHash: string;
  status: "CREATED";
  childHandoffPrompt: string;
}

export interface TaskBrief {
  taskId: string;
  kind: TaskKind;
  singleGoal: string;
  inheritedFacts: string[];
  doNot: string[];
  allowedScope: string[];
  checklistToComplete: Criterion[];
  verificationGates: VerificationGate[];
  groundTruth: string[];
  knownSymbols: string[];
  forbiddenAssumptions: string[];
  contextRefs: string[];
  remainingAttempts: number;
  questions: Question[];
}

export interface CompletionResult {
  taskId: string;
  status: TaskStatus;
  attemptsUsed: number;
  reasons: string[];
}

export interface TaskStateResource {
  taskId: string;
  kind: TaskKind;
  status: TaskStatus;
  attemptCount: number;
  remainingAttempts: number;
  updatedAt: string;
  openQuestions: Question[];
}

export interface ActiveBoardResource {
  created: Array<{ taskId: string; goal: string; status: TaskStatus }>;
  inProgress: Array<{ taskId: string; goal: string; status: TaskStatus }>;
  waitingParent: Array<{ taskId: string; goal: string; status: TaskStatus; updatedAt: string; questions: Question[] }>;
  needsParentReview: Array<{ taskId: string; goal: string; status: TaskStatus; updatedAt: string; summary: string; assumptions: string[] }>;
  completed: Array<{ taskId: string; goal: string; status: TaskStatus }>;
  escalated: Array<{ taskId: string; goal: string; status: TaskStatus; reason?: string }>;
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

function globToRegExp(pattern: string): RegExp {
  const normalized = normalizePath(pattern);
  let source = "";
  for (let index = 0; index < normalized.length; index += 1) {
    const character = normalized[index];
    if (character === "*" && normalized[index + 1] === "*") {
      if (normalized[index + 2] === "/") {
        source += "(?:.*/)?";
        index += 2;
      } else {
        source += ".*";
        index += 1;
      }
    } else if (character === "*") source += "[^/]*";
    else if (character === "?") source += "[^/]";
    else source += /[\\^$+?.()|{}[\]]/.test(character) ? `\\${character}` : character;
  }
  return new RegExp(`^${source}$`);
}

function matchesScope(path: string, allowedScope: string[]): boolean {
  const normalized = normalizePath(path);
  return allowedScope.some((pattern) => {
    const normalizedPattern = normalizePath(pattern);
    return normalized === normalizedPattern || globToRegExp(normalizedPattern).test(normalized);
  });
}

function resolveInside(root: string, path: string): string {
  if (isAbsolute(path)) throw new Error("PATH_ERROR: Absolute paths are not allowed");
  const rootReal = realpathSync(root);
  const full = resolve(root, path);
  const fullReal = realpathSync(full);
  const rel = relative(rootReal, fullReal);
  if (rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel))) return fullReal;
  throw new Error("PATH_ERROR: Path escapes the workspace");
}

function sha256(content: Uint8Array | string): string {
  return createHash("sha256").update(content).digest("hex");
}

let sqlPromise: ReturnType<typeof initSqlJs> | undefined;
function sqlRuntime() {
  const wasmPath = process.env.MAKASERU_SQL_WASM_PATH ?? join(process.cwd(), "node_modules", "sql.js", "dist", "sql-wasm.wasm");
  sqlPromise ??= initSqlJs({ locateFile: () => wasmPath });
  return sqlPromise;
}

export class MakaseruStore {
  private readonly databasePath: string;
  private readonly workspaceRoot: string;
  private readonly workspaceHash: string;

  constructor(databasePath: string, workspaceRoot: string) {
    this.databasePath = resolve(databasePath);
    this.workspaceRoot = resolve(workspaceRoot);
    this.workspaceHash = sha256(this.workspaceRoot).slice(0, 12);
  }

  async dispatch(input: DispatchInput): Promise<DispatchResult> {
    if (!input.goal.trim()) throw new Error("GRANULARITY_ERROR: goal is required");
    if (input.criteria.length < 1 || input.criteria.length > 3) throw new Error("GRANULARITY_ERROR: criteria must contain 1 to 3 items");
    if (input.allowedScope.length > 5) throw new Error("GRANULARITY_ERROR: allowedScope must contain at most 5 patterns");
    if ((input.kind === "EDIT" || input.kind === "DRAFT") && input.allowedScope.length === 0) throw new Error("SCOPE_REQUIRED: EDIT and DRAFT tasks require allowedScope");

    const taskId = `task_${randomBytes(8).toString("hex")}`;
    const handoffToken = randomBytes(16).toString("hex");
    const parentSecret = randomBytes(16).toString("hex");
    const now = new Date().toISOString();
    const task: TaskRecord = {
      ...input,
      verificationGates: input.verificationGates ?? [],
      groundTruth: input.groundTruth ?? [],
      knownSymbols: input.knownSymbols ?? [],
      forbiddenAssumptions: input.forbiddenAssumptions ?? [],
      taskId,
      workspaceHash: this.workspaceHash,
      handoffToken,
      parentSecret,
      status: "CREATED",
      attemptCount: 0,
      questions: [],
      baseline: {},
      createdAt: now,
      updatedAt: now,
    };

    await this.withDb(async (db) => {
      for (const dependency of input.dependsOn) {
        const prerequisite = this.readTask(db, dependency);
        if (!prerequisite || prerequisite.workspaceHash !== this.workspaceHash || prerequisite.status !== "COMPLETED") {
          throw new Error(`DEPENDENCY_NOT_READY: ${dependency}`);
        }
      }
      this.writeTask(db, task);
      return undefined;
    });

    return {
      taskId,
      handoffToken,
      parentSecret,
      workspaceHash: this.workspaceHash,
      status: "CREATED",
      childHandoffPrompt: `Execute Makaseru task ${taskId} with handoff token ${handoffToken}. First call makaseru_accept_subtask. Never guess; use makaseru_ask_parent if blocked. Submit only verified evidence with makaseru_complete_subtask.`,
    };
  }

  async accept(taskId: string, handoffToken: string): Promise<TaskBrief> {
    return this.withDb(async (db) => {
      const task = this.requireChildTask(db, taskId, handoffToken);
      if (!["CREATED", "IN_PROGRESS"].includes(task.status)) throw new Error(`TASK_STATUS_ERROR: ${task.status}`);
      for (const dependency of task.dependsOn) {
        const prerequisite = this.readTask(db, dependency);
        if (!prerequisite || prerequisite.status !== "COMPLETED") throw new Error(`DEPENDENCY_NOT_READY: ${dependency}`);
      }
      if (task.status === "CREATED") {
        task.status = "IN_PROGRESS";
        task.baseline = await this.captureWorkspaceSnapshot(task.allowedScope);
        task.updatedAt = new Date().toISOString();
        this.writeTask(db, task);
      }
      return this.buildTaskBrief(db, task);
    });
  }

  async readContractResource(taskId: string, handoffToken: string): Promise<TaskBrief> {
    return this.withDb((db) => {
      const task = this.requireChildTask(db, taskId, handoffToken);
      return this.buildTaskBrief(db, task);
    });
  }

  async readStateResource(taskId: string, handoffToken: string): Promise<TaskStateResource> {
    return this.withDb((db) => {
      const task = this.requireChildTask(db, taskId, handoffToken);
      return {
        taskId: task.taskId,
        kind: task.kind,
        status: task.status,
        attemptCount: task.attemptCount,
        remainingAttempts: Math.max(0, task.maxAttempts - task.attemptCount),
        updatedAt: task.updatedAt,
        openQuestions: task.questions.filter((question) => question.status === "OPEN"),
      };
    });
  }

  async readActiveBoardResource(parentSessionId: string, parentSecret: string): Promise<ActiveBoardResource> {
    return this.withDb((db) => {
      const matchingWorkspace = this.allTasks(db).filter((task) => task.workspaceHash === this.workspaceHash);
      const authorized = matchingWorkspace.some((task) => task.parentSessionId === parentSessionId && task.parentSecret === parentSecret);
      if (!authorized) throw new Error("PARENT_IDENTITY_MISMATCH");
      const tasks = matchingWorkspace.filter((task) => task.parentSessionId === parentSessionId);
      const summary = (task: TaskRecord) => ({ taskId: task.taskId, goal: task.goal, status: task.status });
      return {
        created: tasks.filter((task) => task.status === "CREATED").map(summary),
        inProgress: tasks.filter((task) => task.status === "IN_PROGRESS").map(summary),
        waitingParent: tasks.filter((task) => task.status === "WAITING_PARENT").map((task) => ({
          ...summary(task),
          updatedAt: task.updatedAt,
          questions: task.questions.filter((question) => question.status === "OPEN"),
        })),
        needsParentReview: tasks.filter((task) => task.status === "NEEDS_PARENT_REVIEW").map((task) => ({
          ...summary(task),
          updatedAt: task.updatedAt,
          summary: typeof task.finalReport?.summary === "string" ? task.finalReport.summary : "",
          assumptions: Array.isArray(task.finalReport?.assumptions)
            ? task.finalReport.assumptions.filter((assumption): assumption is string => typeof assumption === "string")
            : [],
        })),
        completed: tasks.filter((task) => task.status === "COMPLETED").map(summary),
        escalated: tasks.filter((task) => task.status === "ESCALATED").map((task) => ({
          ...summary(task),
          reason: task.escalationReason,
        })),
      };
    });
  }

  async askParent(taskId: string, handoffToken: string, category: string, question: string, options: string[], blockingTarget?: string) {
    if (options.length < 2) throw new Error("INVALID_QUESTION: at least two options are required");
    return this.withDb((db) => {
      const task = this.requireChildTask(db, taskId, handoffToken);
      if (!["IN_PROGRESS", "CREATED"].includes(task.status)) throw new Error(`TASK_STATUS_ERROR: ${task.status}`);
      if (task.questions.length >= task.maxQuestions) throw new Error("MAX_QUESTIONS_EXCEEDED");
      const item: Question = { id: `q_${task.questions.length + 1}`, category, question, options, blockingTarget, status: "OPEN", createdAt: new Date().toISOString() };
      task.questions.push(item);
      task.status = "WAITING_PARENT";
      task.updatedAt = item.createdAt;
      this.writeTask(db, task);
      return item;
    });
  }

  async answerQuestion(taskId: string, parentSecret: string, questionId: string, answer: string, addConstraint?: string, addAllowedScope?: string) {
    return this.withDb((db) => {
      const task = this.requireParentTask(db, taskId, parentSecret);
      const question = task.questions.find((item) => item.id === questionId && item.status === "OPEN");
      if (!question) throw new Error("QUESTION_NOT_FOUND");
      question.status = "ANSWERED";
      question.answer = answer;
      question.answeredAt = new Date().toISOString();
      if (addConstraint?.trim()) task.constraints.push(addConstraint.trim());
      if (addAllowedScope?.trim()) task.allowedScope.push(addAllowedScope.trim());
      task.status = task.questions.some((item) => item.status === "OPEN") ? "WAITING_PARENT" : "IN_PROGRESS";
      task.updatedAt = question.answeredAt;
      this.writeTask(db, task);
      return { taskId, status: task.status };
    });
  }

  async complete(input: CompleteInput): Promise<CompletionResult> {
    const taskBefore = await this.withDb((db) => this.requireChildTask(db, input.taskId, input.handoffToken));
    if (!["IN_PROGRESS", "CREATED"].includes(taskBefore.status)) throw new Error(`TASK_STATUS_ERROR: ${taskBefore.status}`);

    const reasons = this.validateSubmission(taskBefore, input);
    const currentSnapshot = await this.captureWorkspaceSnapshot(taskBefore.allowedScope);
    const actualChanges = this.changedPaths(taskBefore.baseline, currentSnapshot);
    for (const changed of actualChanges) {
      const full = resolve(this.workspaceRoot, changed);
      if (existsSync(full)) {
        try { resolveInside(this.workspaceRoot, changed); }
        catch { reasons.push(`SYMLINK_ESCAPE: ${changed}`); }
      }
    }
    if (taskBefore.kind === "INSPECT" && actualChanges.length > 0) reasons.push(`GIT_READONLY_VIOLATION: ${actualChanges.join(", ")}`);
    const reported = new Set(input.modifiedFiles.map(normalizePath));
    for (const changed of actualChanges) if (!reported.has(changed)) reasons.push(`UNREPORTED_CHANGE: ${changed}`);
    for (const changed of actualChanges) if (!matchesScope(changed, taskBefore.allowedScope)) reasons.push(`SCOPE_VIOLATION: ${changed}`);
    if ((taskBefore.kind === "EDIT" || taskBefore.kind === "DRAFT") && actualChanges.length === 0) reasons.push("GATE_NO_ACTUAL_CHANGE");
    if (reasons.length === 0) reasons.push(...await this.runVerificationGates(taskBefore.verificationGates ?? [], actualChanges.length > 0));

    return this.withDb((db) => {
      const task = this.requireChildTask(db, input.taskId, input.handoffToken);
      if (task.status !== taskBefore.status || task.attemptCount !== taskBefore.attemptCount || task.updatedAt !== taskBefore.updatedAt) throw new Error("TASK_CHANGED_DURING_VERIFICATION");
      task.attemptCount += 1;
      task.updatedAt = new Date().toISOString();
      if (reasons.length > 0) {
        task.status = task.attemptCount >= task.maxAttempts ? "ESCALATED" : "IN_PROGRESS";
        if (task.status === "ESCALATED") task.escalationReason = reasons.join(" | ");
      } else if (input.assumptions.length > 0) {
        task.status = "NEEDS_PARENT_REVIEW";
        task.finalReport = { summary: input.summary, modifiedFiles: input.modifiedFiles, facts: input.facts, assumptions: input.assumptions, criteria: input.criteria, actualChanges };
      } else {
        task.status = "COMPLETED";
        task.finalReport = { summary: input.summary, modifiedFiles: input.modifiedFiles, facts: input.facts, assumptions: [], criteria: input.criteria, actualChanges };
      }
      this.writeTask(db, task);
      return { taskId: task.taskId, status: task.status, attemptsUsed: task.attemptCount, reasons };
    });
  }

  async review(taskId: string, parentSecret: string, approve: boolean, reason?: string) {
    const taskBefore = await this.withDb((db) => this.requireParentTask(db, taskId, parentSecret));
    if (taskBefore.status !== "NEEDS_PARENT_REVIEW") throw new Error(`TASK_STATUS_ERROR: ${taskBefore.status}`);
    if (approve) {
      const currentSnapshot = await this.captureWorkspaceSnapshot(taskBefore.allowedScope);
      const actualChange = this.changedPaths(taskBefore.baseline, currentSnapshot).length > 0;
      const gateReasons = await this.runVerificationGates(taskBefore.verificationGates ?? [], actualChange);
      if (gateReasons.length > 0) throw new Error(`REVIEW_VERIFICATION_FAILED: ${gateReasons.join(" | ")}`);
    }
    return this.withDb((db) => {
      const task = this.requireParentTask(db, taskId, parentSecret);
      if (task.status !== taskBefore.status || task.attemptCount !== taskBefore.attemptCount || task.updatedAt !== taskBefore.updatedAt) throw new Error("TASK_CHANGED_DURING_REVIEW");
      task.status = approve ? "COMPLETED" : "IN_PROGRESS";
      task.updatedAt = new Date().toISOString();
      if (!approve) task.constraints.push(`Parent rejected assumptions: ${reason?.trim() || "revise and resubmit"}`);
      this.writeTask(db, task);
      return { taskId, status: task.status };
    });
  }

  async report(taskId: string, parentSecret: string) {
    return this.withDb((db) => {
      const task = this.requireParentTask(db, taskId, parentSecret);
      return {
        taskId: task.taskId,
        status: task.status,
        goal: task.goal,
        attemptCount: task.attemptCount,
        questions: task.questions.filter((question) => question.status === "OPEN"),
        assumptions: task.finalReport?.assumptions ?? [],
        report: task.finalReport,
        escalationReason: task.escalationReason,
      };
    });
  }

  async board(parentSessionId: string, parentSecret: string) {
    return this.withDb((db) => {
      const tasks = this.allTasks(db).filter((task) => task.parentSessionId === parentSessionId && task.parentSecret === parentSecret && task.workspaceHash === this.workspaceHash);
      if (tasks.length === 0) throw new Error("PARENT_IDENTITY_MISMATCH");
      return tasks.slice(-30).map((task) => `${task.taskId}\t${task.status}\t${task.goal}`).join("\n");
    });
  }

  private buildTaskBrief(db: Database, task: TaskRecord): TaskBrief {
    return {
      taskId: task.taskId,
      kind: task.kind,
      singleGoal: task.goal,
      inheritedFacts: task.dependsOn.flatMap((id) => {
        const prerequisite = this.readTask(db, id);
        const facts = prerequisite?.finalReport?.facts;
        return Array.isArray(facts) ? facts.map((fact: Fact) => `${id}: ${fact.statement}`) : [];
      }),
      doNot: task.constraints,
      allowedScope: task.allowedScope,
      checklistToComplete: task.criteria,
      verificationGates: task.verificationGates ?? [],
      groundTruth: task.groundTruth ?? [],
      knownSymbols: task.knownSymbols ?? [],
      forbiddenAssumptions: task.forbiddenAssumptions ?? [],
      contextRefs: task.contextRefs,
      remainingAttempts: Math.max(0, task.maxAttempts - task.attemptCount),
      questions: task.questions,
    };
  }

  private validateSubmission(task: TaskRecord, input: CompleteInput): string[] {
    const reasons: string[] = [];
    if (input.facts.length === 0) reasons.push("MISSING_FACTS");
    if (task.kind === "INSPECT" && input.modifiedFiles.length > 0) reasons.push("READONLY_VIOLATION");
    for (const file of input.modifiedFiles) if (!matchesScope(file, task.allowedScope)) reasons.push(`SCOPE_VIOLATION: ${file}`);
    for (const criterion of task.criteria) {
      const result = input.criteria.find((candidate) => candidate.criterionId === criterion.id);
      if (!result) reasons.push(`MISSING_CRITERION: ${criterion.id}`);
      else if (!result.passed || result.evidence.trim().length < 8) reasons.push(`CRITERION_FAILED: ${criterion.id}`);
    }
    for (const fact of input.facts) {
      const reference = fact.reference;
      const separator = reference.lastIndexOf(":");
      if (separator < 1) {
        reasons.push(`INVALID_REFERENCE: ${reference}`);
        continue;
      }
      const file = reference.slice(0, separator);
      const lineText = reference.slice(separator + 1).split("-").map(Number);
      try {
        const full = resolveInside(this.workspaceRoot, file);
        const lines = readFileSync(full, "utf8").split(/\r?\n/).length;
        if (lineText.some((line) => !Number.isInteger(line) || line < 1 || line > lines)) reasons.push(`HALLUCINATED_LINE: ${reference}`);
      } catch {
        reasons.push(`HALLUCINATED_FILE: ${file}`);
      }
    }
    return reasons;
  }

  private async runVerificationGates(gates: VerificationGate[], actualChange: boolean): Promise<string[]> {
    const reasons: string[] = [];
    const allowedCommands = (process.env.MAKASERU_ALLOWED_CMDS ?? "cargo,npm,bun,pnpm,yarn,dotnet,pytest,python,go,git").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
    for (const gate of gates) {
      if (gate.type === "require_actual_change") {
        if (!actualChange) reasons.push("GATE_NO_ACTUAL_CHANGE");
        continue;
      }
      if (gate.type === "command_exit_zero") {
        const command = gate.command ?? "";
        if (!/^[A-Za-z0-9_.-]+$/.test(command)) {
          reasons.push(`GATE_CMD_PATH_FORBIDDEN: ${command}`);
          continue;
        }
        const baseName = command.replace(/\.(exe|cmd)$/i, "").toLowerCase();
        if (!allowedCommands.includes(baseName)) {
          reasons.push(`GATE_CMD_FORBIDDEN: ${command}`);
          continue;
        }
        const timeout = Math.min(Math.max(gate.timeoutMs ?? 30_000, 1_000), 300_000);
        try {
          await execFileAsync(command, gate.args ?? [], { cwd: this.workspaceRoot, timeout, maxBuffer: 1_000_000, env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", USERPROFILE: process.env.USERPROFILE ?? "" } });
        } catch (error) {
          const message = error instanceof Error ? error.message.replaceAll("\r\n", "\n").slice(-600) : "unknown error";
          reasons.push(`GATE_CMD_FAILED: ${command} ${message}`);
        }
        continue;
      }
      if (!gate.path) {
        reasons.push("GATE_PATH_MISSING");
        continue;
      }
      try {
        const content = readFileSync(resolveInside(this.workspaceRoot, gate.path), "utf8");
        if (gate.type === "file_non_empty" && content.trim().length === 0) reasons.push(`GATE_FILE_EMPTY: ${gate.path}`);
        if (gate.type === "content_contains") {
          const found = content.includes(gate.needle ?? "");
          if ((gate.mustExist ?? true) !== found) reasons.push(`GATE_CONTENT_MISMATCH: ${gate.path}`);
        }
      } catch (error) {
        reasons.push(`GATE_FILE_ERROR: ${gate.path}`);
      }
    }
    return reasons;
  }

  private async captureWorkspaceSnapshot(allowedScope: string[]): Promise<Record<string, string>> {
    try {
      const { stdout } = await execFileAsync("git", ["ls-files", "-co", "--exclude-standard", "-z"], { cwd: this.workspaceRoot, encoding: "buffer", maxBuffer: 20_000_000 });
      const paths = stdout.toString("utf8").split("\0").filter(Boolean).map(normalizePath);
      return Object.fromEntries(paths.map((path) => [path, this.hashPath(path)]));
    } catch {
      const paths: string[] = [];
      const visit = (directory: string) => {
        for (const entry of readdirSync(directory, { withFileTypes: true })) {
          if ([".git", "node_modules", "dist"].includes(entry.name)) continue;
          const relativePath = normalizePath(relative(this.workspaceRoot, resolve(directory, entry.name)));
          if (entry.isDirectory()) visit(resolve(directory, entry.name));
          else if (allowedScope.some((pattern) => matchesScope(relativePath, [pattern]))) paths.push(relativePath);
        }
      };
      visit(this.workspaceRoot);
      return Object.fromEntries(paths.map((path) => [path, this.hashPath(path)]));
    }
  }

  private hashPath(path: string): string {
    try {
      return sha256(readFileSync(resolveInside(this.workspaceRoot, path)));
    } catch {
      return existsSync(resolve(this.workspaceRoot, path)) ? "<unsafe>" : "<missing>";
    }
  }

  private changedPaths(before: Record<string, string>, after: Record<string, string>): string[] {
    const paths = new Set([...Object.keys(before), ...Object.keys(after)]);
    return [...paths].filter((path) => before[path] !== after[path]).sort();
  }

  private requireChildTask(db: Database, taskId: string, handoffToken: string): TaskRecord {
    const task = this.readTask(db, taskId);
    if (!task || task.workspaceHash !== this.workspaceHash || task.handoffToken !== handoffToken) throw new Error("IDENTITY_MISMATCH");
    return task;
  }

  private requireParentTask(db: Database, taskId: string, parentSecret: string): TaskRecord {
    const task = this.readTask(db, taskId);
    if (!task || task.workspaceHash !== this.workspaceHash || task.parentSecret !== parentSecret) throw new Error("PARENT_IDENTITY_MISMATCH");
    return task;
  }

  private readTask(db: Database, taskId: string): TaskRecord | undefined {
    const statement = db.prepare("SELECT payload FROM tasks WHERE task_id = ?");
    statement.bind([taskId]);
    const payload = statement.step() ? String(statement.getAsObject().payload) : undefined;
    statement.free();
    return payload ? JSON.parse(payload) as TaskRecord : undefined;
  }

  private allTasks(db: Database): TaskRecord[] {
    const result = db.exec("SELECT payload FROM tasks ORDER BY created_at ASC");
    return (result[0]?.values ?? []).map((row) => JSON.parse(String(row[0])) as TaskRecord);
  }

  private writeTask(db: Database, task: TaskRecord) {
    const statement = db.prepare("INSERT INTO tasks(task_id, workspace_hash, created_at, payload) VALUES (?, ?, ?, ?) ON CONFLICT(task_id) DO UPDATE SET payload = excluded.payload");
    statement.run([task.taskId, task.workspaceHash, task.createdAt, JSON.stringify(task)]);
    statement.free();
  }

  private async withDb<T>(operation: (db: Database) => Promise<T> | T): Promise<T> {
    mkdirSync(dirname(this.databasePath), { recursive: true });
    if (!existsSync(this.databasePath)) writeFileSync(this.databasePath, new Uint8Array());
    const release = await lockfile.lock(this.databasePath, { stale: 600_000, realpath: false, retries: { retries: 10, factor: 2, minTimeout: 10, maxTimeout: 500 } });
    const SQL = await sqlRuntime();
    const file = readFileSync(this.databasePath);
    const db = file.length > 0 ? new SQL.Database(file) : new SQL.Database();
    try {
      db.run("CREATE TABLE IF NOT EXISTS tasks(task_id TEXT PRIMARY KEY, workspace_hash TEXT NOT NULL, created_at TEXT NOT NULL, payload TEXT NOT NULL)");
      const result = await operation(db);
      const bytes = db.export();
      const temporaryPath = `${this.databasePath}.${process.pid}.${randomBytes(3).toString("hex")}.tmp`;
      try {
        writeFileSync(temporaryPath, bytes);
        renameSync(temporaryPath, this.databasePath);
      } finally {
        rmSync(temporaryPath, { force: true });
      }
      return result;
    } finally {
      db.close();
      await release();
    }
  }
}
