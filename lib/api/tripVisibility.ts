import "server-only";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { getTrip, tripDir, type TripRef } from "../trips";
import type { TripVisibility } from "../types";
import { VISIBILITIES } from "../tripWrite";

/**
 * Amending a trip's `visibility:` (and `listed:`) after it has been created — B396.
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

const INDENTED_RE = /^\s+\S/;

/** Where `key:` starts inside the frontmatter, or -1 if absent. Mirrors
 * `frontmatterLineOf` in tripRates.ts — same small copy, same reason: the two
 * touch different files and different shapes (a block there, a scalar here). */
function frontmatterLineOf(lines: string[], closing: number, key: string): number {
  const pattern = new RegExp(`^${key}:(\\s|$)`);
  return lines.findIndex((line, i) => i > 0 && i < closing && pattern.test(line));
}

/**
 * Replace, insert or remove one top-level scalar line (`key: value`), never
 * an indented block — `visibility:` and `listed:` are each ever one line.
 * `newLine === null` removes the key rather than writing it, which is how a
 * stale `listed: false` from before this call is cleared once it no longer
 * says anything the new visibility does not already say on its own.
 */
function spliceScalar(markdown: string, key: string, newLine: string | null): string | null {
  const lines = markdown.split("\n");
  if (lines[0]?.trim() !== "---") return null;
  const closing = lines.findIndex((line, i) => i > 0 && line.trim() === "---");
  if (closing < 0) return null;

  const at = frontmatterLineOf(lines, closing, key);
  if (at >= 0) {
    let end = at + 1;
    while (end < closing && INDENTED_RE.test(lines[end])) end++;
    lines.splice(at, end - at, ...(newLine === null ? [] : [newLine]));
  } else if (newLine !== null) {
    lines.splice(closing, 0, newLine);
  }
  return lines.join("\n");
}

export type VisibilityWriteResult =
  | { ok: true; visibility: TripVisibility; listed: boolean; widened: boolean }
  | { ok: false; error: string; message?: string; bug?: true };

/** Read `visibility:`/`listed:` currently on disk, as `getTrip` already
 * derives them — nothing this module does not already trust. */
export function readTripVisibility(ref: TripRef): { visibility: TripVisibility; listed: boolean } | null {
  const trip = getTrip(ref);
  if (!trip) return null;
  return { visibility: trip.visibility, listed: trip.listed };
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
        'Send {"visibility": "guest"}, {"listed": false}, or both — nothing else on this ' +
        "trip's own fields is writable here.",
    };
  }
  const body = raw as { visibility?: unknown; listed?: unknown };
  if (body.visibility === undefined && body.listed === undefined) {
    return {
      ok: false,
      error: "invalid_request",
      message: "Name at least one of visibility or listed to change.",
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
  if (!after || after.visibility !== visibility || after.listed !== listed) {
    return {
      ok: false,
      bug: true,
      error: "trip.md was written but does not read back what was asked. This is a bug; please report it.",
    };
  }
  return { ok: true, visibility: after.visibility, listed: after.listed, widened };
}
