import type { DayGroup } from "./group";
import type { DayRow, PhotoRow } from "@/lib/staging/manifest";

/**
 * What to ask about a day, in the words to ask it in.
 *
 * **The wording is the feature.** An open prompt ("tell us about this day")
 * reliably gets a sentence; a question assembled out of what the photographs
 * already said reliably gets a paragraph. Every sentence here is built from
 * real facts about this day and nothing else — the weekday, the part of the
 * day, the count, the place name if there is one. No fact, no clause.
 *
 * The English lives in this module, not in `site/locales/`, and that is
 * deliberate — the opposite of the rule everywhere else in this repository.
 * These sentences are assembled from parts at runtime — a weekday, a part of
 * the day, a count, a place — and a locale string with that many
 * interpolations that must all agree grammatically is not translatable in
 * practice; a `{weekday} {part} {place} {count}` template would produce
 * broken German and Hungarian, not merely awkward German and Hungarian.
 *
 * Three a day is a hard ceiling. Nine days at three is twenty-seven answers,
 * which is already a lot to ask of somebody's evening.
 */
export type Question = {
  /** Stable, so an answered question is never asked twice. */
  id: string;
  kind: "opening" | "gap" | "follow-up";
  /** The literal sentence, already assembled from what the photographs said. */
  text: string;
  /** For a gap question: what answering it fills in. */
  fills?: "location" | "people" | "date";
};

export const MAX_QUESTIONS_PER_DAY = 3;

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Morning, afternoon or evening from the first photograph's own clock. Not a
 *  timezone calculation: EXIF wall-clock is the reading on the clock in the
 *  room, which is exactly what this sentence wants. */
function partOfDay(takenAt: string | undefined): string {
  const hour = takenAt ? Number(takenAt.slice(11, 13)) : NaN;
  if (Number.isNaN(hour)) return "";
  if (hour < 12) return "morning";
  if (hour < 18) return "afternoon";
  return "evening";
}

export function questionsForDay(
  group: DayGroup,
  photos: PhotoRow[],
  day: DayRow,
  placeName?: string,
): Question[] {
  const mine = photos.filter((p) => group.photoIds.includes(p.id));
  const count = `${mine.length} photograph${mine.length === 1 ? "" : "s"}`;
  const weekday = group.date ? WEEKDAYS[new Date(`${group.date}T12:00:00Z`).getUTCDay()] : "";
  const when = [weekday, partOfDay(mine[0]?.takenAt)].filter(Boolean).join(" ");
  const where = placeName ? ` in ${placeName}` : "";
  const out: Question[] = [];

  out.push({
    id: `open:${group.date}`,
    kind: "opening",
    text: `It's ${when}${where} and you took ${count}. What were you doing?`,
  });

  if (group.lat === undefined) {
    out.push({
      id: `where:${group.date}`,
      kind: "gap",
      fills: "location",
      // Says *why* rather than showing an error badge. These files were saved
      // from somewhere else and never carried a position — a fact about the
      // photographs, not a failure anybody can be blamed for.
      text:
        `These ${count} don't know where they were — they were saved from somewhere else ` +
        `rather than taken on your phone. Where were you?`,
    });
  }

  out.push({
    id: `after:${group.date}`,
    kind: "follow-up",
    // Specific and sensory. "Anything else?" gets nothing; this either ends the
    // day or opens the next one.
    text: `What happened right after this?`,
  });

  return out.filter((q) => !day.answered.includes(q.id)).slice(0, MAX_QUESTIONS_PER_DAY);
}
