import "server-only";
import fs from "node:fs";
import path from "node:path";
import { tripDir } from "../trips";

/**
 * One prior version of a day's words — B1218 (D47).
 *
 * "Rückgängig" needs somewhere to keep what a text write is about to
 * overwrite, and the shape follows the same precedent as `.ingest.json`
 * (`lib/ingest/paths.ts`): a hidden file beside the trip's other content,
 * never read by anything that renders the site.
 *
 * **One prior version, and only one.** A second overwrite before anybody
 * pressed undo replaces the stash rather than stacking it — this is a
 * safety net for the last press, not a history of every one.
 */
export type WordsStash = { title: string; content: string };

function undoFile(ref: string, slug: string): string {
  return path.join(tripDir(ref), ".undo", `${slug}.json`);
}

/** Stash the words a write is about to replace, overwriting whatever was
 *  stashed before. Never thrown from: a missed stash costs the next undo,
 *  never the save it is guarding. */
export function stashWords(ref: string, slug: string, previous: WordsStash): void {
  try {
    const file = undoFile(ref, slug);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(previous));
  } catch {
    // See above.
  }
}

/** What is stashed for this day, or nothing when there is no prior version
 *  — or when the file on disk is not what this expects. */
export function stashedWords(ref: string, slug: string): WordsStash | null {
  try {
    const data = JSON.parse(fs.readFileSync(undoFile(ref, slug), "utf8")) as Partial<WordsStash>;
    if (typeof data.title !== "string" || typeof data.content !== "string") return null;
    return { title: data.title, content: data.content };
  } catch {
    return null;
  }
}
