import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

export const SCHEMA_VERSION = 1;

export interface WorkspaceStatus {
  schemaVersion: number;
  workspaceHash: string;
  workspaceRoot: string;
  created: number;
  inProgress: number;
  waitingParent: number;
  needsParentReview: number;
  completed: number;
  escalated: number;
  updatedAt: string;
}

export function workspaceHash(workspaceRoot: string): string {
  return createHash("sha256").update(resolve(workspaceRoot)).digest("hex").slice(0, 12);
}

export function workspaceLabel(workspaceRoot: string): string {
  return basename(resolve(workspaceRoot)) || resolve(workspaceRoot);
}

export function workspaceDatabasePath(storagePath: string, workspaceRoot: string): string {
  return join(storagePath, "workspaces", workspaceHash(workspaceRoot), "state.sqlite");
}

export function statusPath(databasePath: string): string {
  return `${databasePath}.status.json`;
}

export function readWorkspaceStatus(databasePath: string, workspaceRoot: string): WorkspaceStatus {
  const path = statusPath(databasePath);
  try {
    const status = JSON.parse(readFileSync(path, "utf8")) as WorkspaceStatus;
    if (status.workspaceHash === workspaceHash(workspaceRoot)) return status;
  } catch {}
  return {
    schemaVersion: SCHEMA_VERSION,
    workspaceHash: workspaceHash(workspaceRoot),
    workspaceRoot: resolve(workspaceRoot),
    created: 0,
    inProgress: 0,
    waitingParent: 0,
    needsParentReview: 0,
    completed: 0,
    escalated: 0,
    updatedAt: "",
  };
}

export function statusText(statuses: WorkspaceStatus[]): string {
  const counts = statuses.reduce((total, status) => ({
    waitingParent: total.waitingParent + status.waitingParent,
    needsParentReview: total.needsParentReview + status.needsParentReview,
    escalated: total.escalated + status.escalated,
  }), { waitingParent: 0, needsParentReview: 0, escalated: 0 });
  return `$(git-compare) Makaseru Q:${counts.waitingParent} R:${counts.needsParentReview} E:${counts.escalated}`;
}
