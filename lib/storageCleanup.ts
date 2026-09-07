import "server-only";
import fs from "node:fs";
import path from "node:path";

import { listInbox, removeInboxFile } from "./inbox";
import { clearPrunedFiles, getPhotobookOrder, listPrintedOrderIds } from "./photobook/orders";
import { dirBytes } from "./storageQuota";
import { userDir } from "./users";

/**
 * Getting space back without deleting anybody's journey — B664.
 *
 * A full journal is usually full of things nobody wants: half a dozen
 * photobook PDFs generated while choosing a layout, dry-run postcard sheets
 * for cards that went in the post months ago. Until now the only lever an
 * owner had when they were told they were nearly full was the one that costs
 * money.
 *
 * **What this deletes is generated output, and only that.** Every photograph,
 * every day, every trip, and every *record* of a printed book or a posted card
 * survives — the `print_orders` row keeps its price, its date and its page
 * count, and the order still says it was printed. What comes off the disk is
 * the PDF, which is re-buildable from photographs that are still there.
 * `clearPrunedFiles` is the same bookkeeping `pruneOldPhotobooks` already does
 * when it prunes by count (B483), so a page that offered a download stops
 * offering one rather than 404ing.
 *
 * **A book still building is never touched.** Only orders that reached
 * `printed` are candidates, which is the same rule and the same reason as
 * retention's: a `submitted` row is a build in progress, and pulling its
 * directory out from under it would be the one way this could break something
 * that was working.
 *
 * **Staged files are opt-in and separate.** The inbox holds photographs
 * somebody has not filed yet — deleting those on a button press is exactly the
 * irreversible thing this codebase is careful about — so `includeStagedFiles`
 * covers `inbox/files/` (the documents nothing reads yet) and nothing else.
 * Staged photographs are never in scope; they are removed one at a time
 * through `DELETE /api/v1/<user>/inbox/<id>`, where a person is looking at
 * what they are removing.
 */

export type CleanupPlan = {
  /** What would go, in bytes, per category. */
  photobooks: number;
  postcards: number;
  stagedFiles: number;
  /** The total, so a caller does not add up a shape that may grow a field. */
  bytes: number;
  files: number;
};

export type CleanupResult = CleanupPlan & { done: true };

/** Every `postcards/<id>` directory. Dry-run sends leave sheets here; the
 * order rows they belong to live in the database and are not touched. */
function postcardDirs(username: string): string[] {
  const root = path.join(userDir(username), "postcards");
  try {
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => path.join(root, e.name));
  } catch {
    return [];
  }
}

/** The photobook order directories it is safe to remove. */
async function prunablePhotobookDirs(username: string): Promise<{ id: string; dir: string }[]> {
  const root = path.join(userDir(username), "photobooks");
  const printed = new Set(await listPrintedOrderIds(username));
  try {
    return fs
      .readdirSync(root, { withFileTypes: true })
      .filter((e) => e.isDirectory() && printed.has(e.name))
      .map((e) => ({ id: e.name, dir: path.join(root, e.name) }));
  } catch {
    return [];
  }
}

/** How many files are under a path, for a confirmation that counts them. */
function fileCount(at: string): number {
  let total = 0;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(at, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) total += fileCount(path.join(at, entry.name));
    else total += 1;
  }
  return total;
}

/**
 * What a cleanup would take, without taking it.
 *
 * The confirmation an owner sees is built from this. Somebody who has just
 * been told their journal is full is the person most likely to press the first
 * button they see, so the number and the categories are named before anything
 * is deleted rather than reported after.
 */
export async function cleanupPlan(
  username: string,
  includeStagedFiles = false,
): Promise<CleanupPlan> {
  const books = await prunablePhotobookDirs(username);
  const photobooks = books.reduce((n, b) => n + dirBytes(b.dir), 0);
  const cards = postcardDirs(username);
  const postcards = cards.reduce((n, dir) => n + dirBytes(dir), 0);

  const staged = includeStagedFiles ? listInbox(username).files : [];
  const stagedFiles = staged.reduce((n, entry) => n + entry.bytes, 0);

  return {
    photobooks,
    postcards,
    stagedFiles,
    bytes: photobooks + postcards + stagedFiles,
    files:
      books.reduce((n, b) => n + fileCount(b.dir), 0) +
      cards.reduce((n, dir) => n + fileCount(dir), 0) +
      staged.length,
  };
}

/** Do it. Answers with what was actually taken. */
export async function runCleanup(
  username: string,
  includeStagedFiles = false,
): Promise<CleanupResult> {
  const plan = await cleanupPlan(username, includeStagedFiles);

  for (const book of await prunablePhotobookDirs(username)) {
    fs.rmSync(book.dir, { recursive: true, force: true });
    // The row survives and is marked, so nothing offers a download of a file
    // that is no longer there.
    const order = await getPhotobookOrder(username, book.id);
    if (order && !order.payload.pruned) await clearPrunedFiles(username, book.id, order.payload);
  }

  for (const dir of postcardDirs(username)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  if (includeStagedFiles) {
    for (const entry of listInbox(username).files) removeInboxFile(username, entry.id);
  }

  return { ...plan, done: true };
}
