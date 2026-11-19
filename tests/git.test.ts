import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkpoint } from "../src/core/git";

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
    const c = checkpoint(d, "refs/eien/checkpoint", join(mkdtempSync(join(tmpdir(), "idx-")), "index"), "cp");
    expect(g(d, "rev-parse", "HEAD")).toBe(head);
    expect(g(d, "rev-parse", "refs/eien/checkpoint")).toBe(c!);
    expect(g(d, "show", "--stat", "--format=", c!)).toContain("b.txt");
    expect(g(d, "status", "--short")).toBe("?? b.txt");
  });
});
