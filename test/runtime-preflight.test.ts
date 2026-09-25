import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { harnessSkillsLinkTarget, lockfileHash, parseWorktreeList } from "../scripts/worktree-bootstrap-lib.mjs";
import { repositoryNodeError, requiredNodeVersion } from "../scripts/runtime-preflight.mjs";

const roots: string[] = [];

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-runtime-"));
  roots.push(root);
  fs.writeFileSync(path.join(root, ".nvmrc"), "24.20.0\n");
  fs.writeFileSync(path.join(root, "package-lock.json"), "lock\n");
  return root;
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("repository runtime preflight", () => {
  it("reads and accepts the exact pinned Node version", () => {
    const root = fixture();
    expect(requiredNodeVersion(root)).toBe("24.20.0");
    expect(repositoryNodeError(root, "24.20.0")).toBeNull();
  });

  it("gives an actionable error for a different Node version", () => {
    const error = repositoryNodeError(fixture(), "18.16.1");
    expect(error).toContain("Node 18.16.1 is active");
    expect(error).toContain("requires Node 24.20.0 from .nvmrc");
    expect(error).toContain("nvm use");
  });
});

describe("worktree bootstrap helpers", () => {
  it("finds the main checkout in porcelain worktree output", () => {
    const entries = parseWorktreeList(
      "worktree /repo\nHEAD abc\nbranch refs/heads/main\n\n" +
        "worktree /repo/.claude/worktrees/b1\nHEAD def\nbranch refs/heads/b1\n",
    );
    // `parseWorktreeList` lives in a .mjs lib, so its rows arrive untyped here
    // and `noImplicitAny` refuses a bare parameter. Named at the call site
    // rather than loosened in tsconfig.
    type WorktreeRow = Record<string, string | true>;
    expect(
      (entries as WorktreeRow[]).find((entry) => entry.branch === "refs/heads/main")?.worktree,
    ).toBe("/repo");
  });

  it("hashes lockfile content deterministically", () => {
    const root = fixture();
    const first = lockfileHash(path.join(root, "package-lock.json"));
    expect(lockfileHash(path.join(root, "package-lock.json"))).toBe(first);
    fs.appendFileSync(path.join(root, "package-lock.json"), "changed\n");
    expect(lockfileHash(path.join(root, "package-lock.json"))).not.toBe(first);
  });
});

describe("harnessSkillsLinkTarget", () => {
  it("links when a harness sits beside the main checkout and the worktree has none of its own", () => {
    const present = new Set(["/harness/.claude/skills"]);
    expect(harnessSkillsLinkTarget("/harness/app", "/harness/app/.claude/worktrees/wt", (p) => present.has(p))).toBe(
      "/harness/.claude/skills",
    );
  });

  it("does nothing without a harness (today's layout)", () => {
    expect(harnessSkillsLinkTarget("/repo", "/repo/.claude/worktrees/wt", () => false)).toBeNull();
  });

  it("does nothing when the worktree already tracks or links its own .claude/skills", () => {
    const present = new Set(["/harness/.claude/skills", "/harness/app/.claude/worktrees/wt/.claude/skills"]);
    expect(harnessSkillsLinkTarget("/harness/app", "/harness/app/.claude/worktrees/wt", (p) => present.has(p))).toBeNull();
  });
});
