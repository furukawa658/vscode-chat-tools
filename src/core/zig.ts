import { existsSync } from "node:fs";
import { arch, platform } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { Usage } from "./usage";

function binaryName(): string | undefined {
  if (platform() === "win32" && arch() === "x64") return "session-scan-win32-x64.exe";
  if (platform() === "linux" && arch() === "x64") return "session-scan-linux-x64";
  if (platform() === "linux" && arch() === "arm64") return "session-scan-linux-arm64";
  if (platform() === "darwin" && arch() === "x64") return "session-scan-darwin-x64";
  if (platform() === "darwin" && arch() === "arm64") return "session-scan-darwin-arm64";
  return undefined;
}

export function zigAvailable(extensionPath: string): boolean {
  const name = binaryName();
  return Boolean(name && existsSync(join(extensionPath, "bin", name)));
}

export function computeUsageWithZig(sessionPath: string, extensionPath: string, baseOverheadTokens = 0): Usage | undefined {
  const name = binaryName();
  if (!name) return undefined;
  const binary = join(extensionPath, "bin", name);
  if (!existsSync(binary)) return undefined;
  try {
    const output = execFileSync(binary, [sessionPath], {
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true,
      maxBuffer: 1024,
    }).trim();
    const values = output.split("\t").map(Number);
    if (values.length !== 4 || values.some((value) => !Number.isFinite(value))) return undefined;
    const [promptTokens, completionTokens, contextSize] = values;
    if (!promptTokens || !contextSize) return undefined;
    const occupiedTokens = promptTokens + completionTokens + Math.max(0, baseOverheadTokens);
    return {
      promptTokens,
      completionTokens,
      occupiedTokens,
      contextSize,
      ratio: occupiedTokens / contextSize,
      modelId: "",
      mode: "",
      promptBreakdown: [],
      toolNames: [],
    };
  } catch {
    return undefined;
  }
}
