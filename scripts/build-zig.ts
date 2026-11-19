import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = join(import.meta.dir, "..");
const outputDirectory = join(root, "extensions", "tsugi", "bin");
const targets = [
  ["x86_64-windows-gnu", "session-scan-win32-x64.exe"],
  ["x86_64-linux-gnu", "session-scan-linux-x64"],
  ["aarch64-linux-gnu", "session-scan-linux-arm64"],
  ["x86_64-macos-none", "session-scan-darwin-x64"],
  ["aarch64-macos-none", "session-scan-darwin-arm64"],
] as const;

export function buildZig(required = process.env.CI === "true"): boolean {
  const probe = spawnSync("zig", ["version"], { cwd: root, encoding: "utf8" });
  if (probe.status !== 0) {
    if (required) throw new Error("Zig is required in CI but was not found on PATH.");
    console.log("zig not found; keeping the JavaScript session scanner fallback");
    return false;
  }

  mkdirSync(outputDirectory, { recursive: true });
  for (const [target, output] of targets) {
    const result = spawnSync("zig", [
      "build-exe",
      "src/zig/session_scan.zig",
      "-target", target,
      "-O", "ReleaseSmall",
      "-fstrip",
      `-femit-bin=${join(outputDirectory, output)}`,
    ], { cwd: root, stdio: "inherit" });
    if (result.status !== 0) throw new Error(`Zig build failed for ${target}`);
    console.log(`built ${output}`);
  }
  return true;
}

if (import.meta.main) buildZig();
