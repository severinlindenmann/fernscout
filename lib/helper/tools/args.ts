/**
 * The arguments more than one tool asks for, and the reasons they are shaped
 * that way — B927 above all: an id the model never handles is an id it cannot
 * get wrong.
 *
 * Shared rather than repeated, because a second copy of `TRIP_ARG` with a
 * kinder description is how two tools come to disagree about what a trip is.
 */
export const TRIP_ARG = {
  trip: {
    type: "string" as const,
    // B927 — never an id the model composed. What the person called it is
    // resolved here against the trips that exist.
    description:
      "The trip as they name it — its title, or part of it. Never invent an id. Omit for the newest.",
  },
};
export const DAY_ARGS = {
  ...TRIP_ARG,
  slug: { type: "string" as const, description: "The day's slug, if one is known." },
  date: { type: "string" as const, description: "The day, as YYYY-MM-DD." },
};
/** Trip and slug only, both terse — for a tool almost always reached by a
 *  chip that already knows both exactly. The `/proposal` route only ever
 *  passes through a key a tool declares here, so this cannot be emptied the
 *  way a property-free read tool's can be; it is kept small instead, since
 *  the token budget is shared by every tool (`test/helper-thread.test.ts`'s
 *  ceiling). */
export const DAY_REF_ARGS = {
  trip: { type: "string" as const, description: "The trip, if known." },
  slug: { type: "string" as const, description: "The day's slug, if known." },
};
/** How much of a day's own words travel back to the screen in a preview. */
export const PREVIEW_CHARACTERS = 600;
