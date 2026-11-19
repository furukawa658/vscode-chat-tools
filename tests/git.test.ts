import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkpoint, diffSummary, GitIndexLockedError } from "../src/core/git";

const g = (cwd: string, ...a: string[]) => execFileSync("git", a, { cwd, encoding: "utf8" }).trim();

describe("checkpoint", () => {
  test("作業ブランチを変えず専用参照へ記録する", () => {
    const d = mkdtempSync(join(tmpdir(), "repo-"));
    g(d, "init", "-b", "main");
    g(d, "config", "user.email", "a@b.c");
    g(d, "config", "user.name", "t");
    writeFileSync(join(d, "a.txt"), "1");
    g(d, "add", "a.txt");
    g(d, "commit", "-m", "init");
    const head = g(d, "rev-parse", "HEAD");
    writeFileSync(join(d, "b.txt"), "未追跡");
    const c = checkpoint(d, "refs/eien/checkpoint", join(mkdtempSync(join(tmpdir(), "idx-")), "index"), "eien checkpoint #0 (baseline)");
    expect(g(d, "rev-parse", "HEAD")).toBe(head);
    expect(g(d, "rev-parse", `${c}^`)).toBe(head);
    expect(g(d, "rev-parse", "refs/eien/checkpoint")).toBe(c!);
    expect(g(d, "show", "--stat", "--format=", c!)).toContain("b.txt");
    expect(g(d, "status", "--short")).toBe("?? b.txt");
    writeFileSync(join(d, "b.txt"), "2");
    const next = checkpoint(d, "refs/eien/checkpoint", join(mkdtempSync(join(tmpdir(), "idx-")), "index"), "eien checkpoint #1 (intervention)");
    expect(g(d, "rev-parse", `${next}^`)).toBe(c!);
  }, 30_000);

  test("通常indexのロック中はスキップする", () => {
    const d = mkdtempSync(join(tmpdir(), "repo-"));
    g(d, "init", "-b", "main");
    g(d, "config", "user.email", "a@b.c");
    g(d, "config", "user.name", "t");
    writeFileSync(join(d, "a.txt"), "1");
    g(d, "add", "a.txt");
    g(d, "commit", "-m", "init");
    writeFileSync(join(d, ".git", "index.lock"), "locked");
    expect(() => checkpoint(d, "refs/eien/checkpoint", join(mkdtempSync(join(tmpdir(), "idx-")), "index"), "cp #0"))
      .toThrow(GitIndexLockedError);
  }, 15_000);

  test("差分概要を指定ファイルへ限定する", () => {
    const d = mkdtempSync(join(tmpdir(), "repo-"));
    g(d, "init", "-b", "main");
    g(d, "config", "user.email", "a@b.c");
    g(d, "config", "user.name", "t");
    writeFileSync(join(d, "a.txt"), "1\n");
    writeFileSync(join(d, "b.txt"), "1\n");
    g(d, "add", ".");
    g(d, "commit", "-m", "init");
    writeFileSync(join(d, "a.txt"), "2\n");
    writeFileSync(join(d, "b.txt"), "2\n");
    const summary = diffSummary([d], [join(d, "a.txt")]);
    expect(summary).toContain("a.txt");
    expect(summary).not.toContain("b.txt");
  }, 15_000);
});
