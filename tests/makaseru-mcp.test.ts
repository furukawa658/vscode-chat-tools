import { afterEach, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const dirs: string[] = [];

function parseText<T>(result: Awaited<ReturnType<Client["callTool"]>>): T {
  const content = "content" in result ? result.content[0] : undefined;
  if (!content || content.type !== "text") throw new Error("Expected text MCP response");
  return JSON.parse(content.text) as T;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("Makaseru MCP stdio server", () => {
  test("registers tools and completes a delegated task end to end", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "makaseru-mcp-"));
    dirs.push(workspace);
    mkdirSync(join(workspace, "src"), { recursive: true });
    writeFileSync(join(workspace, "src", "target.ts"), "initial\n", "utf8");

    const extensionRoot = join(import.meta.dir, "..", "extensions", "makaseru");
    const serverPath = join(extensionRoot, "dist", "mcp-server.js");
    const wasmPath = join(extensionRoot, "dist", "sql-wasm.wasm");
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [serverPath, "--workspace", workspace, "--db", join(workspace, ".makaseru", "state.sqlite")],
      env: { ...process.env, MAKASERU_SQL_WASM_PATH: wasmPath } as Record<string, string>,
      cwd: workspace,
      stderr: "pipe",
    });
    const client = new Client({ name: "makaseru-test", version: "1.0.0" });

    try {
      await client.connect(transport);
      const tools = await client.listTools();
      expect(tools.tools.map((tool) => tool.name).sort()).toEqual([
        "makaseru_accept_subtask",
        "makaseru_answer_question",
        "makaseru_ask_parent",
        "makaseru_collect_report",
        "makaseru_complete_subtask",
        "makaseru_dispatch_subtask",
        "makaseru_list_tasks",
        "makaseru_review_completion",
      ]);

      const dispatched = parseText<{ taskId: string; handoffToken: string; parentSecret: string }>(await client.callTool({
        name: "makaseru_dispatch_subtask",
        arguments: {
          parentSessionId: "parent-mcp-test",
          kind: "EDIT",
          goal: "Add the completed marker",
          constraints: ["Only edit src/target.ts"],
          allowedScope: ["src/target.ts"],
          criteria: [{ id: "C1", description: "src/target.ts contains COMPLETE" }],
          contextRefs: ["src/target.ts"],
          dependsOn: [],
          maxAttempts: 2,
          maxQuestions: 1,
          verificationGates: [{ type: "content_contains", path: "src/target.ts", needle: "COMPLETE", mustExist: true }],
        },
      }));

      await client.callTool({ name: "makaseru_accept_subtask", arguments: { taskId: dispatched.taskId, handoffToken: dispatched.handoffToken } });
      writeFileSync(join(workspace, "src", "target.ts"), "COMPLETE\n", "utf8");

      const completed = parseText<{ status: string; reasons: string[] }>(await client.callTool({
        name: "makaseru_complete_subtask",
        arguments: {
          taskId: dispatched.taskId,
          handoffToken: dispatched.handoffToken,
          summary: "Added COMPLETE to src/target.ts",
          modifiedFiles: ["src/target.ts"],
          facts: [{ statement: "The file contains COMPLETE", reference: "src/target.ts:1" }],
          assumptions: [],
          criteria: [{ criterionId: "C1", passed: true, evidence: "src/target.ts:1 contains COMPLETE" }],
        },
      }));
      expect(completed.status).toBe("COMPLETED");
      expect(completed.reasons).toEqual([]);

      const report = parseText<{ status: string; report: { summary: string } }>(await client.callTool({
        name: "makaseru_collect_report",
        arguments: { taskId: dispatched.taskId, parentSecret: dispatched.parentSecret },
      }));
      expect(report.status).toBe("COMPLETED");
      expect(report.report.summary).toBe("Added COMPLETE to src/target.ts");
    } finally {
      await client.close();
    }
  }, 30_000);
});
