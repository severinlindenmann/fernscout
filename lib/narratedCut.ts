import type { Entry, GalleryItem } from "./types";

/** One day, told in a single slide: where we were and the day's best shot. */
export type NarratedCutSlide = {
  key: string;
  date: string;
  location: string;
  country: string;
  countryCode?: string;
  /** Absent when the day has no photos at all — the slide falls back to a
   * text-only card rather than being skipped, so a video-only or
   * yet-to-be-photographed day still gets its turn. */
  photo?: GalleryItem;
  /** The day's lead entry — its title/content is where the one sentence
   * comes from. Kept as the whole entry (rather than pre-extracting the
   * sentence here) so the caller can localise it first via `useI18n().localized`. */
  entry: Entry;
};

/**
 * The "narrated cut": one slide per calendar day, in order.
 *
 * This is what makes "show us the trip" take eight minutes instead of three
 * hours — the full slideshow visits every photo, this visits every *day*.
 * `entries` just needs to be chronological, which every source in this
 * codebase already is (`getAllEntries`, and the entries collected on each
 * map `Place`), so this takes a flat entry list rather than a `Day[]` and
 * groups it itself.
 */
export function buildNarratedCut(entries: Entry[]): NarratedCutSlide[] {
  const days: Entry[][] = [];
  for (const entry of entries) {
    const last = days.at(-1);
    if (last && last[0].date === entry.date) {
      last.push(entry);
    } else {
      days.push([entry]);
    }
  }

  return days.map((dayEntries) => {
    const lead = dayEntries[0];
    return {
      key: lead.date,
      date: lead.date,
      location: lead.location,
      country: lead.country,
      countryCode: lead.countryCode,
      photo: bestPhotoForDay(dayEntries),
      entry: lead,
    };
  });
}

/**
 * The day's "best" photo, by a simple rule, applied in order:
 *
 * 1. An entry's own `cover` — already hand-picked by whoever wrote the day,
 *    so it beats any heuristic guess.
 * 2. Otherwise, the largest landscape-orientation photo across the day's
 *    entries (landscape fills a 16:9 TV; a portrait phone shot letterboxes
 *    down to a sliver). "Largest" uses the `width`/`height` recorded on the
 *    gallery item, when ingest recorded them.
 * 3. Otherwise, the largest photo of any orientation.
 * 4. When no gallery item carries dimensions, every candidate ties at area
 *    0 and this falls back to simply the first photo of the day — still
 *    deterministic, never arbitrary.
 * 5. `undefined` when the day has no photos at all (a video-only day, or one
 *    with no gallery yet) — the caller renders a text-only slide.
 */
function bestPhotoForDay(dayEntries: Entry[]): GalleryItem | undefined {
  for (const entry of dayEntries) {
    if (!entry.cover) continue;
    const declared = entry.gallery.find((g) => g.src === entry.cover);
    if (declared) {
      if (declared.type === "image") return declared;
      continue;
    }
    // The cover points somewhere outside the visible gallery — trust it's a
    // photo, since that's the only kind of cover this heuristic knows to use.
    return { src: entry.cover, type: "image" };
  }

  const images = dayEntries.flatMap((e) => e.gallery).filter((g) => g.type === "image");
  if (images.length === 0) return undefined;

  const area = (g: GalleryItem) => (g.width ?? 0) * (g.height ?? 0);
  const landscape = images.filter((g) => (g.width ?? 0) > (g.height ?? 0));
  const pool = landscape.length > 0 ? landscape : images;
  return pool.reduce((best, g) => (area(g) > area(best) ? g : best), pool[0]);
}

/**
 * The one sentence that narrates a day, pulled verbatim from the entry's own
 * prose — this never invents text that isn't in the entry. Markdown syntax
 * is stripped (a link keeps its label, everything else is just dropped)
 * since this is shown as a plain caption on screen, not rendered as rich text.
 *
 * Returns "" when the entry has no prose at all, so the caller can fall back
 * to just the place name.
 */
export function firstSentence(markdown: string): string {
  const plain = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[#>*_`~]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!plain) return "";
  const match = plain.match(/^.*?[.!?](?=\s|$)/);
  return (match ? match[0] : plain).trim();
}
