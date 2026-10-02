import { journalPath } from "@/lib/journalPath";

/**
 * Where "Preview →" goes once a day (and every split part of it) is saved —
 * B2676 decision 9, pointed at Preview itself (B2677) now that it exists:
 * `/studio/day/preview?trip=&date=`, which finds every draft part of that
 * date on its own rather than needing the caller to list them.
 */
export function writePreviewUrl(username: string, _firstSlug: string, tripId: string, date: string): string {
  const params = new URLSearchParams({ trip: tripId, date });
  return `${journalPath(username)}/studio/day/preview?${params.toString()}`;
}
