// The reaction set and its types. Pure — no filesystem — so client components
// can import it. The storage half lives in lib/reactions.ts (server-only).

/** Fixed site-wide rather than per-entry, so counts mean the same thing on
 * every day and there's nothing extra to fill in when writing one from the
 * road. Affection, awe, amusement — enough range for a travel photo. */
export const REACTIONS = ["❤️", "🤩", "😂"] as const;

export type Reaction = (typeof REACTIONS)[number];

export function isReaction(v: unknown): v is Reaction {
  return typeof v === "string" && (REACTIONS as readonly string[]).includes(v);
}

/** emoji → how many people picked it, for one day. */
export type DayCounts = Partial<Record<Reaction, number>>;

/** day slug → counts. What the API hands back. */
export type ReactionCounts = Record<string, DayCounts>;

/** Day slugs repeat across trips, so a vote is keyed by both. Pure, so both
 * the server-only store and the client provider can build the same key. */
export function reactionKey(tripId: string, daySlug: string): string {
  return `${tripId}:${daySlug}`;
}
