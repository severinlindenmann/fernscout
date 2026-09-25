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
      // A manifest that parsed but carries an unparseable `expiresAt` (e.g.
      // "") is a manifest we cannot trust either — the same stance taken for
      // one that would not parse at all, so it gets the same fallback rather
      // than the two extremes numeric NaN comparisons would otherwise pick.
      const expiresAtMs = manifest ? Date.parse(manifest.expiresAt) : NaN;
      const expired = Number.isNaN(expiresAtMs)
        ? now.getTime() - safeMtime(owner, runId) > RUN_TTL_MS
        : expiresAtMs <= now.getTime();
      if (!expired) continue;
      // `runId` may be a stray, non-run entry (e.g. `.DS_Store`) that fails
      // `runDir`'s segment check. `removeRun` throws in that case; skipping
      // it here — rather than letting the throw escape — keeps one bad
      // directory entry from aborting the sweep for every run after it.
      try {
        removeRun(owner, runId);
      } catch {
        continue;
      }
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
