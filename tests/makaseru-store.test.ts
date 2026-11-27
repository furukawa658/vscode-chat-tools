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
