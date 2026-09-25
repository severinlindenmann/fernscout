import "server-only";
import fs from "node:fs";
import path from "node:path";
import { contentRoot } from "@/lib/contentRoot";
import { readDayFile, writeDayFile, deleteDayFile, listDaySlugs } from "@/lib/api/v2/store";
import { v2Slug } from "@/lib/api/v2/days";
import { getTrip, tripRef } from "@/lib/trips";
import { DATE_RE } from "@/lib/tripWrite";
import { slugify } from "@/lib/slug";
import { listOrders } from "@paid/postcard/lib/postcard/orders";
import { listPhotobookOrders } from "@paid/photobook/lib/photobook/orders";
import type { DayFile } from "@/lib/api/v2/documents";

/**
 * "Something is filed wrong" — B1832, spec §7.1. Every write in this module
 * is genuinely new: nothing in the browser moved, split or merged a day
 * before this ticket. All three share one address convention, worth stating
 * once — a day's public permalink (`app/[user]/trips/[trip]/day/[slug]/
 * page.tsx`) is `/<user>/trips/<tripId>/day/<bareSlug>`, built from the
 * BARE slug (`entrySlugFromFile`, lib/entries.ts) and the trip id. The date
 * is only ever part of the on-disk *filename*
 * (`v2Slug`, `entries/YYYY-MM-DD-slug.json`) and never the URL. So:
 *
 *  - Changing a day's **date** alone changes nothing a reader can see —
 *    `EditDay`'s own `date` field already does this, correctly, today.
 *  - Changing a day's **trip** changes the address, because the trip id is
 *    in it. That is the one case D2 is about, and the only case this
 *    module's own `moveDayTransactional` treats as address-changing.
 */

/** The full on-disk stem (`YYYY-MM-DD-slug`) for a bare slug already known
 *  to be on this trip — every function below needs this before it can read
 *  or write through `lib/api/v2/store.ts`, which addresses a day by the
 *  whole filename, not the bare slug the picker and the URL both use. */
function fullStemFor(username: string, tripId: string, bareSlug: string): string | null {
  return listDaySlugs(username, tripId).find((stem) => stem.replace(/^\d{4}-\d{2}-\d{2}-/, "") === bareSlug) ?? null;
}

/**
 * Whether this journal really has that trip — B1892, defence in depth.
 *
 * `lib/api/v2/store.ts` refuses a trip id that is a path at all, which is
 * what actually closes the hole; this is the second line, and the one that
 * gives a caller `unknown_trip` instead of a path resolving nowhere. Every
 * trip id this module is handed is checked, not only `move`'s destination:
 * the `from` side, split's and merge's were the ones that were not, and they
 * reached another journal's days.
 */
function knownTrip(username: string, tripId: string): boolean {
  return Boolean(getTrip(tripRef(username, tripId)));
}

function mediaDirFor(username: string, tripId: string, bareSlug: string): string {
  return path.join(contentRoot(), username, "trips", tripId, "media", bareSlug);
}

/** ── M4 — the reference sweep ────────────────────────────────────────── */

export type ReferenceRow = {
  what: string;
  consequence: string;
  /** A posted postcard is the one row that is explicitly NOT touched by
   *  anything this module does — spec §7.1: "a posted postcard is not
   *  updated, and the screen says so." Marked so the flow can word it apart
   *  from a row that simply describes what moves. */
  untouched?: boolean;
};

/**
 * Every `MediaTile.src` an ordered photobook's frozen `options` can name —
 * B1882. `DayBoard` (D6, spec §3) itself has no persisted layout: the
 * composer decides per session and nothing on disk remembers it. But an
 * *order* is different — `claimOrder` (lib/photobook/orders.ts) freezes the
 * whole `BookOptions` the owner had open onto the row the moment they pay,
 * and every one of these fields is optional because most orders never touch
 * them (the planner decides by default) — but when the owner *did*
 * customise the composer, the value that survives is a path, not a
 * decision, and a path does not follow the day if it moves.
 */
export function photobookPhotoRefs(options: { days: Record<string, { photos?: string[]; hero?: string }>; excludePhotos: readonly string[]; cover?: string; titlePhoto?: string; titlePhotos?: readonly string[] }): string[] {
  const refs = [options.cover, options.titlePhoto, ...(options.titlePhotos ?? []), ...options.excludePhotos];
  for (const plan of Object.values(options.days)) {
    refs.push(plan.hero, ...(plan.photos ?? []));
  }
  return refs.filter((src): src is string => Boolean(src));
}

/**
 * Everything on this server that holds this day's slug, and what happens to
 * it. `trip.cover` is checked directly (it is one string); postcard orders
 * are read through `listOrders`, the same function the postcard pages
 * already use, filtered to this trip and day; photobook orders are read
 * through `listPhotobookOrders` and matched by the photograph paths their
 * frozen options name — see {@link photobookPhotoRefs}.
 */
export async function referenceSweep(username: string, tripId: string, bareSlug: string): Promise<ReferenceRow[]> {
  const rows: ReferenceRow[] = [];
  const mediaPrefix = `/media/${tripId}/${bareSlug}/`;
  // `getTrip`'s own `cover` is owner-prefixed for the browser
  // (`mediaWithOwner`, lib/trips.ts) — matched with `includes` rather than
  // `startsWith` so this does not have to reconstruct that prefix itself.
  const trip = getTrip(tripRef(username, tripId));
  if (trip?.cover?.includes(mediaPrefix)) {
    rows.push({
      what: "This trip's cover is a photograph from this day.",
      consequence: "It moves with the day. Pick a new cover afterwards if it leaves this trip.",
    });
  }

  const ref = tripRef(username, tripId);
  const orders = await listOrders(username);
  for (const order of orders.filter((o) => o.payload.trip === ref && o.payload.day === bareSlug)) {
    // `submitted`/`built` — the provider has the card; `draft`/`failed`
    // never left this server. `OrderStatus`, lib/postcard/orders.ts.
    const posted = order.status === "submitted" || order.status === "built";
    rows.push({
      what: `A postcard order (${order.status}).`,
      consequence: posted
        ? "Already sent — left exactly as it was. A posted card is history."
        : "Still a proposal, not yet sent — it keeps pointing at this photograph wherever the day ends up.",
      untouched: posted,
    });
  }

  const photobookOrders = await listPhotobookOrders(username);
  for (const order of photobookOrders.filter((o) => o.payload.trip === ref)) {
    const touched = photobookPhotoRefs(order.payload.options).filter((src) => src.includes(mediaPrefix));
    if (touched.length === 0) continue;
    // `"submitted"` is claimed but not yet rendered — the eventual build
    // reads these paths off disk. Anything past that (`"built"`, `"failed"`,
    // a later print step) already produced its PDF or gave up; either way
    // nothing left to read again.
    const rendered = order.status !== "submitted";
    rows.push({
      what: `A photobook order (${order.status}) names ${touched.length} photograph${touched.length === 1 ? "" : "s"} from this day.`,
      consequence: rendered
        ? "Already rendered — left exactly as it was. The PDF already has these photographs."
        : "Not yet rendered — the build reads these exact paths, and they will not exist wherever the day ends up.",
      untouched: rendered,
    });
  }

  return rows;
}

/** ── Move ────────────────────────────────────────────────────────────── */

export type MoveResult =
  | { ok: true; addressChanged: boolean }
  | { ok: false; error: "unknown_day" | "unknown_trip" | "already_exists" | "invalid_date" };

/**
 * Move a day to a different date and/or a different trip.
 *
 * A same-trip move is one write: the filename's date prefix changes, the
 * bare slug and every media path do not. A cross-trip move is the risky
 * half — the day's own media folder is renamed onto the new trip
 * (`fs.renameSync`, same volume, so this is one filesystem operation rather
 * than a copy-then-delete that could leave both halves on disk) and every
 * `media[].src` is rewritten to match. The new file is written before the
 * old one is deleted: a crash between the two leaves the day duplicated,
 * recoverable by hand, never lost — the ordering `createDayTransactional`
 * already uses for the same reason.
 */
export function moveDayTransactional(
  username: string,
  fromTripId: string,
  bareSlug: string,
  to: { tripId: string; date: string },
): MoveResult {
  // B1892: both trips, and the date — `to.date` becomes part of a filename
  // (`v2Slug`), so a date carrying path segments is a write anywhere on disk.
  if (!knownTrip(username, fromTripId)) return { ok: false, error: "unknown_trip" };
  if (!DATE_RE.test(to.date)) return { ok: false, error: "invalid_date" };
  const fromStem = fullStemFor(username, fromTripId, bareSlug);
  if (!fromStem) return { ok: false, error: "unknown_day" };
  const stored = readDayFile(username, fromTripId, fromStem);
  if (!stored) return { ok: false, error: "unknown_day" };
  const toTrip = getTrip(tripRef(username, to.tripId));
  if (!toTrip) return { ok: false, error: "unknown_trip" };

  const crossTrip = to.tripId !== fromTripId;
  const newStem = v2Slug(to.date, bareSlug);

  if (crossTrip && readDayFile(username, to.tripId, newStem)) {
    return { ok: false, error: "already_exists" };
  }

  let media = stored.media;
  if (crossTrip && media && media.length > 0) {
    const fromDir = mediaDirFor(username, fromTripId, bareSlug);
    const toDir = mediaDirFor(username, to.tripId, bareSlug);
    if (fs.existsSync(fromDir)) {
      fs.mkdirSync(path.dirname(toDir), { recursive: true });
      fs.renameSync(fromDir, toDir);
    }
    media = media.map((item) => ({ ...item, src: item.src.replace(`/media/${fromTripId}/`, `/media/${to.tripId}/`) }));
  }

  const toWrite: DayFile = { ...stored, date: to.date, media };
  writeDayFile(username, to.tripId, newStem, toWrite);
  if (crossTrip || newStem !== fromStem) deleteDayFile(username, fromTripId, fromStem);

  // The permalink is `/<user>/trips/<tripId>/day/<bareSlug>` — the date
  // never appears in it, so only a trip change ever moves the address a
  // published day already answers to (see this module's own doc comment).
  return { ok: true, addressChanged: crossTrip && stored.status === "published" };
}

/** ── Split ───────────────────────────────────────────────────────────── */

export type SplitInput = {
  /** How many of the day's photographs (in their stored order) stay on the
   *  first half; the rest move to the new one. Never proposed from EXIF —
   *  an already-attached photograph carries no per-item timestamp on disk
   *  (`dayMediaItem`, lib/api/v2/schemas/day.ts: `src`/`caption`/
   *  `visibility` only), so a "largest gap" default would have to invent a
   *  time nobody recorded. The person places the cut directly instead. */
  photoCutIndex: number;
  /** The words that stay — never re-split automatically (spec §7.1: "the
   *  prose is never cut automatically"). */
  firstContent: string;
  secondTitle: string;
  secondContent: string;
  secondTime?: string;
};

export type SplitResult = { ok: true; newSlug: string } | { ok: false; error: "unknown_day" | "unknown_trip" | "title_required" | "slug_taken" };

/**
 * Split one day's update into two, on the same date — the mechanism D3
 * already gave the content model (several updates may share a date,
 * distinguished by `time`), so this is that mechanism used deliberately
 * rather than a new one. The new half is always a draft (spec §4:
 * publishing is never a side effect); the half that keeps the original slug
 * keeps its status exactly as it was.
 */
export function splitDayTransactional(username: string, tripId: string, bareSlug: string, input: SplitInput): SplitResult {
  if (!knownTrip(username, tripId)) return { ok: false, error: "unknown_trip" };
  const stem = fullStemFor(username, tripId, bareSlug);
  if (!stem) return { ok: false, error: "unknown_day" };
  const stored = readDayFile(username, tripId, stem);
  if (!stored) return { ok: false, error: "unknown_day" };

  const newBareSlug = slugify(input.secondTitle);
  if (!input.secondTitle.trim() || newBareSlug === "entry") return { ok: false, error: "title_required" };
  const newStem = v2Slug(stored.date, newBareSlug);
  if (readDayFile(username, tripId, newStem)) return { ok: false, error: "slug_taken" };

  const media = stored.media ?? [];
  const firstMedia = media.slice(0, input.photoCutIndex);
  const secondMediaOriginal = media.slice(input.photoCutIndex);

  let secondMedia = secondMediaOriginal;
  if (secondMediaOriginal.length > 0) {
    const fromDir = mediaDirFor(username, tripId, bareSlug);
    const toDir = mediaDirFor(username, tripId, newBareSlug);
    fs.mkdirSync(toDir, { recursive: true });
    for (const item of secondMediaOriginal) {
      const filename = path.basename(item.src);
      const from = path.join(fromDir, filename);
      if (fs.existsSync(from)) fs.renameSync(from, path.join(toDir, filename));
    }
    secondMedia = secondMediaOriginal.map((item) => ({
      ...item,
      src: item.src.replace(`/media/${tripId}/${bareSlug}/`, `/media/${tripId}/${newBareSlug}/`),
    }));
  }

  // The new half first — nothing about the original day is touched until
  // its own half has a home to point its removed photographs at.
  writeDayFile(username, tripId, newStem, {
    ...stored,
    title: input.secondTitle,
    content: input.secondContent,
    media: secondMedia,
    status: "draft",
    ...(input.secondTime ? { time: input.secondTime } : {}),
  });
  writeDayFile(username, tripId, stem, { ...stored, content: input.firstContent, media: firstMedia });

  return { ok: true, newSlug: newBareSlug };
}

/** ── Merge ───────────────────────────────────────────────────────────── */

export type MergeResult = { ok: true; slug: string } | { ok: false; error: "unknown_day" | "unknown_trip" | "cross_trip" };

/**
 * Join two updates into one. **Refused across trips** (M6✗, spec §7.1) —
 * checked here as well as by the flow, since this function is the one place
 * that could otherwise silently pick a winning trip. The earlier of the two
 * (by date, then time) survives under its own slug; the later's photographs
 * move into the survivor's folder, in time order, and its words are
 * appended after the survivor's own, separated as two paragraphs — never
 * interleaved, so nothing is invented about which sentence belongs where.
 */
export function mergeDaysTransactional(username: string, tripId: string, slugA: string, tripIdB: string, slugB: string): MergeResult {
  if (tripId !== tripIdB) return { ok: false, error: "cross_trip" };
  if (!knownTrip(username, tripId)) return { ok: false, error: "unknown_trip" };
  const stemA = fullStemFor(username, tripId, slugA);
  const stemB = fullStemFor(username, tripId, slugB);
  if (!stemA || !stemB) return { ok: false, error: "unknown_day" };
  const dayA = readDayFile(username, tripId, stemA);
  const dayB = readDayFile(username, tripId, stemB);
  if (!dayA || !dayB) return { ok: false, error: "unknown_day" };

  const aFirst = `${dayA.date}${dayA.time ?? ""}` <= `${dayB.date}${dayB.time ?? ""}`;
  const survivor = aFirst ? dayA : dayB;
  const survivorSlug = aFirst ? slugA : slugB;
  const survivorStem = aFirst ? stemA : stemB;
  const loser = aFirst ? dayB : dayA;
  const loserSlug = aFirst ? slugB : slugA;
  const loserStem = aFirst ? stemB : stemA;

  const loserDir = mediaDirFor(username, tripId, loserSlug);
  const survivorDir = mediaDirFor(username, tripId, survivorSlug);
  let movedLoserMedia = loser.media ?? [];
  if (movedLoserMedia.length > 0) {
    fs.mkdirSync(survivorDir, { recursive: true });
    movedLoserMedia = movedLoserMedia.map((item) => {
      const filename = path.basename(item.src);
      const from = path.join(loserDir, filename);
      let target = filename;
      // A same-named file from the loser's own folder never overwrites the
      // survivor's — prefixed rather than dropped, so nothing is lost.
      if (fs.existsSync(path.join(survivorDir, target))) target = `${loserSlug}-${filename}`;
      if (fs.existsSync(from)) fs.renameSync(from, path.join(survivorDir, target));
      return { ...item, src: `/media/${tripId}/${survivorSlug}/${target}` };
    });
  }

  const survivorMedia = [...(survivor.media ?? []), ...movedLoserMedia];
  const mergedContent = [survivor.content, loser.content].filter((c) => c && c.trim()).join("\n\n");

  writeDayFile(username, tripId, survivorStem, {
    ...survivor,
    content: mergedContent,
    media: survivorMedia,
  });
  deleteDayFile(username, tripId, loserStem);

  return { ok: true, slug: survivorSlug };
}
