import "server-only";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import {
  clearMatterCache,
  entrySlugFromFile,
  fileUnchangedSince,
  forgetEntries,
} from "../entries";
import { tripDir } from "../trips";
import { spliceEntryFields } from "./entries";
import { timezoneForCoordinates } from "../timezone";

/**
 * Filling in a day's zone from coordinates it already carries — B1090.
 *
 * The same shape as `fillDayWeather` in `lib/api/weather.ts`, one call
 * cheaper: there is no third party to ask, so there is no `capability_off`,
 * no `not_asked` and no `no_answer` — `tz-lookup` either has an answer for a
 * coordinate or it does not, synchronously. What stays identical is the
 * refusal to overwrite: a day that already names a zone, hand-written or
 * resolved on an earlier run, is left exactly as it is.
 *
 * Two callers, same as weather's: the day-create and day-edit paths call the
 * resolver inline (`lib/api/entries.ts`, `createDraft` and `editEntry`) for a
 * day being written right now, and this is the sweep for every day that
 * already existed before B1090 shipped and therefore never got the chance.
 */
export type TimezoneFillOutcome =
  | "filled"
  | "would_fill"
  | "already_recorded"
  | "no_coordinates"
  | "unresolvable"
  | "unwritable";

export function fillDayTimezone(
  ref: string,
  slug: string,
  options?: { dryRun?: boolean },
): TimezoneFillOutcome {
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
    clearMatterCache();
    return "unwritable";
  }

  if (typeof data.timezone === "string" && data.timezone.length > 0) {
    return "already_recorded";
  }

  const lat = typeof data.lat === "number" ? data.lat : undefined;
  const lng = typeof data.lng === "number" ? data.lng : undefined;
  if (lat === undefined || lng === undefined) return "no_coordinates";

  const zone = timezoneForCoordinates(lat, lng);
  if (!zone) return "unresolvable";

  if (options?.dryRun) return "would_fill";

  try {
    const spliced = spliceEntryFields(raw, { timezone: zone });
    if (spliced === null) return "unwritable";
    if (matter(spliced).data.timezone !== zone) {
      clearMatterCache();
      return "unwritable";
    }
    // B643, same guard `writeWeather` uses: refuse rather than clobber a
    // second writer that touched this file since the read above.
    if (!fileUnchangedSince(file, raw)) return "unwritable";
    fs.writeFileSync(file, spliced);
    forgetEntries(ref);
    return "filled";
  } catch {
    clearMatterCache();
    return "unwritable";
  }
}
