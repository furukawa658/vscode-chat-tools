import { execFileSync } from "node:child_process";

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

/** 全フォルダーの変更概要(status + diff --stat)を返す。 */
export function diffSummary(folders: string[]): string {
  const out: string[] = [];
  for (const f of folders) {
    if (!isRepo(f)) continue;
    const status = git(f, ["status", "--short", "--branch"]).trim();
    const stat = git(f, ["diff", "HEAD", "--stat"]).trim();
    out.push(`### ${f}\n\`\`\`\n${status}\n${stat}\n\`\`\``);
  }
  return out.join("\n\n");
}

/** 作業ブランチ・既定インデックスに触れず、一時インデックスで作業ツリーを専用参照へ記録する。 */
export function checkpoint(cwd: string, refName: string, tmpIndex: string, message: string): string | undefined {
  if (!isRepo(cwd)) return undefined;
  const env = { GIT_INDEX_FILE: tmpIndex };
  const hasHead = (() => {
    try {
      git(cwd, ["rev-parse", "--verify", "HEAD"]);
      return true;
    } catch {
      return false;
    }
  })();
  if (hasHead) git(cwd, ["read-tree", "HEAD"], env);
  git(cwd, ["add", "-A"], env);
  const tree = git(cwd, ["write-tree"], env).trim();
  const args = ["commit-tree", tree, "-m", message];
  if (hasHead) args.push("-p", "HEAD");
  const commit = git(cwd, args).trim();
  git(cwd, ["update-ref", refName, commit]);
  return commit;
}
