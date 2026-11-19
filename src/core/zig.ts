import { existsSync } from "node:fs";
import { arch, platform } from "node:os";
import { join } from "node:path";
import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { Usage } from "./usage";

export interface ZigSessionMetadata {
  contextSize: number;
  modelId: string;
  mode: string;
}

function binaryName(): string | undefined {
  if (platform() === "win32" && arch() === "x64") return "session-scan-win32-x64.exe";
  if (platform() === "linux" && arch() === "x64") return "session-scan-linux-x64";
  if (platform() === "linux" && arch() === "arm64") return "session-scan-linux-arm64";
  if (platform() === "darwin" && arch() === "x64") return "session-scan-darwin-x64";
  if (platform() === "darwin" && arch() === "arm64") return "session-scan-darwin-arm64";
  return undefined;
}

interface PendingScan {
  path: string;
  resolve: (value: number[] | undefined) => void;
  timer: NodeJS.Timeout;
}

let scanner: ChildProcessWithoutNullStreams | undefined;
let scannerPath = "";
let outputBuffer = "";
let activeScan: PendingScan | undefined;
const queuedScans: PendingScan[] = [];

function binaryPath(extensionPath: string): string | undefined {
  const name = binaryName();
  if (!name) return undefined;
  const path = join(extensionPath, "bin", name);
  return existsSync(path) ? path : undefined;
}

function completeScan(line: string): void {
  const pending = activeScan;
  activeScan = undefined;
  if (!pending) return;
  clearTimeout(pending.timer);
  const values = line.split("\t").map(Number);
  pending.resolve(line === "error" || values.length !== 3 || values.some((value) => !Number.isFinite(value)) ? undefined : values);
  sendNextScan();
}

function sendNextScan(): void {
  if (activeScan || !scanner || queuedScans.length === 0) return;
  activeScan = queuedScans.shift();
  if (!activeScan) return;
  scanner.stdin.write(`${activeScan.path}\n`);
}

function resetScanner(): void {
  const pending = [...(activeScan ? [activeScan] : []), ...queuedScans];
  queuedScans.length = 0;
  activeScan = undefined;
  outputBuffer = "";
  for (const item of pending) {
    clearTimeout(item.timer);
    item.resolve(undefined);
  }
  scanner = undefined;
  scannerPath = "";
}

function getScanner(extensionPath: string): ChildProcessWithoutNullStreams | undefined {
  const path = binaryPath(extensionPath);
  if (!path) return undefined;
  if (scanner && scannerPath === path) return scanner;
  if (scanner) scanner.kill();
  resetScanner();
  scannerPath = path;
  const child = spawn(path, [], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  scanner = child;
  child.stderr.resume();
  child.stdout.on("data", (chunk: Buffer) => {
    outputBuffer += chunk.toString("utf8");
    let newline = outputBuffer.indexOf("\n");
    while (newline >= 0) {
      const line = outputBuffer.slice(0, newline).replace(/\r$/, "");
      outputBuffer = outputBuffer.slice(newline + 1);
      completeScan(line);
      newline = outputBuffer.indexOf("\n");
    }
  });
  child.once("error", resetScanner);
  child.once("exit", resetScanner);
  return child;
}

export function zigAvailable(extensionPath: string): boolean {
  return Boolean(binaryPath(extensionPath));
}

function scanWithZig(sessionPath: string, extensionPath: string): Promise<number[] | undefined> {
  if (!getScanner(extensionPath)) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    let request: PendingScan;
    const timer = setTimeout(() => {
      if (activeScan === request) {
        scanner?.kill();
        resetScanner();
      } else {
        const queuedIndex = queuedScans.indexOf(request);
        if (queuedIndex >= 0) queuedScans.splice(queuedIndex, 1);
        resolve(undefined);
      }
    }, 5000);
    request = { path: sessionPath, resolve, timer };
    queuedScans.push(request);
    sendNextScan();
  });
}

export async function computeUsageWithZig(
  sessionPath: string,
  extensionPath: string,
  metadata: ZigSessionMetadata,
  baseOverheadTokens = 0,
): Promise<Usage | undefined> {
  const values = await scanWithZig(sessionPath, extensionPath);
  if (!values || values[0] <= 0 || metadata.contextSize <= 0) return undefined;
  const [promptTokens, completionTokens] = values;
  const occupiedTokens = promptTokens + completionTokens + Math.max(0, baseOverheadTokens);
  return {
    promptTokens,
    completionTokens,
    occupiedTokens,
    contextSize: metadata.contextSize,
    ratio: occupiedTokens / metadata.contextSize,
    modelId: metadata.modelId,
    mode: metadata.mode,
    promptBreakdown: [],
    toolNames: [],
  };
}

export function stopZigScanner(): void {
  const child = scanner;
  resetScanner();
  child?.kill();
}
