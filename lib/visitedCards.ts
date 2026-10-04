import { monthNames } from "./i18n";
import type { TripVisibility } from "./types";

/** "July 2011", "2011" or "" — deterministic month names, never `Intl`, like
 * every other date on the site. */
export function entryWhen(e: Pick<VisitedCardData, "year" | "month">, locale: string): string {
  if (e.year === undefined) return "";
  if (e.month === undefined) return String(e.year);
  const month = monthNames(locale)[e.month - 1];
  return locale === "hu" ? `${e.year}. ${month}` : `${month} ${e.year}`;
}

/**
 * A country visited without a trip, as the trips page draws it — B2914.
 * Built on the server from `visibleVisits` only, so nothing here is an entry
 * this reader may not see. `visibility` is present for the owner alone.
 */
export type VisitedCardData = {
  code: string;
  /** This reader's own name for the country. */
  name: string;
  places?: string;
  year?: number;
  month?: number;
  note?: string;
  /** Served address of the one photograph, or absent. */
  photo?: string;
  visibility?: TripVisibility;
};

/** Where an entry sorts among trips (`YYYY-MM-DD`), or null when undated. A
 * year alone sorts at its January. */
function entrySortDate(e: Pick<VisitedCardData, "year" | "month">): string | null {
  if (e.year === undefined) return null;
  return `${e.year}-${String(e.month ?? 1).padStart(2, "0")}-01`;
}

export type PastItem<T> = { kind: "trip"; trip: T } | { kind: "entry"; entry: VisitedCardData };

/**
 * The Past group: trips (already newest first by `start`) with the entries
 * merged in by date, newest first; undated entries go last. Ties put the trip
 * first. Pure, so the order is testable without a render.
 */
export function mergeEntriesIntoPast<T extends { start: string }>(
  past: T[],
  entries: VisitedCardData[],
): PastItem<T>[] {
  const dated = entries
    .filter((e) => entrySortDate(e) !== null)
    .sort((a, b) => entrySortDate(b)!.localeCompare(entrySortDate(a)!));
  const undated = entries.filter((e) => entrySortDate(e) === null);
  const out: PastItem<T>[] = [];
  let i = 0;
  for (const trip of past) {
    while (i < dated.length && entrySortDate(dated[i])! > trip.start) {
      out.push({ kind: "entry", entry: dated[i++] });
    }
    out.push({ kind: "trip", trip });
  }
  for (; i < dated.length; i++) out.push({ kind: "entry", entry: dated[i] });
  for (const entry of undated) out.push({ kind: "entry", entry });
  return out;
}
