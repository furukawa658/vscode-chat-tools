import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

function git(cwd: string, args: string[], env?: NodeJS.ProcessEnv): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, ...env }, maxBuffer: 20 * 1024 * 1024 });
}

export function isRepo(cwd: string): boolean {
  try {
    return git(cwd, ["rev-parse", "--is-inside-work-tree"]).trim() === "true";
  } catch {
    return false;
  }
}

function pathspecsFor(folder: string, files: string[]): string[] {
  return files.flatMap((file) => {
    const path = isAbsolute(file) ? relative(folder, file).replaceAll("\\", "/") : file;
    return path === "" || path === ".." || path.startsWith("../") ? [] : [`:(literal)${path}`];
  });
}

/** 全フォルダーまたは指定ファイルの変更概要(status + diff --stat)を返す。 */
export function diffSummary(folders: string[], files: string[] = []): string {
  const out: string[] = [];
  for (const f of folders) {
    if (!isRepo(f)) continue;
    const patterns = pathspecsFor(f, files);
    if (files.length > 0 && patterns.length === 0) continue;
    const pathArgs = files.length > 0 ? ["--", ...patterns] : [];
    const statusArgs = ["status", "--short", "--branch", ...pathArgs];
    const statArgs = ["diff", "HEAD", "--stat", ...pathArgs];
    const status = git(f, statusArgs).trim();
    const stat = git(f, statArgs).trim();
    if (files.length === 0 || stat || status.split(/\r?\n/).slice(1).some(Boolean)) {
      out.push(`### ${f}\n\`\`\`\n${status}\n${stat}\n\`\`\``);
    }
  }
  return out.join("\n\n");
}

export class GitIndexLockedError extends Error {}

/** 作業ブランチ・既定インデックスに触れず、一時インデックスで作業ツリーを専用参照へ記録する。 */
export function checkpoint(cwd: string, refName: string, tmpIndex: string, message: string): string | undefined {
  if (!isRepo(cwd)) return undefined;
  const reportedIndexLock = git(cwd, ["rev-parse", "--git-path", "index.lock"]).trim();
  const indexLock = isAbsolute(reportedIndexLock) ? reportedIndexLock : resolve(cwd, reportedIndexLock);
  if (existsSync(indexLock)) throw new GitIndexLockedError("Git index is locked");
  const env = { GIT_INDEX_FILE: tmpIndex };
  const head = (() => {
    try {
      return git(cwd, ["rev-parse", "--verify", "HEAD"]).trim();
    } catch {
      return "";
    }
  })();
  const previousCheckpoint = (() => {
    try {
      return git(cwd, ["rev-parse", "--verify", refName]).trim();
    } catch {
      return "";
    }
  })();
  if (head) git(cwd, ["read-tree", head], env);
  git(cwd, ["add", "-A"], env);
  const tree = git(cwd, ["write-tree"], env).trim();
  const isBaseline = /checkpoint #0(?:\s|\(|$)/.test(message);
  const parent = isBaseline ? head : previousCheckpoint || head;
  const args = ["-c", "commit.gpgsign=false", "commit-tree", tree, "-m", message];
  if (parent) args.push("-p", parent);
  const commit = git(cwd, args).trim();
  git(cwd, ["update-ref", refName, commit]);
  return commit;
}
