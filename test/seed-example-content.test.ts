import { afterEach, beforeEach, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

/**
 * scripts/seed-example-content.mjs must resolve both ends of its copy
 * through CONTENT_DIR, not through the checkout's own path (B238) — a
 * deployed instance's content root lives under DATA_DIR, well outside the
 * checkout, and a journal seeded beside the code instead is invisible to the
 * running site and to the backup.
 */

const ROOT = process.cwd();

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-seed-example-"));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function run(args: string[], env: Record<string, string> = {}) {
  const result = spawnSync("node", ["scripts/seed-example-content.mjs", ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, CONTENT_DIR: dir, ...env },
  });
  return { status: result.status ?? 1, stdout: result.stdout, stderr: result.stderr };
}

test("seeds into CONTENT_DIR, not the checkout, and falls back to the checkout's own example/ as the source", () => {
  const result = run(["--user", "someone"]);
  expect(result.status).toBe(0);

  expect(fs.existsSync(path.join(dir, "someone", "config.json"))).toBe(true);
  expect(fs.existsSync(path.join(ROOT, "content", "someone"))).toBe(false);
  expect(result.stdout).toContain(path.join(dir, "someone"));
});

test("prefers CONTENT_DIR's own example/ as the source when it has one", () => {
  fs.mkdirSync(path.join(dir, "example"), { recursive: true });
  fs.writeFileSync(path.join(dir, "example", "config.json"), JSON.stringify({ title: "custom example" }));

  const result = run(["--user", "someone"]);
  expect(result.status).toBe(0);
  expect(JSON.parse(fs.readFileSync(path.join(dir, "someone", "config.json"), "utf8"))).toEqual({
    title: "custom example",
  });
});

test("refuses to overwrite an existing journal in CONTENT_DIR without --force", () => {
  fs.mkdirSync(path.join(dir, "someone"), { recursive: true });
  const result = run(["--user", "someone"]);
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain(dir);
});
