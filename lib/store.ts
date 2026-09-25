import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import { dataDir } from "./dataDir";

/**
 * A tiny append-safe JSON store.
 *
 * Deliberately not a database: the whole site is markdown in git, and the only
 * mutable state is reaction counts and push subscriptions — a few tens of KB
 * that should be readable with `cat` and backed up with `cp`.
 *
 * Two things make it safe enough:
 *
 *  - **Atomic writes.** We write a temp file and `rename()` it over the target.
 *    On POSIX that swap is atomic, so a crash mid-write leaves the previous
 *    file intact rather than a truncated one.
 *  - **A per-file queue.** Node is single-threaded, but `await` between reading
 *    and writing is an interleaving point: two votes arriving together would
 *    both read the old counts, and the second write would erase the first.
 *    Every mutation for a file goes through one promise chain instead.
 *
 * The queue is per-process, so this assumes a single Node process. Under pm2
 * use fork mode, not cluster. Setting DATABASE_URL removes that constraint —
 * see lib/repos, which picks the database over this file store when there is
 * one.
 */

const queues = new Map<string, Promise<unknown>>();

function enqueue<T>(file: string, job: () => Promise<T>): Promise<T> {
  const prev = queues.get(file) ?? Promise.resolve();
  // Run regardless of whether the previous job resolved or rejected, so one
  // failed write can't wedge the queue for the lifetime of the process.
  const next = prev.then(job, job);
  queues.set(
    file,
    next.catch(() => undefined),
  );
  return next;
}

function pathFor(name: string) {
  return path.join(dataDir(), `${name}.json`);
}

export async function readStore<T>(name: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(pathFor(name), "utf8")) as T;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return fallback;
    // A corrupt file shouldn't take the page down — a reader losing their
    // reaction counts is better than a 500 on every request.
    console.error(`[store] ${name} unreadable, using fallback:`, err);
    return fallback;
  }
}

/** Read, transform, write — with the read and write in the same queued job, so
 * concurrent callers see each other's changes. Returns the new value. */
export async function updateStore<T>(
  name: string,
  fallback: T,
  mutate: (current: T) => T,
): Promise<T> {
  const file = pathFor(name);
  return enqueue(file, async () => {
    const current = await readStore(name, fallback);
    const next = mutate(current);
    await fs.mkdir(dataDir(), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(next, null, 2), "utf8");
    await fs.rename(tmp, file);
    return next;
  });
}
