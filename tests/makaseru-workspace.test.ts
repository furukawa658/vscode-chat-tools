import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import initSqlJs from "sql.js";
import { MakaseruStore } from "../src/makaseru/store";
import { readWorkspaceStatus, statusText, workspaceDatabasePath, workspaceHash, workspaceLabel } from "../src/makaseru/status";

const dirs: string[] = [];
const wasmPath = join(process.cwd(), "node_modules", "sql.js", "dist", "sql-wasm.wasm");

function createWorkspace(prefix = "makaseru-workspace-") {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

async function setSchemaVersion(databasePath: string, version: number) {
  const SQL = await initSqlJs({ locateFile: () => wasmPath });
  const db = new SQL.Database(readFileSync(databasePath));
  db.run(`PRAGMA user_version = ${version}`);
  writeFileSync(databasePath, db.export());
  db.close();
}

async function schemaVersion(databasePath: string) {
  const SQL = await initSqlJs({ locateFile: () => wasmPath });
  const db = new SQL.Database(readFileSync(databasePath));
  const version = Number(db.exec("PRAGMA user_version")[0]?.values[0]?.[0] ?? -1);
  db.close();
  return version;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("Makaseru workspace state", () => {
  test("publishes secret-free status counts after state changes", async () => {
    const workspace = createWorkspace();
    const databasePath = workspaceDatabasePath(join(workspace, "storage"), workspace);
    const store = new MakaseruStore(databasePath, workspace);
    const dispatched = await store.dispatch({
      parentSessionId: "parent-status",
      kind: "INSPECT",
      goal: "Inspect status",
      constraints: [],
      allowedScope: [],
      criteria: [{ id: "C1", description: "Status is inspected" }],
      contextRefs: [],
      dependsOn: [],
      maxAttempts: 1,
      maxQuestions: 1,
    });
    await store.askParent(dispatched.taskId, dispatched.handoffToken, "BLOCKER", "Which state?", ["Current", "Previous"]);

    const status = readWorkspaceStatus(databasePath, workspace);
    expect(status.waitingParent).toBe(1);
    expect(status.needsParentReview).toBe(0);
    expect(status.escalated).toBe(0);
    expect(statusText([status])).toContain("Q:1 R:0 E:0");
    const serialized = JSON.stringify(status);
    expect(serialized).not.toContain(dispatched.parentSecret);
    expect(serialized).not.toContain(dispatched.handoffToken);
  });

  test("migrates schema version zero and leaves future databases unchanged", async () => {
    const workspace = createWorkspace();
    const databasePath = join(workspace, "state.sqlite");
    const store = new MakaseruStore(databasePath, workspace);
    const dispatched = await store.dispatch({
      parentSessionId: "parent-schema",
      kind: "INSPECT",
      goal: "Inspect schema",
      constraints: [],
      allowedScope: [],
      criteria: [{ id: "C1", description: "Schema is inspected" }],
      contextRefs: [],
      dependsOn: [],
      maxAttempts: 1,
      maxQuestions: 1,
    });

    await setSchemaVersion(databasePath, 0);
    await expect(store.report(dispatched.taskId, dispatched.parentSecret)).resolves.toMatchObject({ status: "CREATED" });
    expect(await schemaVersion(databasePath)).toBe(1);

    await setSchemaVersion(databasePath, 2);
    const futureBytes = readFileSync(databasePath);
    await expect(store.report(dispatched.taskId, dispatched.parentSecret)).rejects.toThrow("SCHEMA_VERSION_UNSUPPORTED: 2");
    expect(readFileSync(databasePath)).toEqual(futureBytes);
  });

  test("isolates same-named workspaces and task identities", async () => {
    const root = createWorkspace();
    const firstRoot = join(root, "first", "project");
    const secondRoot = join(root, "second", "project");
    mkdirSync(firstRoot, { recursive: true });
    mkdirSync(secondRoot, { recursive: true });
    const storage = join(root, "storage");
    const firstDatabase = workspaceDatabasePath(storage, firstRoot);
    const secondDatabase = workspaceDatabasePath(storage, secondRoot);
    expect(workspaceLabel(firstRoot)).toBe("project");
    expect(workspaceLabel(secondRoot)).toBe("project");
    expect(workspaceHash(firstRoot)).not.toBe(workspaceHash(secondRoot));
    expect(firstDatabase).not.toBe(secondDatabase);

    const sharedDatabase = join(storage, "shared.sqlite");
    const firstStore = new MakaseruStore(sharedDatabase, firstRoot);
    const secondStore = new MakaseruStore(sharedDatabase, secondRoot);
    const first = await firstStore.dispatch({
      parentSessionId: "parent-first",
      kind: "INSPECT",
      goal: "Inspect first workspace",
      constraints: [],
      allowedScope: [],
      criteria: [{ id: "C1", description: "First workspace inspected" }],
      contextRefs: [],
      dependsOn: [],
      maxAttempts: 1,
      maxQuestions: 1,
    });
    const second = await secondStore.dispatch({
      parentSessionId: "parent-second",
      kind: "INSPECT",
      goal: "Inspect second workspace",
      constraints: [],
      allowedScope: [],
      criteria: [{ id: "C1", description: "Second workspace inspected" }],
      contextRefs: [],
      dependsOn: [],
      maxAttempts: 1,
      maxQuestions: 1,
    });

    await expect(firstStore.accept(first.taskId, first.handoffToken)).resolves.toMatchObject({ taskId: first.taskId });
    await expect(secondStore.accept(first.taskId, first.handoffToken)).rejects.toThrow("IDENTITY_MISMATCH");
    await expect(secondStore.accept(second.taskId, second.handoffToken)).resolves.toMatchObject({ taskId: second.taskId });
  });
});
