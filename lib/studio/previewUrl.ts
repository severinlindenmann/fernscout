import { journalPath } from "@/lib/journalPath";

/**
 * Where "Preview →" goes once a day (and every split part of it) is saved —
 * B2676, decision 9. Preview itself (B2677) does not exist yet; until it
 * does, this is the existing publish route, which already shows every part
 * and asks before anything goes live. One function, so B2677 changes this
 * one line rather than every caller of it.
 */
export function writePreviewUrl(username: string, firstSlug: string, tripId: string, otherSlugs: readonly string[] = []): string {
  const params = new URLSearchParams({ day: firstSlug, trip: tripId });
  if (otherSlugs.length > 0) params.set("also", otherSlugs.join(","));
  return `${journalPath(username)}/studio/day/publish?${params.toString()}`;
}
