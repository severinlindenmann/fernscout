/**
 * A trip on disk becomes the flat structure the planner wants.
 *
 * This is the only module in `lib/photobook/` that knows the content layout
 * exists. Everything downstream — planning, rendering, preview — works on a
 * `BookSource` and would be just as happy with one assembled from a database,
 * which is what W06 will eventually hand it.
 *
 * It reads the JPEG header of any photograph whose frontmatter does not declare
 * its dimensions. The planner cannot choose a layout without knowing whether a
 * picture is tall or wide, and guessing gets it wrong on the pages where it
 * matters most.
 *
 * It also decides **which copy of each photograph is printed** — see
 * `printSourceFor` — and it is the only place that can, because it is the only
 * place that knows `originals/` is a sibling of `media/`.
 */

import fs from "node:fs";
import path from "node:path";
import { isEnabled } from "../capabilities";
import { serverSite, travellersOf } from "../site";
import { loadUserConfig } from "../config";
import { contentRoot } from "../contentRoot";
import { getDays, getPlaces } from "../entries";
import { getPlan } from "../plan";
import { getCostSummary } from "../costs";
import { mediaOriginalsRoot, tripMediaDir, tripOriginalsDir } from "../media";
import { getTrip, tripDir } from "../trips";
import { readJpeg } from "../postcard/pdf.ts";
import { paragraphsOf } from "./text.ts";
import type {
  BookCosts,
  BookDay,
  BookPhoto,
  BookSource,
  BookWarning,
  RoutePoint,
} from "./plan.ts";

/** `/media/<trip>/a/b.jpg` → the file on disk inside that trip. */
export function mediaFileFor(ref: string, src: string): string {
  // Entry frontmatter keeps media trip-relative; the reader prefixes the
  // username, so a src may arrive either way. Accept both.
  const tripId = ref.includes("/") ? ref.slice(ref.indexOf("/") + 1) : ref;
  const owner = ref.includes("/") ? ref.slice(0, ref.indexOf("/")) : "";
  const prefixes = [`/${owner}/media/${tripId}/`, `/media/${tripId}/`];
  const prefix = prefixes.find((p) => src.startsWith(p)) ?? `/media/${tripId}/`;
  const relative = src.startsWith(prefix) ? src.slice(prefix.length) : src.replace(/^\/+/, "");
  return path.join(tripDir(ref), "media", relative);
}

/**
 * How a `BookPhoto.file` is written down, and how it is read back.
 *
 * **Relative to the content root, with forward slashes**, because the plan is
 * a file somebody keeps: an absolute path makes the JSON machine-specific, so
 * two people generating the same book from the same input get different bytes
 * — and it drags a home directory, and therefore a person's name, into a
 * generated artefact (B25).
 *
 * **A file outside the content root is written against the root it *is* under,
 * named by a prefix**: `originals:<user>/<trip>/day/01.jpg` for anything under
 * `MEDIA_ORIGINALS_DIR`, which is the one directory the content root is
 * allowed not to contain. Relative-to-the-content-root would answer
 * `../../../mnt/photos/…` there — a path whose number of `..` segments depends
 * on where the content root happens to sit, which is the portability B25 asked
 * for lost by another route, and unreadable in a warning, which is the other
 * job this string does (B210).
 *
 * The discriminator rides *inside* the handle rather than in a field beside it
 * because `BookPhoto.file` is opaque to everything downstream — the planner,
 * the placements, the renderer, the preview — and a second field would have to
 * be threaded through all four to reach the only two functions that know what
 * a path is. Both of those are here.
 *
 * `resolvePrintFile` is the other half.
 */
const ORIGINALS_PREFIX = "originals:";

/** True when `relative` stays inside the root it was measured from. */
function inside(relative: string): boolean {
  if (relative === "" || path.isAbsolute(relative)) return false;
  return relative !== ".." && !relative.startsWith(`..${path.sep}`);
}

const forwardSlashes = (relative: string) => relative.split(path.sep).join("/");

function bookFile(absolute: string): string {
  const fromContent = path.relative(contentRoot(), absolute);
  if (inside(fromContent)) return forwardSlashes(fromContent);

  const originals = mediaOriginalsRoot();
  if (originals) {
    const fromOriginals = path.relative(originals, absolute);
    if (inside(fromOriginals)) return ORIGINALS_PREFIX + forwardSlashes(fromOriginals);
  }
  // Under neither root — a src that escaped `media/`, which `printSourceFor`
  // hands back untouched. Still never absolute.
  return forwardSlashes(fromContent);
}

export function resolvePrintFile(file: string): string {
  if (!file.startsWith(ORIGINALS_PREFIX)) return path.resolve(contentRoot(), file);

  const originals = mediaOriginalsRoot();
  if (!originals) {
    // Only reachable for a plan built elsewhere, or with the variable since
    // unset. Loud, because the quiet alternative is looking under the content
    // root for a file that was never there and calling the page missing.
    throw new Error(
      `${file} was recorded against MEDIA_ORIGINALS_DIR, which is not set. ` +
        "Point it at the directory the plan was built against, or rebuild the plan.",
    );
  }
  return path.resolve(originals, file.slice(ORIGINALS_PREFIX.length));
}

/** JPEG-first, so `01.jpg` beside `01.heic` prints rather than falls back. */
const PRINTABLE = /\.jpe?g$/i;

/**
 * The kept original for a derivative, matched on **basename, any extension**.
 *
 * Ingest names the original after the derivative rather than after the camera
 * (`lib/ingest/index.ts`), so `01.jpg` in `media/` is `01.<whatever the camera
 * wrote>` in `originals/` — `.heic`, `.cr2`, `.jpeg`. A path join on the
 * derivative's own extension finds nothing for exactly the files that most
 * need finding.
 */
function findOriginal(originalsDir: string, relative: string): string | null {
  const dir = path.join(originalsDir, path.dirname(relative));
  const stem = path.basename(relative, path.extname(relative)).toLowerCase();
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return null;
  }
  const matches = names
    .filter((n) => path.basename(n, path.extname(n)).toLowerCase() === stem)
    .sort((a, b) => Number(PRINTABLE.test(b)) - Number(PRINTABLE.test(a)) || a.localeCompare(b));
  return matches.length > 0 ? path.join(dir, matches[0]) : null;
}

export type PrintSource = {
  /** What the plan records: relative to the content root, or to the
   * originals root behind an `originals:` prefix. See `bookFile`. */
  file: string;
  /** The same file, absolute, for reading it here and now. */
  absolute: string;
  /** The original's own dimensions, when the original is what will be printed.
   * The frontmatter's are the *derivative's* and would understate it. */
  size?: { width: number; height: number };
  /** Set when the derivative is being printed because the original could not
   * be. Never absent for a fallback: a book printed soft has to say why. */
  fallbackReason?: string;
};

/**
 * Which copy of a photograph the book prints.
 *
 * The originals exist for this and nothing else — `lib/media.ts` says so, both
 * write paths honour it, and `lib/exportZip.ts` leaves them out of an export
 * because "they are what the photobook needs". Until B13 the photobook looked
 * for a better version of `01.jpg` in the one folder that holds the worse one,
 * so every plate in a 210mm book printed at about 125 DPI.
 *
 * **Only a JPEG original is used.** The PDF writer embeds JPEG bytes verbatim
 * as a DCTDecode stream (`readJpeg`, `lib/postcard/pdf.ts`) and can do nothing
 * with a HEIC or a RAW; transcoding one on demand would put a decoder for
 * every camera format in the print path. So a non-JPEG original falls back to
 * the derivative *and says so*, which is the part that matters — a silent
 * fallback is how the low-resolution warning came to be the only symptom.
 */
export function printSourceFor(ref: string, src: string): PrintSource {
  const derivative = mediaFileFor(ref, src);
  const relative = path.relative(tripMediaDir(ref), derivative);
  const served = { file: bookFile(derivative), absolute: derivative };
  // A src that escapes `media/` is not one we go looking for a better copy of.
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return served;

  const original = findOriginal(tripOriginalsDir(ref), relative);
  if (!original) {
    return { ...served, fallbackReason: "no original was kept for it" };
  }
  const size = dimensionsOf(original);
  if (!size) {
    return {
      ...served,
      fallbackReason:
        `its original (${path.basename(original)}) is not a JPEG, and a JPEG is all the ` +
        "PDF writer can embed",
    };
  }
  return { file: bookFile(original), absolute: original, size };
}

function dimensionsOf(file: string): { width: number; height: number } | null {
  try {
    const image = readJpeg(new Uint8Array(fs.readFileSync(file)));
    return { width: image.width, height: image.height };
  } catch {
    return null;
  }
}

function costsFor(tripId: string): BookCosts | undefined {
  if (!isEnabled("costs", getTrip(tripId)?.username)) return undefined;
  const summary = getCostSummary(tripId);
  if (summary.total <= 0) return undefined;
  // A printed page has no room for the costs page's own caveat, and no way to
  // update itself once a rate is added later — so rather than mail somebody a
  // number that looks complete and is not (B353), the costs spread is left
  // out entirely whenever any spend had no rate to convert with.
  if (summary.unconverted.length > 0) return undefined;
  return {
    baseCurrency: summary.baseCurrency,
    total: summary.total,
    preparation: summary.preparation,
    onTheRoad: summary.onTheRoad,
    perDay: summary.perDay,
    byCategory: summary.byCategory.map((c) => ({ category: c.category, amount: c.amount })),
    byCountry: summary.byCountry.map((c) => ({
      country: c.country,
      amount: c.amount,
      nights: c.nights,
    })),
    budget: summary.budget ? { total: summary.budget.total, days: summary.budget.days } : undefined,
  };
}

/**
 * The route the book draws.
 *
 * Where we actually went, not where we meant to go: `content/plan.md` is a
 * forward-looking document and a finished book should show the trip that
 * happened. The plan is the fallback for a trip that has barely started, so an
 * upcoming trip still gets a map.
 */
function routeFor(tripId: string): RoutePoint[] {
  const places = getPlaces(tripId).map((p) => ({
    location: p.location,
    country: p.country,
    lat: p.lat,
    lng: p.lng,
  }));
  if (places.length >= 2) return places;
  return getPlan(tripId).stops.map((s) => ({
    location: s.location,
    country: s.country,
    lat: s.lat,
    lng: s.lng,
  }));
}

export type SourceOptions = {
  /** Printed in the colophon. Defaults to today; passed in by tests. */
  madeOn?: string;
  /** Skip photographs below this pixel width entirely rather than printing
   * them soft. Off by default — a soft photo of something that happened once
   * still beats a gap. */
  minPixelWidth?: number;
  /**
   * Gallery `src` values to leave out, as chosen in the browser.
   *
   * Keyed on the entry's own `src` rather than on the resolved print file,
   * because that is the string the page has: `MediaTile.src` is what the
   * gallery renders and what the form posts back. The print file is derived
   * from it a line later and is not knowable to a browser.
   */
  excludePhotos?: readonly string[];
  /** Who travelled. `false` leaves the byline off. */
  includeNames?: boolean;
};

export function buildBookSource(tripId: string, options: SourceOptions = {}): BookSource {
  const trip = getTrip(tripId);
  if (!trip) throw new Error(`No trip "${tripId}" in ${tripDir(tripId)}`);

  const config = loadUserConfig(trip.username);
  const travellers =
    options.includeNames === false
      ? []
      : travellersOf(config, trip)
          .map((p) => p.nickname || p.name)
          .filter(Boolean);

  // Photographs printed from the web copy, and why. Reported once for the
  // book rather than once per plate; the per-photograph half rides along on
  // any low-resolution warning, where a reader is already looking.
  const fallbacks = new Map<string, string[]>();
  const excluded = new Set(options.excludePhotos ?? []);

  const days: BookDay[] = getDays(tripId).map((day) => {
    const photos: BookPhoto[] = [];
    for (const entry of day.entries) {
      for (const item of entry.gallery) {
        if (item.type !== "image") continue;
        if (excluded.has(item.src)) continue;
        const print = printSourceFor(tripId, item.src);
        // The original's own header wins: the frontmatter records what the
        // browser is served, which is the smaller of the two by construction.
        const size =
          print.size ??
          (item.width && item.height
            ? { width: item.width, height: item.height }
            : dimensionsOf(print.absolute));
        if (!size) continue;
        if (options.minPixelWidth && size.width < options.minPixelWidth) continue;
        if (print.fallbackReason) {
          const seen = fallbacks.get(print.fallbackReason) ?? [];
          seen.push(print.file);
          fallbacks.set(print.fallbackReason, seen);
        }
        photos.push({
          file: print.file,
          webSrc: item.src,
          width: size.width,
          height: size.height,
          caption: item.caption,
          fallbackReason: print.fallbackReason,
        });
      }
    }

    // Several updates in one day become one page of prose, each introduced by
    // its own title so the reader can tell them apart.
    const paragraphs = day.entries.flatMap((entry, i) =>
      day.entries.length > 1 && i > 0
        ? [`${entry.title} — ${paragraphsOf(entry.content).join(" ")}`]
        : paragraphsOf(entry.content),
    );

    return {
      date: day.date,
      title: day.lead.title,
      location: day.lead.location,
      country: day.lead.country,
      countryCode: day.lead.countryCode,
      lat: day.lead.lat,
      lng: day.lead.lng,
      paragraphs,
      photos,
      // The lead entry's leg. A day written as several updates records the
      // travelling on the one that did the travelling, which is the lead often
      // enough that taking the first non-empty one would mostly agree and
      // occasionally invent a journey nobody made.
      transport: day.lead.transport
        ? {
            mode: day.lead.transport.mode,
            from: day.lead.transport.from,
            to: day.lead.transport.to,
          }
        : undefined,
    };
  });

  const photoCount = days.reduce((n, d) => n + d.photos.length, 0);
  const notes: BookWarning[] = [...fallbacks.entries()].map(([reason, files]) => ({
    code: "no-original",
    detail:
      `${files.length} of ${photoCount} photographs printed from the web copy because ` +
      `${reason}: ${files.slice(0, 3).join(", ")}${files.length > 3 ? ", …" : ""}. ` +
      "The web copy is capped at 2000px, which is soft on a full page.",
  }));

  return {
    trip: {
      id: trip.id,
      title: trip.title,
      tagline: trip.tagline,
      start: trip.start,
      end: trip.end,
      intro: trip.intro,
    },
    travellers,
    days,
    notes,
    route: routeFor(tripId),
    costs: costsFor(tripId),
    madeOn: options.madeOn ?? new Date().toISOString().slice(0, 10),
    // The colophon points at the journal this book came from.
    siteUrl: `${serverSite().url}/${trip.username}`,
  };
}
