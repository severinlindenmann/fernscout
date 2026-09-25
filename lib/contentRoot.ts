import fs from "node:fs";
import path from "node:path";

/**
 * Where the markdown lives.
 *
 * Read on every call rather than captured once, so tests can point at a
 * fixture directory without reloading modules. Set CONTENT_DIR to override.
 */
export function contentRoot(): string {
  return process.env.CONTENT_DIR ?? path.join(process.cwd(), "content");
}

/** Thrown by `assertContentRootWritable()` — a name to catch, rather than the
 *  bare `EACCES`/`EPERM` node would otherwise throw partway through a write
 *  this script never checked for first. */
export class ContentRootNotWritableError extends Error {}

/**
 * Refuse loudly, before anything is written, if the content root is not
 * writable by whoever is running this process — B1246.
 *
 * A root created by a different uid (commonly: the first `reconcile` to run
 * after a fresh deploy, under whichever uid happened to start it first) is
 * owned by that uid forever after, and every later signup, registry
 * reconcile, postcard render or photobook build throws an uncaught `EACCES`
 * partway through — a five-hour outage with no health signal the first time
 * this happened. Every entry point under `scripts/` that writes under
 * `contentRoot()` calls this first, so the refusal is the same message
 * everywhere rather than a copy nobody remembers to keep in sync.
 *
 * **Refuses only — never chowns.** A script that fixes its own permissions is
 * itself privilege-widening, and it cannot know which uid the *rest* of the
 * deployment expects to own this directory; the fix is a person's command,
 * named here so it is a copy-paste rather than a guess.
 */
export function assertContentRootWritable(): void {
  const root = contentRoot();
  try {
    fs.mkdirSync(root, { recursive: true });
    fs.accessSync(root, fs.constants.W_OK);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "EACCES" && code !== "EPERM") throw err;
    const owner = (() => {
      try {
        return fs.statSync(root).uid;
      } catch {
        return null;
      }
    })();
    const me = process.getuid ? process.getuid() : null;
    throw new ContentRootNotWritableError(
      `${root} is not writable${me !== null ? ` by uid ${me}` : ""}` +
        `${owner !== null ? ` (owned by uid ${owner})` : ""}. ` +
        `Run: sudo chown -R fernscout:fernscout ${root}`,
    );
  }
}
