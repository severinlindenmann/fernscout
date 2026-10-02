import "server-only";
import { AS_AUTHOR, getAllEntries } from "@/lib/entries";
import { getTrips } from "@/lib/trips";

/**
 * Every tag this journal's own days have used before, most used first —
 * B2675, so Preview can offer "used before" tags with nothing sent to a
 * model. Drawn straight from the entries on disk (draft and published
 * alike, the owner's own full view — `AS_AUTHOR`) rather than a kept index:
 * a journal's days are cheap enough to scan fresh on every ask, and a kept
 * index is one more thing that can drift from what is actually on disk.
 *
 * `trip` narrows to one trip's own days; `q` is a plain substring match,
 * case-insensitive (a tag is already lowercase on disk, but a typed query
 * might not be).
 */
export function tagsUsedBefore(username: string, opts: { trip?: string; q?: string } = {}): string[] {
  const counts = new Map<string, number>();
  const trips = opts.trip ? getTrips(username).filter((t) => t.id === opts.trip) : getTrips(username);
  for (const trip of trips) {
    for (const entry of getAllEntries(trip.ref, AS_AUTHOR)) {
      for (const tag of entry.tags) {
        counts.set(tag, (counts.get(tag) ?? 0) + 1);
      }
    }
  }
  const q = opts.q?.trim().toLowerCase();
  return [...counts.entries()]
    .filter(([tag]) => !q || tag.includes(q))
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tag]) => tag);
}
