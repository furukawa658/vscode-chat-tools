import { afterAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { arch, platform } from "node:os";
import { join } from "node:path";
import { computeUsageWithZig, stopZigScanner, zigAvailable } from "../src/core/zig";

const extensionPath = join(import.meta.dir, "..", "extensions", "tsugi");
const supported = platform() === "win32" && arch() === "x64" || platform() === "linux" && (arch() === "x64" || arch() === "arm64") || platform() === "darwin" && (arch() === "x64" || arch() === "arm64");
const fixture = join(import.meta.dir, "fixtures", "usage.jsonl");
const built = supported && zigAvailable(extensionPath);

afterAll(stopZigScanner);

describe("Zig session scanner", () => {
  test.skipIf(!built)("resident scan returns latest indexed token patches", async () => {
    expect(existsSync(fixture)).toBe(true);
    const usage = await computeUsageWithZig(fixture, extensionPath, {
      contextSize: 200000,
      modelId: "copilot/example",
      mode: "agent",
    }, 500);
    expect(usage?.promptTokens).toBe(100000);
    expect(usage?.completionTokens).toBe(2500);
    expect(usage?.occupiedTokens).toBe(103000);
    expect(usage?.ratio).toBeCloseTo(0.515);
  });
});
