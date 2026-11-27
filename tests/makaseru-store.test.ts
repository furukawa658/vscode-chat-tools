import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MakaseruStore } from "../src/makaseru/store";

const dirs: string[] = [];

function createStore() {
  const dir = mkdtempSync(join(tmpdir(), "makaseru-test-"));
  dirs.push(dir);
  return new MakaseruStore(join(dir, "state.sqlite"), dir);
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("MakaseruStore", () => {
  test("completes a bounded task with valid evidence", async () => {
    const store = await createStore();
    const workspace = (store as unknown as { workspaceRoot: string }).workspaceRoot;
    mkdirSync(join(workspace, "src"), { recursive: true });
    writeFileSync(join(workspace, "src", "approved.ts"), "initial\n", "utf8");
    const dispatched = await store.dispatch({
      parentSessionId: "parent-1",
      kind: "EDIT",
      goal: "Update the approved file",
      constraints: ["Do not change public APIs"],
      allowedScope: ["src/approved.ts"],
      criteria: [{ id: "C1", description: "The approved file contains the expected marker" }],
      contextRefs: [],
      dependsOn: [],
      maxAttempts: 2,
      maxQuestions: 1,
    });

    const brief = await store.accept(dispatched.taskId, dispatched.handoffToken);
    expect(dispatched.handoffToken).toHaveLength(32);
    expect(brief.singleGoal).toBe("Update the approved file");
    await expect(store.accept(dispatched.taskId, "bad!")).rejects.toThrow("IDENTITY_MISMATCH");
    writeFileSync(join(workspace, "src", "approved.ts"), "MARKER\n", "utf8");

    const result = await store.complete({
      taskId: dispatched.taskId,
      handoffToken: dispatched.handoffToken,
      summary: "Added the marker",
      modifiedFiles: ["src/approved.ts"],
      facts: [{ statement: "The marker exists", reference: "src/approved.ts:1" }],
      assumptions: [],
      criteria: [{ criterionId: "C1", passed: true, evidence: "src/approved.ts:1 contains MARKER" }],
    });

    expect(result.status).toBe("COMPLETED");
  });

  test("passes workspace ground truth to the child without parent secrets", async () => {
    const store = await createStore();
    const dispatched = await store.dispatch({
      parentSessionId: "parent-ground-truth",
      kind: "INSPECT",
      goal: "Inspect the approved contract",
      constraints: [],
      allowedScope: [],
      criteria: [{ id: "C1", description: "The contract is inspected" }],
      contextRefs: [],
      dependsOn: [],
      maxAttempts: 1,
      maxQuestions: 1,
      groundTruth: ["The endpoint returns 412 on stale ETags"],
      knownSymbols: ["MakaseruStore.complete"],
      forbiddenAssumptions: ["Do not assume retries are idempotent"],
    });

    const brief = await store.accept(dispatched.taskId, dispatched.handoffToken);

    expect(brief.groundTruth).toEqual(["The endpoint returns 412 on stale ETags"]);
    expect(brief.knownSymbols).toEqual(["MakaseruStore.complete"]);
    expect(brief.forbiddenAssumptions).toEqual(["Do not assume retries are idempotent"]);
    expect("parentSecret" in brief).toBe(false);
    expect("handoffToken" in brief).toBe(false);
  });

  test("reads secret-free task resources and expanded active board entries", async () => {
    const store = await createStore();
    const workspace = (store as unknown as { workspaceRoot: string }).workspaceRoot;
    writeFileSync(join(workspace, "review.txt"), "reviewed\n", "utf8");
    const completed = await store.dispatch({
      parentSessionId: "parent-resources",
      kind: "INSPECT",
      goal: "Completed inspection",
      constraints: [],
      allowedScope: [],
      criteria: [{ id: "C1", description: "Inspection completed" }],
      contextRefs: [],
      dependsOn: [],
      maxAttempts: 1,
      maxQuestions: 1,
      groundTruth: ["The approved contract is fixed"],
    });
    await store.accept(completed.taskId, completed.handoffToken);
    await store.complete({
      taskId: completed.taskId,
      handoffToken: completed.handoffToken,
      summary: "Inspection completed",
      modifiedFiles: [],
      facts: [{ statement: "Contract was inspected", reference: "review.txt:1" }],
      assumptions: [],
      criteria: [{ criterionId: "C1", passed: true, evidence: "review.txt contains the reviewed contract" }],
    });

    const waiting = await store.dispatch({
      parentSessionId: "parent-resources",
      kind: "INSPECT",
      goal: "Clarify the contract",
      constraints: [],
      allowedScope: [],
      criteria: [{ id: "C1", description: "Contract clarified" }],
      contextRefs: [],
      dependsOn: [],
      maxAttempts: 1,
      maxQuestions: 1,
    });
    await store.askParent(waiting.taskId, waiting.handoffToken, "AMBIGUOUS_SPEC", "Which contract?", ["Current", "Previous"]);

    const review = await store.dispatch({
      parentSessionId: "parent-resources",
      kind: "INSPECT",
      goal: "Confirm an assumption",
      constraints: [],
      allowedScope: [],
      criteria: [{ id: "C1", description: "Assumption is surfaced" }],
      contextRefs: [],
      dependsOn: [],
      maxAttempts: 1,
      maxQuestions: 1,
    });
    await store.accept(review.taskId, review.handoffToken);
    await store.complete({
      taskId: review.taskId,
      handoffToken: review.handoffToken,
      summary: "Assumption requires approval",
      modifiedFiles: [],
      facts: [{ statement: "Review source exists", reference: "review.txt:1" }],
      assumptions: ["The new contract is already effective"],
      criteria: [{ criterionId: "C1", passed: true, evidence: "review.txt confirms the source exists" }],
    });

    const contract = await store.readContractResource(waiting.taskId, waiting.handoffToken);
    expect(contract.singleGoal).toBe("Clarify the contract");
    expect("parentSecret" in contract).toBe(false);
    expect("handoffToken" in contract).toBe(false);
    await expect(store.readContractResource(waiting.taskId, "bad-token")).rejects.toThrow("IDENTITY_MISMATCH");

    const state = await store.readStateResource(waiting.taskId, waiting.handoffToken);
    expect(state.status).toBe("WAITING_PARENT");
    expect(state.openQuestions).toHaveLength(1);
    expect("parentSecret" in state).toBe(false);
    expect("handoffToken" in state).toBe(false);

    const board = await store.readActiveBoardResource("parent-resources", completed.parentSecret);
    expect(board.completed).toEqual([{ taskId: completed.taskId, goal: "Completed inspection", status: "COMPLETED" }]);
    expect(board.waitingParent).toEqual(expect.arrayContaining([
      expect.objectContaining({ taskId: waiting.taskId, goal: "Clarify the contract", questions: [expect.objectContaining({ question: "Which contract?" })] }),
    ]));
    expect(board.needsParentReview).toEqual(expect.arrayContaining([
      expect.objectContaining({
        taskId: review.taskId,
        summary: "Assumption requires approval",
        assumptions: ["The new contract is already effective"],
      }),
    ]));
    await expect(store.readActiveBoardResource("parent-resources", "bad-secret")).rejects.toThrow("PARENT_IDENTITY_MISMATCH");
    expect(JSON.stringify(board)).not.toContain(completed.parentSecret);
    expect(JSON.stringify(board)).not.toContain(completed.handoffToken);
    expect(JSON.stringify(board)).not.toContain(waiting.parentSecret);
    expect(JSON.stringify(board)).not.toContain(waiting.handoffToken);
  });

  test("allows other store operations while two verifications are running", async () => {
    const store = await createStore();
    const workspace = (store as unknown as { workspaceRoot: string }).workspaceRoot;
    const dispatchedTasks = await Promise.all(["first.txt", "second.txt"].map(async (path) => {
      writeFileSync(join(workspace, path), "initial\n", "utf8");
      const dispatched = await store.dispatch({
        parentSessionId: "parent-concurrent",
        kind: "EDIT",
        goal: `Update ${path}`,
        constraints: [],
        allowedScope: [path],
        criteria: [{ id: "C1", description: "Target is updated" }],
        contextRefs: [path],
        dependsOn: [],
        maxAttempts: 2,
        maxQuestions: 1,
        verificationGates: [{ type: "command_exit_zero", command: "bun", args: ["test"] }],
      });
      await store.accept(dispatched.taskId, dispatched.handoffToken);
      writeFileSync(join(workspace, path), "updated\n", "utf8");
      return { path, dispatched };
    }));

    let startVerifications!: () => void;
    let finishVerifications!: () => void;
    const verificationsStarted = new Promise<void>((resolve) => { startVerifications = resolve; });
    const verificationsFinished = new Promise<void>((resolve) => { finishVerifications = resolve; });
    let runningVerifications = 0;
    const storeInternals = store as unknown as { runVerificationGates: () => Promise<string[]> };
    storeInternals.runVerificationGates = async () => {
      runningVerifications += 1;
      if (runningVerifications === 2) startVerifications();
      await verificationsFinished;
      return [];
    };

    const completions = dispatchedTasks.map(({ path, dispatched }) => store.complete({
      taskId: dispatched.taskId,
      handoffToken: dispatched.handoffToken,
      summary: `Updated ${path}`,
      modifiedFiles: [path],
      facts: [{ statement: `${path} changed`, reference: `${path}:1` }],
      assumptions: [],
      criteria: [{ criterionId: "C1", passed: true, evidence: `${path} now contains updated` }],
    }));
    await verificationsStarted;

    try {
      const concurrentDispatch = store.dispatch({
        parentSessionId: "parent-concurrent-other",
        kind: "INSPECT",
        goal: "Inspect independently",
        constraints: [],
        allowedScope: [],
        criteria: [{ id: "C1", description: "Independent inspection completes" }],
        contextRefs: [],
        dependsOn: [],
        maxAttempts: 1,
        maxQuestions: 1,
      });
      const probe = await Promise.race([
        concurrentDispatch,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error("STORE_BLOCKED_DURING_VERIFICATION")), 1_000)),
      ]);
      expect(probe.status).toBe("CREATED");
      await expect(store.askParent(probe.taskId, probe.handoffToken, "BLOCKER", "Which input should be used?", ["Current", "Previous"]))
        .resolves.toMatchObject({ status: "OPEN" });
      await expect(store.report(probe.taskId, probe.parentSecret)).resolves.toMatchObject({ status: "WAITING_PARENT" });
    } finally {
      finishVerifications();
      await Promise.all(completions);
    }
  });

  test("rejects a completion when task state changes during verification", async () => {
    const store = await createStore();
    const workspace = (store as unknown as { workspaceRoot: string }).workspaceRoot;
    writeFileSync(join(workspace, "target.txt"), "initial\n", "utf8");
    const dispatched = await store.dispatch({
      parentSessionId: "parent-changed",
      kind: "EDIT",
      goal: "Update target",
      constraints: [],
      allowedScope: ["target.txt"],
      criteria: [{ id: "C1", description: "Target is updated" }],
      contextRefs: ["target.txt"],
      dependsOn: [],
      maxAttempts: 2,
      maxQuestions: 1,
      verificationGates: [{ type: "command_exit_zero", command: "bun", args: ["test"] }],
    });
    await store.accept(dispatched.taskId, dispatched.handoffToken);
    writeFileSync(join(workspace, "target.txt"), "updated\n", "utf8");

    let startVerification!: () => void;
    let finishVerification!: () => void;
    const verificationStarted = new Promise<void>((resolve) => { startVerification = resolve; });
    const verificationFinished = new Promise<void>((resolve) => { finishVerification = resolve; });
    const storeInternals = store as unknown as { runVerificationGates: () => Promise<string[]> };
    storeInternals.runVerificationGates = async () => {
      startVerification();
      await verificationFinished;
      return [];
    };

    const completion = store.complete({
      taskId: dispatched.taskId,
      handoffToken: dispatched.handoffToken,
      summary: "Updated target",
      modifiedFiles: ["target.txt"],
      facts: [{ statement: "Target changed", reference: "target.txt:1" }],
      assumptions: [],
      criteria: [{ criterionId: "C1", passed: true, evidence: "target.txt now contains updated" }],
    });
    await verificationStarted;
    await expect(store.askParent(dispatched.taskId, dispatched.handoffToken, "MISSING_CONTEXT", "Which behavior is required?", ["A", "B"]))
      .resolves.toMatchObject({ status: "OPEN" });
    finishVerification();

    await expect(completion).rejects.toThrow("TASK_CHANGED_DURING_VERIFICATION");
    await expect(store.report(dispatched.taskId, dispatched.parentSecret)).resolves.toMatchObject({ status: "WAITING_PARENT" });
  });

  test("does not overwrite a review decision made during approval verification", async () => {
    const store = await createStore();
    const workspace = (store as unknown as { workspaceRoot: string }).workspaceRoot;
    writeFileSync(join(workspace, "target.txt"), "initial\n", "utf8");
    const dispatched = await store.dispatch({
      parentSessionId: "parent-review-changed",
      kind: "EDIT",
      goal: "Update target",
      constraints: [],
      allowedScope: ["target.txt"],
      criteria: [{ id: "C1", description: "Target is updated" }],
      contextRefs: ["target.txt"],
      dependsOn: [],
      maxAttempts: 2,
      maxQuestions: 1,
      verificationGates: [{ type: "require_actual_change" }],
    });
    await store.accept(dispatched.taskId, dispatched.handoffToken);
    writeFileSync(join(workspace, "target.txt"), "updated\n", "utf8");
    await store.complete({
      taskId: dispatched.taskId,
      handoffToken: dispatched.handoffToken,
      summary: "Updated target",
      modifiedFiles: ["target.txt"],
      facts: [{ statement: "Target changed", reference: "target.txt:1" }],
      assumptions: ["The caller expects this update"],
      criteria: [{ criterionId: "C1", passed: true, evidence: "target.txt now contains updated" }],
    });

    let startVerification!: () => void;
    let finishVerification!: () => void;
    const verificationStarted = new Promise<void>((resolve) => { startVerification = resolve; });
    const verificationFinished = new Promise<void>((resolve) => { finishVerification = resolve; });
    const storeInternals = store as unknown as { runVerificationGates: () => Promise<string[]> };
    storeInternals.runVerificationGates = async () => {
      startVerification();
      await verificationFinished;
      return [];
    };

    const approval = store.review(dispatched.taskId, dispatched.parentSecret, true);
    await verificationStarted;
    await expect(store.review(dispatched.taskId, dispatched.parentSecret, false, "Revise the assumption"))
      .resolves.toMatchObject({ status: "IN_PROGRESS" });
    finishVerification();

    await expect(approval).rejects.toThrow("TASK_CHANGED_DURING_REVIEW");
    await expect(store.report(dispatched.taskId, dispatched.parentSecret)).resolves.toMatchObject({ status: "IN_PROGRESS" });
  });

  test("marks assumptions for parent review instead of completing", async () => {
    const store = await createStore();
    const workspace = (store as unknown as { workspaceRoot: string }).workspaceRoot;
    writeFileSync(join(workspace, "config.json"), "{\n}\n", "utf8");
    const dispatched = await store.dispatch({
      parentSessionId: "parent-2",
      kind: "INSPECT",
      goal: "Inspect the configuration",
      constraints: [],
      allowedScope: ["config.json"],
      criteria: [{ id: "C1", description: "Configuration was inspected" }],
      contextRefs: ["config.json"],
      dependsOn: [],
      maxAttempts: 2,
      maxQuestions: 1,
    });
    await store.accept(dispatched.taskId, dispatched.handoffToken);

    const result = await store.complete({
      taskId: dispatched.taskId,
      handoffToken: dispatched.handoffToken,
      summary: "Read configuration",
      modifiedFiles: [],
      facts: [{ statement: "Configuration exists", reference: "config.json:1" }],
      assumptions: ["The missing option defaults to enabled"],
      criteria: [{ criterionId: "C1", passed: true, evidence: "config.json:1 was read" }],
    });

    expect(result.status).toBe("NEEDS_PARENT_REVIEW");
  });

  test("rejects a command gate with a relative executable path", async () => {
    const store = await createStore();
    const workspace = (store as unknown as { workspaceRoot: string }).workspaceRoot;
    mkdirSync(join(workspace, "src"), { recursive: true });
    writeFileSync(join(workspace, "src", "target.ts"), "initial\n", "utf8");
    const dispatched = await store.dispatch({
      parentSessionId: "parent-command",
      kind: "EDIT",
      goal: "Update target",
      constraints: [],
      allowedScope: ["src/target.ts"],
      criteria: [{ id: "C1", description: "Target is updated" }],
      contextRefs: ["src/target.ts"],
      dependsOn: [],
      maxAttempts: 2,
      maxQuestions: 1,
      verificationGates: [{ type: "command_exit_zero", command: "./bun", args: ["test"] }],
    });
    await store.accept(dispatched.taskId, dispatched.handoffToken);
    writeFileSync(join(workspace, "src", "target.ts"), "updated\n", "utf8");

    const result = await store.complete({
      taskId: dispatched.taskId,
      handoffToken: dispatched.handoffToken,
      summary: "Updated target",
      modifiedFiles: ["src/target.ts"],
      facts: [{ statement: "Target changed", reference: "src/target.ts:1" }],
      assumptions: [],
      criteria: [{ criterionId: "C1", passed: true, evidence: "src/target.ts:1 now says updated" }],
    });

    expect(result.status).toBe("IN_PROGRESS");
    expect(result.reasons).toContain("GATE_CMD_PATH_FORBIDDEN: ./bun");
  });

  test.skipIf(process.platform === "win32")("rejects a symlink that resolves outside the workspace", async () => {
    const store = await createStore();
    const workspace = (store as unknown as { workspaceRoot: string }).workspaceRoot;
    const outside = `${workspace}-outside.txt`;
    mkdirSync(join(workspace, "src"), { recursive: true });
    writeFileSync(outside, "outside\n", "utf8");
    const dispatched = await store.dispatch({
      parentSessionId: "parent-symlink",
      kind: "EDIT",
      goal: "Update a target",
      constraints: [],
      allowedScope: ["src/**"],
      criteria: [{ id: "C1", description: "Target is updated" }],
      contextRefs: [],
      dependsOn: [],
      maxAttempts: 2,
      maxQuestions: 1,
    });
    await store.accept(dispatched.taskId, dispatched.handoffToken);
    symlinkSync(outside, join(workspace, "src", "link.txt"));

    try {
      const result = await store.complete({
        taskId: dispatched.taskId,
        handoffToken: dispatched.handoffToken,
        summary: "Added link",
        modifiedFiles: ["src/link.txt"],
        facts: [{ statement: "Link points to outside", reference: "src/link.txt:1" }],
        assumptions: [],
        criteria: [{ criterionId: "C1", passed: true, evidence: "src/link.txt points at a file" }],
      });

      expect(result.status).toBe("IN_PROGRESS");
      expect(result.reasons.some((reason) => reason.startsWith("SYMLINK_ESCAPE:"))).toBe(true);
    } finally {
      rmSync(outside, { force: true });
    }
  });
});
