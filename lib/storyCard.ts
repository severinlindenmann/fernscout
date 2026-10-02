import "server-only";
import type { DayFile } from "./api/v2/documents";
import { isOpenToLink } from "./access";
import { dayUrl } from "./digest/content";
import { translateIn } from "./locales";
import { maySeePhoto, parsePhotoVisibility } from "./photos";
import { serverSite } from "./site";
import type { Trip } from "./types";

/**
 * "Share as a story" — B2665. What goes on a 9:16 card or in the video's
 * bottom panel, and nothing else: every word here is the owner's own (the
 * day's title, its own weather reading, a photo's own caption, the trip's
 * own title) or a derived position ("Day N", the date). Nothing is
 * composed. Kept as a pure function, separate from the `ImageResponse`
 * layout, so a test can assert on the facts without decoding a PNG.
 */
type StoryPhoto = { src: string; caption?: string };

export type StoryFacts = {
  title: string;
  /** What the card's big line actually shows — the day's own title, else its
   * own place, else the trip's own title. Never invented: always one of
   * those three words the owner or a real lookup already supplied. */
  headline: string;
  /** Weekday d Mon yyyy, in the day's own locale. */
  dateLabel: string;
  /** "Day N" — only when the caller could place this day in its trip. */
  dayLabel?: string;
  tripTitle: string;
  place?: string;
  /** "12–24 °C" — omitted when neither bound was recorded. */
  tempLine?: string;
  /** The line under the headline: place and temperature, joined — except
   * the place is dropped when it is already the headline (B2665 round 2),
   * so a day with no title never shows its own place twice. */
  subLine?: string;
  /** Only when the caller decided the trip is public and the day is
   *  published — see `isOpenToLink` + day.status at the call site. Never
   *  decided in here. */
  link?: string;
  photos: StoryPhoto[];
};

function tempLine(day: DayFile): string | undefined {
  const w = day.weather;
  if (!w || w === true) return undefined;
  const min = w.tempMin !== undefined ? Math.round(w.tempMin) : undefined;
  const max = w.tempMax !== undefined ? Math.round(w.tempMax) : undefined;
  if (min === undefined && max === undefined) return undefined;
  if (min === undefined) return `${max} °C`;
  if (max === undefined) return `${min} °C`;
  if (min === max) return `${min} °C`;
  return `${min}–${max} °C`;
}

export function storyCardFacts(args: {
  day: DayFile;
  dayNumber: number | null;
  tripTitle: string;
  /** Resolved by the caller: `null` whenever the link may not be shown. */
  link: string | null;
  locale: string;
}): StoryFacts {
  const { day, dayNumber, tripTitle, link, locale } = args;
  const date = new Date(`${day.date}T00:00:00`);
  const dateLabel = Number.isNaN(date.getTime())
    ? day.date
    : new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", year: "numeric" }).format(
        date,
      );
  const place = day.location || undefined;
  const headline = day.title || place || tripTitle;
  const temp = tempLine(day);
  // The place is dropped from the sub-line once it is already the headline
  // (an untitled day) — never shown twice.
  const subLine = [headline === place ? undefined : place, temp].filter(Boolean).join(" · ") || undefined;
  return {
    title: day.title,
    headline,
    dateLabel,
    dayLabel: dayNumber && dayNumber > 0 ? translateIn(locale, "studio.date.dayOfTrip", { n: String(dayNumber) }) : undefined,
    tripTitle,
    place,
    tempLine: temp,
    subLine,
    link: link ?? undefined,
    photos: storyPhotos(day).map((item) => ({ src: item.src, caption: item.caption })),
  };
}

/** Has at least one letter or digit — Unicode-aware, so a lone "." or "…"
 * (punctuation only, no words) counts as nothing. */
function hasWords(s: string): boolean {
  return /[\p{L}\p{N}]/u.test(s);
}

/** Trimmed to ~200 characters at a word boundary, with a trailing "…" when
 * it was actually cut. */
function clip(s: string, max = 200): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim()}…`;
}

/**
 * "Share as a story"'s own caption (B2665, round 2) — built only from parts
 * that actually hold a word: the day's own title as a sentence, then its
 * own first sentence, the owner's own words only. A title or sentence made
 * only of punctuation (a lone "." or "…") contributes nothing, never a bare
 * "." opening the caption (B2677, bug 16). A sentence with no terminal
 * punctuation is kept whole rather than dropped, trimmed to ~200 characters
 * at a word boundary.
 */
export function storyCaption(day: Pick<DayFile, "title" | "content">): string {
  const title = day.title.trim();
  const titleLine = hasWords(title) ? (/[.!?]$/.test(title) ? title : `${title}.`) : "";

  const content = day.content.trim();
  const match = content.match(/^[^.!?]*[.!?]/)?.[0]?.trim();
  const sentence = clip(match ?? content);
  const sentenceLine = hasWords(sentence) ? sentence : "";

  return [titleLine, sentenceLine].filter(Boolean).join(" ").trim();
}

/**
 * The photographs a story may carry: the day's images, minus any the owner
 * held back with a label of their own. A story goes to a public feed, so a
 * photo kept for a closer circle is never offered for one by default; the
 * owner can still share it by hand from their phone.
 */
export function storyPhotos(day: DayFile): NonNullable<DayFile["media"]> {
  return (day.media ?? []).filter((item) => item.type !== "video" && !parsePhotoVisibility(item.visibility));
}

/**
 * The day's own address, or `null` when it may not go on a story: only for a
 * public trip, a published day, and a day not held back to a closer circle by
 * its own label. Decided here once, for the picture, the video and the page.
 */
export function storyDayLink(user: string, tripId: string, stem: string, trip: Trip | undefined, day: DayFile): string | null {
  if (!trip || !isOpenToLink(trip) || day.status !== "published") return null;
  if (!maySeePhoto(parsePhotoVisibility(day.visibility), "public")) return null;
  return dayUrl(serverSite().url.replace(/\/$/, ""), user, tripId, stem);
}

