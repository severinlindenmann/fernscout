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
/** How much of a day's own words travel back to the screen in a preview. */
export const PREVIEW_CHARACTERS = 600;
