import "server-only";
import { commentRepo } from "./repos";
import type { StoredComment } from "./repos/types";

export type { StoredComment } from "./repos/types";

/** Longest comment, in characters. */
export const COMMENT_MAX_LENGTH = 500;
/** How many comments show before "Show all". */
export const COMMENTS_SHOWN = 3;
/** Comments one author may write per trip in 24 hours. */
export const COMMENTS_PER_AUTHOR_PER_DAY = 30;

/**
 * Comments under a day, for route handlers. A thin façade over `lib/repos`,
 * like `lib/reactions.ts`: database or JSON file, decided there.
 */
export async function listComments(tripId: string, daySlug: string, limit?: number) {
  return (await commentRepo()).list(tripId, daySlug, limit);
}
export async function getComment(tripId: string, daySlug: string, id: string) {
  return (await commentRepo()).get(tripId, daySlug, id);
}
export async function addComment(comment: Omit<StoredComment, "id" | "editedAt">) {
  return (await commentRepo()).add(comment);
}
export async function editComment(tripId: string, daySlug: string, id: string, body: string) {
  return (await commentRepo()).update(tripId, daySlug, id, body);
}
export async function deleteComment(tripId: string, daySlug: string, id: string) {
  return (await commentRepo()).remove(tripId, daySlug, id);
}
export async function commentsWrittenSince(tripId: string, authorEmail: string, sinceIso: string) {
  return (await commentRepo()).countByAuthorSince(tripId, authorEmail, sinceIso);
}
