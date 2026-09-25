/**
 * Where ingest writes, worked out without importing the site's content model.
 *
 * `lib/trips.ts` and `lib/media.ts` are the authority on these paths, but they
 * sit behind `server-only` (through `lib/users.ts`), which throws the moment a
 * plain Node process imports them. Ingest is a CLI, so it restates the two
 * rules it needs — where a trip's folder is, and how a media file is addressed
 * in frontmatter — rather than dragging a React Server Component guard into a
 * terminal.
 *
 * The duplication is small and pinned: test/ingest-paths.test.ts asserts these
 * agree with `lib/trips.ts` and `lib/media.ts` exactly, so if the layout ever
 * moves, that test fails rather than ingest quietly writing to the old place.
 */
import path from "node:path";

/** Same rule as `lib/trips.ts`: lowercase, digits, dashes, no leading dash. */
export const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export function contentRoot(): string {
  return process.env.CONTENT_DIR ?? path.join(process.cwd(), "content");
}

export function tripDir(username: string, tripId: string): string {
  return path.join(contentRoot(), username, "trips", tripId);
}

export function entriesDir(username: string, tripId: string): string {
  return path.join(tripDir(username, tripId), "entries");
}

export function mediaDir(username: string, tripId: string): string {
  return path.join(tripDir(username, tripId), "media");
}

/**
 * The `src` that goes in frontmatter: trip-relative, with no username.
 *
 * This is load-bearing. `lib/entries.ts` prefixes the owner at read time, and
 * writing a username in here would produce `/alice/media/alice/…` on the page
 * and break the moment content is handed to someone else.
 */
export function frontmatterSrc(tripId: string, relativePath: string): string {
  return `/media/${tripId}/${relativePath.split(path.sep).join("/")}`;
}


/** The import ledger, at the trip root so a copied trip carries its history. */
export function manifestFile(username: string, tripId: string): string {
  return path.join(tripDir(username, tripId), ".ingest.json");
}
