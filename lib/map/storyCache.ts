import type { StoryDay } from "../prose";
import type { GalleryItem } from "../types";
import { mediaLoader, posterSrc } from "../../components/mediaLoader";
import { POSTER_WIDTH } from "../mediaSizes";

/**
 * B-2980 — a small in-memory cache of the story windows the map's day reader
 * reads (`/@user/story.json`), so tapping "Read the day" renders at once, plus
 * the pure choices around warming it: which neighbours, which photographs, and
 * when to do nothing at all.
 */

export type StoryWindow = { from: number; days: StoryDay[] };
export type StoryFetch = (url: string) => Promise<StoryWindow>;

/** The window the reader asks for around `index`: one behind, three wide. */
export function windowFor(index: number): { from: number; to: number } {
  const from = Math.max(0, index - 1);
  return { from, to: from + 3 };
}

export function windowUrl(base: string, ref: string, locale: string, index: number): string {
  const { from, to } = windowFor(index);
  return `${base}?trip=${encodeURIComponent(ref)}&from=${from}&to=${to}&lang=${encodeURIComponent(locale)}`;
}

/** The days worth having ready once `index` is selected: it, then the next, then the previous. */
export function neighbourIndexes(index: number, count: number): number[] {
  return [index, index + 1, index - 1].filter((i) => i >= 0 && i < count);
}

/** Honour a request for less data; `nav` is `navigator` (absent on the server). */
export function savesData(nav?: { connection?: { saveData?: boolean } } | null): boolean {
  return nav?.connection?.saveData === true;
}

/** Derivative URLs for the first `n` photographs — a video warms its poster, not the clip. */
export function photoUrlsToWarm(gallery: readonly GalleryItem[], n = 3): string[] {
  return gallery
    .slice(0, n)
    .map((m) => (m.type === "video" ? posterSrc(m.poster, POSTER_WIDTH.GRID) : mediaLoader({ src: m.src, width: 640 })))
    .filter((u): u is string => Boolean(u));
}

const days = new Map<string, StoryDay>();
const pending = new Map<string, Promise<void>>();

const keyOf = (base: string, ref: string, locale: string, index: number) => `${base}|${ref}|${locale}|${index}`;

export function cachedDay(base: string, ref: string, locale: string, index: number, date?: string): StoryDay | undefined {
  const d = days.get(keyOf(base, ref, locale, index));
  return d && (date === undefined || d.date === date) ? d : undefined;
}

/** Fetches the window around `index` once (concurrent callers share it) and stores each day in it. */
export function loadWindow(base: string, ref: string, locale: string, index: number, fetchWindow: StoryFetch): Promise<void> {
  const url = windowUrl(base, ref, locale, index);
  const inflight = pending.get(url);
  if (inflight) return inflight;
  const p = fetchWindow(url)
    .then((data) => data.days.forEach((d, i) => days.set(keyOf(base, ref, locale, data.from + i), d)))
    .finally(() => pending.delete(url));
  pending.set(url, p);
  return p;
}

/** Warms the selected day's window and its neighbours', skipping what is cached; failures stay silent. */
export function prefetchAround(
  base: string,
  ref: string,
  locale: string,
  index: number,
  count: number,
  fetchWindow: StoryFetch,
): void {
  for (const i of neighbourIndexes(index, count)) {
    if (cachedDay(base, ref, locale, i)) continue;
    loadWindow(base, ref, locale, i, fetchWindow).catch(() => undefined);
  }
}

/** Test seam: forget everything. */
export function clearStoryCache(): void {
  days.clear();
  pending.clear();
}
