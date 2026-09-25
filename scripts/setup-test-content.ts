#!/usr/bin/env -S npx tsx --conditions=react-server
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

/**
 * B1506. A local test-a-feature run against a plain `npm run dev` writes
 * straight into the tracked content/example/ — owner-established-add-cost-line's
 * PATCH landed in content/example/trips/parks-2025/costs.md and had to be
 * `git checkout --`'d clean afterward. This gives a run its own scratch copy
 * of the demo journal and its own sqlite database instead, so nothing a flow
 * writes ever touches the shared checkout.
 *
 * Usage: npx tsx --conditions=react-server scripts/setup-test-content.ts [--fresh]
 * Prints `export CONTENT_DIR=...` / `export DATABASE_URL=...` lines —
 * `eval "$(…)"` them into the shell that starts `npm run dev`.
 */

const REPO_ROOT = process.cwd();

export function scratchPaths(base: string) {
  return {
    contentDir: path.join(base, "content"),
    dbPath: path.join(base, "fernscout.db"),
  };
}

function main() {
  const base = process.env.FERNSCOUT_TEST_DIR ?? "/tmp/fernscout-test-content";
  const fresh = process.argv.includes("--fresh");
  const { contentDir, dbPath } = scratchPaths(base);

  if (fresh && fs.existsSync(base)) fs.rmSync(base, { recursive: true, force: true });

  if (!fs.existsSync(path.join(contentDir, "example"))) {
    fs.mkdirSync(contentDir, { recursive: true });
    fs.cpSync(path.join(REPO_ROOT, "content", "example"), path.join(contentDir, "example"), { recursive: true });
    console.error(`Copied content/example -> ${contentDir}/example`);
  }

  if (!fs.existsSync(dbPath)) {
    execFileSync("npx", ["tsx", "--conditions=react-server", "scripts/db.mts", "migrate"], {
      cwd: REPO_ROOT,
      env: { ...process.env, DATABASE_URL: `sqlite:${dbPath}` },
      stdio: "inherit",
    });
  }

  console.log(`export CONTENT_DIR=${contentDir}`);
  console.log(`export DATABASE_URL=sqlite:${dbPath}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
