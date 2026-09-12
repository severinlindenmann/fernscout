import "server-only";

/**
 * The fields `PATCH /api/v1/{user}/trips/{trip}` writes — the general door on
 * a trip that already exists.
 *
 * Exported rather than kept local to the route because two other things need
 * to know it and neither should re-type it: `/openapi.json` describes it, and
 * `content-model.json`'s `doors` section (B1577) publishes which call writes
 * each key of `trip.md` so a client stops keeping its own list. AGENTS.md's
 * rule for the contract is that an enum is imported, never typed out, and
 * this is that rule applied to a door rather than to a value.
 *
 * The keys **not** here are not omissions. `visibility`, `listed` and
 * `teaser` have a door of their own with rules this one must not duplicate;
 * `rates`, `people`, `travellers` and `tracks` are each one level down; `id`
 * addresses the trip rather than describing it; `status` is the server's own
 * computation from `start`/`end` (B1521); and `test` is set once at creation.
 * `lib/contentModel/doors.ts` is where each of those is stated with its
 * reason, and a test there fails if a key of `trip.md` appears in neither
 * list.
 */
export const TRIP_DETAIL_FIELDS = [
  "title",
  "tagline",
  "start",
  "end",
  "cover",
  "accent",
  "costsVisibility",
  "intro",
  "translations",
] as const;
