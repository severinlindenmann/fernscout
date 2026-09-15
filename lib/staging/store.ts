import "server-only";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { runDir } from "./paths";

export type StagedFile = {
  /** Content-addressed, so the same photograph sent twice is stored once. */
  id: string;
  filename: string;
  bytes: number;
  sha256: string;
};

/** The id is the hash plus the extension, for the same reason `inboxId` does
 *  it: a retried half-finished batch must not double the run. */
function idFor(filename: string, sha: string): string {
  const ext = path.extname(filename).toLowerCase().replace(/[^.a-z0-9]/g, "");
  return `${sha.slice(0, 32)}${ext}`;
}

export function putStagedFile(
  username: string,
  runId: string,
  filename: string,
  bytes: Buffer,
): StagedFile {
  const sha = createHash("sha256").update(bytes).digest("hex");
  const id = idFor(filename, sha);
  const dir = path.join(runDir(username, runId), "files");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, id);
  if (!fs.existsSync(file)) fs.writeFileSync(file, bytes);
  return { id, filename, bytes: bytes.byteLength, sha256: sha };
}

// `runDir` validates the two segments and throws; `basename` is what stops
// the third. A caller that has been handed an id from a manifest cannot
// reach outside the run, and one that made an id up gets a path that simply
// is not there.
function stagedFilePath(username: string, runId: string, id: string): string {
  return path.join(runDir(username, runId), "files", path.basename(id));
}

export function readStagedFile(username: string, runId: string, id: string): Buffer | null {
  const file = stagedFilePath(username, runId, id);
  try {
    return fs.readFileSync(file);
  } catch {
    return null;
  }
}

/** The same lookup as `readStagedFile`, but the path rather than the bytes —
 *  for callers like `resizedCopy` that need to stat and cache-key the file
 *  themselves rather than receive a copy of its contents. */
export function stagedFileLocation(username: string, runId: string, id: string): string | null {
  const file = stagedFilePath(username, runId, id);
  return fs.existsSync(file) ? file : null;
}

export function removeRun(username: string, runId: string): void {
  fs.rmSync(runDir(username, runId), { recursive: true, force: true });
}

export function runBytes(username: string, runId: string): number {
  const dir = path.join(runDir(username, runId), "files");
  let total = 0;
  for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
    if (name.isFile()) total += fs.statSync(path.join(dir, name.name)).size;
  }
  return total;
}
