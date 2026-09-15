import path from "node:path";
import { dataDir } from "@/lib/dataDir";

/**
 * Where an import run's bytes sit while somebody is still deciding about them.
 *
 * **Deliberately not under `userDir(username)`.** `journalBytes` in
 * lib/storageQuota.ts walks that directory, and a holding area that counted
 * against the quota would refuse the very upload this feature exists to
 * accept. Out here, three hundred photographs cost the journal nothing until
 * the days they belong to are confirmed.
 */
export function stagingRoot(): string {
  return path.join(dataDir(), "staging");
}

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

/** A path segment that cannot climb out of the staging root.
 *  Thrown rather than sanitised: a caller handing this a traversal is a bug in
 *  the caller, and quietly rewriting it hides that. */
function segment(value: string, what: string): string {
  if (!SEGMENT.test(value)) throw new Error(`${what} is not a usable name: ${JSON.stringify(value)}`);
  return value;
}

export function runDir(username: string, runId: string): string {
  return path.join(stagingRoot(), segment(username, "username"), segment(runId, "run id"));
}

/** Sortable, unique enough, and readable in a directory listing. No randomness
 *  — the instant is all a single-owner run needs, and `Math.random()` is
 *  unavailable in some of the contexts this ends up running in. */
export function newRunId(now: Date): string {
  return `run-${now.toISOString().replace(/[:.]/g, "-")}`;
}
