import path from "node:path";

/**
 * Where runtime state lives — reaction counts, push subscriptions, the SQLite
 * file.
 *
 * Set `DATA_DIR` on a server to somewhere outside the repo, so `git pull` and
 * a rebuild can never delete reader data. Read lazily rather than captured at
 * import time, because tests point it at a temp directory after the module
 * graph is already loaded.
 */
export function dataDir(): string {
  const configured = process.env.DATA_DIR;
  if (configured && configured.trim() !== "") return configured;
  return path.join(process.cwd(), ".data");
}
