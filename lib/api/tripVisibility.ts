import "server-only";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { getTrip, tripDir, type TripRef } from "../trips";
import type { TripVisibility } from "../types";
import { VISIBILITIES } from "../tripWrite";
import { spliceScalar } from "../frontmatterScalar";

/**
 * Amending a trip's `visibility:` (and `listed:`, and `teaser:`) after it has
 * been created — B396, B587.
 *
 * `createTrip` (lib/tripWrite.ts) could only ever write `visibility:` once, at
 * the moment the folder is made, because nothing edited `trip.md` afterwards
 * (B207). The contacts page then told an owner with no `guest` trip to "set a
 * trip's visibility to guest" — advice with nowhere to go on a hosted
 * instance, where nobody has a shell. This is the door that instruction was
 * missing, built the way B352 built `.../rates`: a textual splice of the
 * frontmatter, validated with the same list `createTrip` validates against,
 * `matter()`-parsed before writing so a corrupting edit writes nothing.
 *
 * Owner only, like `.../rates` — a trip-scoped token can write days into its
 * trip but cannot decide who else may read the whole journey. That check
 * lives in the route, not here, the same split `tripRates.ts` uses.
 */

export type VisibilityWriteResult =
  | { ok: true; visibility: TripVisibility; listed: boolean; teaser: boolean; widened: boolean }
  | { ok: false; error: string; message?: string; bug?: true };

/** Read `visibility:`/`listed:` currently on disk, as `getTrip` already
 * derives them — nothing this module does not already trust. */
export function readTripVisibility(
  ref: TripRef,
): { visibility: TripVisibility; listed: boolean; teaser: boolean } | null {
  const trip = getTrip(ref);
  if (!trip) return null;
  return { visibility: trip.visibility, listed: trip.listed, teaser: trip.teaser === true };
}

/** How widely a visibility reads, for deciding whether a change is a widening
 * one. Mirrors the ladder `mayReadTrip` (lib/tripGate.ts) climbs: `private`
 * lets in only the people who were there, `guest` adds everyone the owner has
 * approved into the journal, `public` adds everyone. */
const REACH: Record<TripVisibility, number> = { private: 0, guest: 1, public: 2 };

export function patchTripVisibility(
  ref: TripRef,
  raw: unknown,
): VisibilityWriteResult {
  const trip = getTrip(ref);
  if (!trip) return { ok: false, error: "unknown_trip" };

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      ok: false,
      error: "invalid_request",
      message:
        'Send {"visibility": "guest"}, {"listed": false}, {"teaser": true}, or any ' +
        "combination — nothing else on this trip's own fields is writable here.",
    };
  }
  const body = raw as { visibility?: unknown; listed?: unknown; teaser?: unknown };
  if (body.visibility === undefined && body.listed === undefined && body.teaser === undefined) {
    return {
      ok: false,
      error: "invalid_request",
      message: "Name at least one of visibility, listed or teaser to change.",
    };
  }

  let visibility = trip.visibility;
  if (body.visibility !== undefined) {
    if (!VISIBILITIES.includes(body.visibility as never)) {
      return {
        ok: false,
        error: "invalid_visibility",
        message:
          `visibility "${String(body.visibility)}" is not one of private, public, guest. An ` +
          "unrecognised value is refused here rather than written and read back as private " +
          "later — the same rule the file's reader already follows.",
      };
    }
    visibility = body.visibility as TripVisibility;
  }

  let listed: boolean | undefined = body.listed as boolean | undefined;
  if (listed !== undefined && typeof listed !== "boolean") {
    return { ok: false, error: "invalid_listed", message: "listed must be true or false." };
  }
  // `listed: true` on a trip its own visibility does not advertise is refused
  // rather than written — B51, the same check `createTrip` makes before
  // anything reaches disk.
  if (listed === true && visibility !== "public") {
    return {
      ok: false,
      error: "invalid_listed",
      message:
        `listed: true asks for the trip to be advertised — in the sitemap, the feed and the ` +
        `trip switcher — but visibility "${visibility}" does not put it in front of anybody. ` +
        `Only a public trip is advertised. Drop listed, or set visibility to "public".`,
    };
  }
  // No explicit `listed` in this call: keep the previous narrowing where
  // visibility hasn't changed away from public, and drop it — never carry a
  // stale `listed: true` — the moment it narrows below public, where it would
  // read as inert (B51) rather than as what the file actually says.
  if (listed === undefined) {
    listed = visibility === "public" ? trip.listed : false;
  }

  /**
   * `teaser:` — whether a closed trip says that it exists. B587.
   *
   * The mirror of `listed` above, and cleared rather than carried the moment
   * the trip goes public: a public trip is advertised by `listed`, and a
   * `teaser: true` left behind on one would be a line the reader drops.
   */
  let teaser: boolean | undefined = body.teaser as boolean | undefined;
  if (teaser !== undefined && typeof teaser !== "boolean") {
    return { ok: false, error: "invalid_teaser", message: "teaser must be true or false." };
  }
  if (teaser === true && visibility === "public") {
    return {
      ok: false,
      error: "invalid_teaser",
      message:
        `teaser: true asks for a closed trip to be named on the trips page without being ` +
        `readable, but visibility "${visibility}" already opens the whole trip to anybody. ` +
        `Drop teaser, or set visibility to "guest" or "private".`,
    };
  }
  if (teaser === undefined) {
    teaser = visibility === "public" ? false : trip.teaser === true;
  }

  const widened = REACH[visibility] > REACH[trip.visibility];

  const file = path.join(tripDir(ref), "trip.md");
  const text = fs.readFileSync(file, "utf8");
  let spliced: string | null = spliceScalar(text, "visibility", `visibility: ${visibility}`);
  if (spliced === null) {
    return {
      ok: false,
      error: "no_frontmatter",
      message: "trip.md has no frontmatter block to edit. Edit the file by hand.",
    };
  }
  // Written only when it narrows a public trip, exactly as `createTrip`
  // writes it — a `listed:` line is otherwise a key that never says anything.
  spliced = spliceScalar(spliced, "listed", visibility === "public" && !listed ? "listed: false" : null);
  // And `teaser:`, written only when it is true and therefore only on a
  // closed trip — the same "a line that never says anything" rule.
  if (spliced !== null) {
    spliced = spliceScalar(spliced, "teaser", teaser ? "teaser: true" : null);
  }
  if (spliced === null) {
    return {
      ok: false,
      error: "no_frontmatter",
      message: "trip.md has no frontmatter block to edit. Edit the file by hand.",
    };
  }

  try {
    matter(spliced);
  } catch (err) {
    const said = err instanceof Error ? err.message.split("\n")[0] : String(err);
    return {
      ok: false,
      bug: true,
      error: `The edit would leave trip.md unparseable (${said}), so nothing was written. This is a bug; please report it.`,
    };
  }

  fs.writeFileSync(file, spliced);

  const after = readTripVisibility(ref);
  if (
    !after ||
    after.visibility !== visibility ||
    after.listed !== listed ||
    after.teaser !== teaser
  ) {
    return {
      ok: false,
      bug: true,
      error: "trip.md was written but does not read back what was asked. This is a bug; please report it.",
    };
  }
  return {
    ok: true,
    visibility: after.visibility,
    listed: after.listed,
    teaser: after.teaser,
    widened,
  };
}
