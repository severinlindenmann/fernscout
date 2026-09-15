import "server-only";
import fs from "node:fs";
import path from "node:path";
import { readManifest } from "./manifest";
import { runDir, stagingRoot } from "./paths";
import { removeRun } from "./store";

/** Two days. Long enough to do this over an evening and the next one, short
 *  enough that somebody's whole camera roll is not sitting on a server they
 *  have forgotten about. **Stated to the person on the resume screen** — a
 *  clock nobody is told about is one they discover by losing something. */
export const RUN_TTL_MS = 48 * 60 * 60 * 1000;

/**
 * Delete every run past its own `expiresAt`.
 *
 * A run whose manifest will not parse has no `expiresAt` to honour, so it
 * falls back to the directory's own mtime against `RUN_TTL_MS`. Without that
 * branch, one unreadable manifest pins somebody's photographs on disk forever
 * — which is the single outcome this file exists to prevent.
 */
export function sweepStaging(now: Date): { removed: string[] } {
  const removed: string[] = [];
  let owners: string[];
  try {
    owners = fs.readdirSync(stagingRoot());
  } catch {
    return { removed };
  }
  for (const owner of owners) {
    let runs: string[];
    try {
      runs = fs.readdirSync(path.join(stagingRoot(), owner));
    } catch {
      continue;
    }
    for (const runId of runs) {
      const manifest = readManifest(owner, runId);
      const expired = manifest
        ? manifest.expiresAt <= now.toISOString()
        : now.getTime() - safeMtime(owner, runId) > RUN_TTL_MS;
      if (!expired) continue;
      removeRun(owner, runId);
      removed.push(runId);
    }
  }
  return { removed };
}

function safeMtime(owner: string, runId: string): number {
  try {
    return fs.statSync(runDir(owner, runId)).mtimeMs;
  } catch {
    return 0;
  }
}
