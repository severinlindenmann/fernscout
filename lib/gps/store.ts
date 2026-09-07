import fs from "node:fs";
import path from "node:path";
import { contentRoot } from "../contentRoot";
import type { Fix } from "../../importers/types";

/**
 * The private position store — B665.
 *
 * `content/<username>/gps/YYYY-MM.jsonl`, one fix per line as
 * `[epochSeconds, lat, lon]`. This is somebody's complete location history:
 * every address they sleep at, every place they work, every clinic they have
 * ever visited. It is the most sensitive thing in this repository by a
 * distance, and three rules keep it that way:
 *
 * **Nothing under `app/` may import this module.** No route reads it, no page
 * renders it, there is no API that returns a fix. `test/gps-store.test.ts`
 * asserts the import graph, the same way `test/postcard-orders.test.ts`
 * guards `sendOrder`. What the site draws is a *derived* file — see
 * `track.ts` — clipped to one trip, and the two are different files with
 * different rules on purpose.
 *
 * **It is in no export.** `appendUserContent` walks `trips/` and
 * `config.json` and nothing else, so `gps/` is outside both scopes today; a
 * test pins it, because the export is a plain GET for the open-to-link scope.
 *
 * **It is inside the storage ceiling for free**, because `lib/storageQuota.ts`
 * counts the whole of `content/<username>/`.
 *
 * Month files rather than one `gps.json`: an import appends to two or three of
 * them rather than rewriting a decade, a month is cheap to delete by hand, and
 * nothing has to hold ten years in memory to add a day.
 */

/** Coordinates are stored to five places — about a metre. Beyond that is
 * noise from the receiver, stored forever. */
const PLACES = 5;

/**
 * How thin is thin enough.
 *
 * **Five minutes *or* 250 metres, whichever comes first.** Time alone logs a
 * phone fidgeting on a bedside table all night; distance alone is fine until
 * a motorway, where five minutes is an eight-kilometre chord and the road
 * stops being a road. Together they cost about 250 fixes on a day of hard
 * travelling and a dozen on a day at the beach, which is the right shape.
 */
export const MIN_SECONDS = 300;
export const MIN_METRES = 250;

const EARTH_RADIUS_M = 6_371_000;

/** Great-circle metres. Same haversine as `lib/ingest/geo.ts`, restated
 * rather than imported: that module loads a geocoding bundle on import and
 * this one runs in a CLI that has no business paying for it. */
export function metresBetween(a: Fix, b: Fix): number {
  const toRad = Math.PI / 180;
  let dLon = b.lon - a.lon;
  if (dLon > 180) dLon -= 360;
  if (dLon < -180) dLon += 360;
  const dLat = (b.lat - a.lat) * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * toRad) * Math.cos(b.lat * toRad) * Math.sin((dLon * toRad) / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * A fix as the file will hold it: whole seconds, five decimal places.
 *
 * Applied *before* thinning, not only on the way to disk, and importing the
 * same export twice is what needs it. A fix read back from a month file has
 * already lost its milliseconds; the same fix parsed again out of the export
 * still has them, so the two sorted either side of each other and the merge
 * came out with 1,140 "new" positions that were the ones already there. Thin
 * what will be written, and a re-import is a no-op.
 */
function normalise(fix: Fix): Fix {
  return {
    t: Math.round(fix.t / 1000) * 1000,
    lat: Number(fix.lat.toFixed(PLACES)),
    lon: Number(fix.lon.toFixed(PLACES)),
  };
}

/**
 * Sort, de-duplicate and thin.
 *
 * Applied to the *merged* set on every write, never to the incoming file
 * alone: two imports of overlapping exports would otherwise each thin
 * correctly and still leave the pair of them dense at the seam.
 */
export function thin(fixes: Fix[]): Fix[] {
  const sorted = fixes.map(normalise).sort((a, b) => a.t - b.t);
  const out: Fix[] = [];
  for (const fix of sorted) {
    const last = out[out.length - 1];
    if (!last) {
      out.push(fix);
      continue;
    }
    // One second, one position. Nobody is in two places at once, and an
    // export says so anyway: Google ends an activity and starts the next
    // segment at the same instant, hundreds of metres apart. Kept, that pair
    // is far enough apart to survive the distance rule *and* to make the next
    // import's copy of it survive as well — 1,191 positions of growth per
    // re-import, forever. The first one wins.
    if (fix.t === last.t) continue;
    if ((fix.t - last.t) / 1000 < MIN_SECONDS && metresBetween(last, fix) < MIN_METRES)
      continue;
    out.push(fix);
  }
  return out;
}

export function gpsDir(username: string): string {
  return path.join(contentRoot(), username, "gps");
}

/** `YYYY-MM`, in UTC. The store has no opinion about anybody's local day —
 * that question belongs to a trip, and a trip answers it in `track.ts`. */
function monthOf(t: number): string {
  return new Date(t).toISOString().slice(0, 7);
}

function monthFile(username: string, month: string): string {
  return path.join(gpsDir(username), `${month}.jsonl`);
}

function readMonth(username: string, month: string): Fix[] {
  let text: string;
  try {
    text = fs.readFileSync(monthFile(username, month), "utf8");
  } catch {
    return [];
  }
  const out: Fix[] = [];
  for (const line of text.split("\n")) {
    if (line.trim().length === 0) continue;
    try {
      const [t, lat, lon] = JSON.parse(line) as [number, number, number];
      out.push({ t: t * 1000, lat, lon });
    } catch {
      // A half-written line from an interrupted write. Losing one fix is
      // nothing; refusing to read the month because of it is not.
    }
  }
  return out;
}

function writeMonth(username: string, month: string, fixes: Fix[]): void {
  fs.mkdirSync(gpsDir(username), { recursive: true });
  const body = fixes
    .map(
      (f) =>
        `[${Math.round(f.t / 1000)},${Number(f.lat.toFixed(PLACES))},${Number(
          f.lon.toFixed(PLACES),
        )}]`,
    )
    .join("\n");
  // Written whole and renamed: a month file is read by the enrich step, and a
  // partial one there would silently shorten somebody's trip.
  const target = monthFile(username, month);
  const temporary = `${target}.tmp`;
  fs.writeFileSync(temporary, body.length > 0 ? `${body}\n` : "", "utf8");
  fs.renameSync(temporary, target);
}

export type AppendResult = {
  read: number;
  /** How many fixes the store holds for the touched months afterwards, and how
   * many it held before. A difference of zero is a re-import of something
   * already there — which is the normal case, and worth being able to see.
   * Not "how many were added": thinning can *shrink* a month that an earlier,
   * looser import left dense, and a count of new arrivals would report that as
   * a negative number of additions. */
  before: number;
  after: number;
  months: string[];
};

/** Merge fixes into the store, thinning across what is already there. */
export function appendFixes(username: string, fixes: Fix[]): AppendResult {
  const byMonth = new Map<string, Fix[]>();
  for (const fix of fixes) {
    const month = monthOf(fix.t);
    const bucket = byMonth.get(month);
    if (bucket) bucket.push(fix);
    else byMonth.set(month, [fix]);
  }

  let before = 0;
  let after = 0;
  const months = [...byMonth.keys()].sort();
  for (const month of months) {
    const existing = readMonth(username, month);
    const merged = thin([...existing, ...(byMonth.get(month) ?? [])]);
    writeMonth(username, month, merged);
    before += existing.length;
    after += merged.length;
  }
  return { read: fixes.length, before, after, months };
}

/** Every fix in `[from, to]`, in order. Missing months are nothing, not an
 * error — a journal with no history has an empty trip track, not a failure. */
export function readRange(username: string, from: number, to: number): Fix[] {
  const out: Fix[] = [];
  for (let cursor = new Date(from); cursor.getTime() <= to; ) {
    const month = cursor.toISOString().slice(0, 7);
    for (const fix of readMonth(username, month))
      if (fix.t >= from && fix.t <= to) out.push(fix);
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
  }
  return out.sort((a, b) => a.t - b.t);
}
