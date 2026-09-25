import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * A private harness may keep this repository's `.claude/skills` one directory
 * above the app checkout (see B2253). Claude Code only discovers
 * `.claude/skills` up to the nearest git root, so a session started inside an
 * app worktree cannot see them. When the harness exists and the worktree has
 * no skills directory of its own, link the harness's into the worktree.
 *
 * Returns the harness skills path to link to, or null when there is nothing
 * to do (no harness, or the worktree already has its own `.claude/skills`
 * — a real directory or a leftover link from a previous bootstrap).
 */
/** @param {string} mainWorktree @param {string} worktreeRoot @param {(p: string) => boolean} [exists] */
export function harnessSkillsLinkTarget(mainWorktree, worktreeRoot, exists = (p) => fs.existsSync(p)) {
  const harnessSkills = path.join(path.dirname(mainWorktree), ".claude", "skills");
  const worktreeSkills = path.join(worktreeRoot, ".claude", "skills");
  if (!exists(harnessSkills) || exists(worktreeSkills)) return null;
  return harnessSkills;
}

export function parseWorktreeList(text) {
  return text
    .trim()
    .split(/\n\n+/)
    .map((block) => Object.fromEntries(block.split("\n").map((line) => {
      const separator = line.indexOf(" ");
      return separator === -1 ? [line, true] : [line.slice(0, separator), line.slice(separator + 1)];
    })));
}

export function lockfileHash(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}
