import "server-only";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { isEnabled } from "../capabilities";
import { clearMatterCache, entrySlugFromFile, forgetEntries } from "../entries";
import { parseTripRef, tripDir } from "../trips";
import { parseWeather, type DayWeather } from "../weather";
import { fetchDayWeather } from "../weatherFetch";
import { spliceEntryFields } from "./entries";

/**
 * Filling in a day's weather — B325, and the only place a lookup is turned
 * into a line on disk.
 *
 * Two callers and one function, which is the whole point: `POST .../days` and
 * `PATCH .../days/<slug>` call it after a write, and `npm run weather:update`
 * calls it in a sweep. A lookup that happened one way and not the other would
 * be a day whose weather depended on how it was written.
 *
 * **Nothing here throws and nothing here reports failure.** A day is saved
 * whether or not a third party answered; a missing reading is "not yet", and
 * the sweep comes back for it.
 */

/** Why a day was not filled. Only the sweep prints these; the routes ignore
 * them, because none of them is the caller's problem. */
export type FillOutcome =
  | "filled"
  /** `dryRun`: everything before the fetch said yes, and no request was made. */
  | "would_fetch"
  | "capability_off"
  | "not_asked"
  | "already_recorded"
  | "no_coordinates"
  | "no_answer"
  | "unwritable";

/**
 * Look up one day's weather and write it into the day's own frontmatter.
 *
 * The four refusals before the fetch are the ticket's hard edges, in order:
 *
 * - **the capability is off** — then no request is made to any third party, on
 *   any path. Checked first for that reason.
 * - **the day did not ask** — `weather: true` is the request, and a day
 *   without it is left alone.
 * - **a reading is already recorded** — a hand-supplied one is never
 *   overwritten by a lookup, and neither is an earlier lookup. Re-running the
 *   sweep costs nothing and changes nothing.
 * - **the day has no coordinates** — and it gets nothing. Not a guess from the
 *   trip's other days, not the nearest city, not the country. `lat`/`lng` are
 *   already all-or-nothing in the validator and this follows them.
 */
export async function fillDayWeather(
  ref: string,
  slug: string,
  options?: { signal?: AbortSignal; now?: Date; dryRun?: boolean },
): Promise<FillOutcome> {
  const username = parseTripRef(ref)?.username;
  if (!username || !isEnabled("weather", username)) return "capability_off";

  const dir = path.join(tripDir(ref), "entries");
  let files: string[] = [];
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".md"));
  } catch {
    return "unwritable";
  }
  const match = files.find((f) => entrySlugFromFile(f) === slug);
  if (!match) return "unwritable";

  const file = path.join(dir, match);
  let raw: string;
  let data: Record<string, unknown>;
  try {
    raw = fs.readFileSync(file, "utf8");
    data = matter(raw).data;
  } catch {
    // See `clearMatterCache` in lib/entries.ts for why a failed parse has to
    // forget itself.
    clearMatterCache();
    return "unwritable";
  }

  if (data.weather !== true) return "not_asked";
  if (parseWeather(data.weatherData)) return "already_recorded";

  const lat = typeof data.lat === "number" ? data.lat : undefined;
  const lng = typeof data.lng === "number" ? data.lng : undefined;
  const date = typeof data.date === "string" ? data.date : String(data.date ?? "");
  if (lat === undefined || lng === undefined || !date) return "no_coordinates";

  // The dry run stops exactly here — after every rule, before the only line
  // that touches the network. That is what makes `--dry-run` an honest
  // rehearsal rather than a second copy of these four checks in the script,
  // which is how the two would come to disagree.
  if (options?.dryRun) return "would_fetch";

  const reading = await fetchDayWeather(lat, lng, date, options);
  if (!reading) return "no_answer";

  return writeWeather(file, ref, reading) ? "filled" : "unwritable";
}

/**
 * Splice one `weatherData:` line into a file that is already there.
 *
 * `spliceEntryFields` rather than a rewrite, for the same reason every other
 * edit goes through it: the file is a folder the author owns, and a comment or
 * a hand-chosen key order two lines away has to survive a lookup nobody asked
 * to have reformat their day.
 */
function writeWeather(file: string, ref: string, reading: DayWeather): boolean {
  try {
    const raw = fs.readFileSync(file, "utf8");
    const spliced = spliceEntryFields(raw, { weatherData: reading });
    // A hand-shaped file with no frontmatter block is left alone and said
    // nothing about, same as `attachGallery` leaves one alone.
    if (spliced === null) return false;
    // Read back before it counts: a line this software cannot parse is worse
    // than no weather, because `parseWeather` would drop it silently and the
    // sweep would fetch it again every time it ran.
    if (!parseWeather(matter(spliced).data.weatherData)) {
      clearMatterCache();
      return false;
    }
    fs.writeFileSync(file, spliced);
    forgetEntries(ref);
    return true;
  } catch {
    clearMatterCache();
    return false;
  }
}

/**
 * What the two write routes call: the same lookup, with the outcome dropped
 * and every failure swallowed.
 *
 * Awaited by its callers rather than left floating, which is the one thing
 * worth saying about it. A detached promise in a request handler is a fetch
 * that may simply not run — the response returns, the handler is torn down,
 * and the day quietly never gets its weather. Awaiting an eight-second
 * ceiling that cannot fail the write is the honest version of "does not block
 * the write".
 */
export function fillDayWeatherQuietly(ref: string, slug: string): Promise<unknown> {
  return fillDayWeather(ref, slug).catch(() => undefined);
}
