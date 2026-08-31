import { getDatabaseOrNull } from "../db";
import { fileReactionRepo } from "./reactionsFile";
import { filePushRepo } from "./pushFile";
import type { PushRepo, ReactionRepo } from "./types";

export type { PushRepo, ReactionRepo, StoredSubscription, VoteResult } from "./types";

/**
 * Which backend a repository gets.
 *
 * The rule is one line long: **if a database is configured, use it; otherwise
 * use the file store.** Callers never ask, and never learn which of the two
 * dialects a database turned out to be.
 *
 * Deliberately *not* wired to `isEnabled("reactions")` — whether a feature is
 * on is a different question from where its data lives, and conflating them is
 * how you end up with a feature that silently changes storage when an
 * unrelated flag moves.
 *
 * Equally deliberately, a database that is configured but unreachable is an
 * error rather than a fall back to the file store. Splitting writes across two
 * backends is the one failure here that isn't recoverable afterwards: the
 * reactions would be in a JSON file nobody thinks to look at.
 */
export async function reactionRepo(): Promise<ReactionRepo> {
  const handle = await getDatabaseOrNull();
  if (!handle) return fileReactionRepo();
  const { dbReactionRepo } = await import("./reactionsDb");
  return dbReactionRepo(handle);
}

export async function pushRepo(): Promise<PushRepo> {
  const handle = await getDatabaseOrNull();
  if (!handle) return filePushRepo();
  const { dbPushRepo } = await import("./pushDb");
  return dbPushRepo(handle);
}
