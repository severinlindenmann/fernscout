import { isTooRecent } from "./mapSafety";

/**
 * B-2998 — why a map may show nothing. Only counts leave the server, never a
 * position, and never a hint that a recording exists.
 */
export type MapNoteFlags = {
  /** Visible days a reader without live access is still holding back (the recency window). 0 for live readers and the owner. */
  delayedDays: number;
  /** Owner only: visible days with no coordinates, anchor or photo pin. */
  daysWithoutPosition: number;
};

export function mapNoteFlags(
  days: readonly { date: string; hasPlace: boolean; hidden?: boolean }[],
  pinDates: ReadonlySet<string>,
  live: boolean,
  owner: boolean,
  now = Date.now(),
): MapNoteFlags {
  return {
    delayedDays: owner ? 0 : days.filter((d) => isTooRecent(d.date, live, now)).length,
    daysWithoutPosition: owner ? days.filter((d) => !d.hasPlace && !d.hidden && !pinDates.has(d.date)).length : 0,
  };
}

/** Which note, if any: only when no place is drawn at all. */
export function mapNoteToShow(placesDrawn: number, flags?: MapNoteFlags): "delayed" | "unplaced" | null {
  if (!flags || placesDrawn > 0) return null;
  if (flags.delayedDays > 0) return "delayed";
  if (flags.daysWithoutPosition > 0) return "unplaced";
  return null;
}
