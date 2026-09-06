import "server-only";
import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { getTrip, tripDir, tripRef, type TripRef } from "../trips";
import type { TripPerson } from "../types";
import type { Figure } from "../travellers/vocabulary";
import { peopleBlock, travellersBlock, type BlockResult } from "../tripWrite";
import { spliceBlock } from "./tripFile";
import { authenticate, errorResponse, ownsUser } from "./auth";
import { SESSION_SCOPE } from "../auth";

/**
 * Amending a trip's `people:` and `travellers:` blocks after it has been
 * created — B524.
 *
 * The third and fourth doors of the same set: `.../rates` (B352) and
 * `.../visibility` (B396) opened first, and these were the two fields left
 * that `createTrip` could write once and nothing could ever write again. The
 * guide's own advice — "a trip that already exists takes the same block
 * written into its `trip.md`" — has nowhere to go on a hosted instance where
 * nobody has a shell, and the only remaining route was to delete the trip and
 * rewrite every day and every photograph in it.
 *
 * Built the same way as its two siblings and for the same reasons: a textual
 * splice that leaves every other byte of the file alone, validated by the
 * *same* block builders `createTrip` uses, and `matter()`-parsed before
 * anything is written so an edit that would corrupt the file writes nothing.
 *
 * **Wholesale, not merged**, which is the one place this differs from
 * `.../rates`. A rate table is a set of independent facts and merging a single
 * currency into it is obviously right. A party is a list whose *order* and
 * whose *membership* both mean something — `travellers[n].for` ties a figure
 * to an address in `people:` — so a call that named one person and left the
 * rest implied would have to guess whether the others were being kept or
 * dropped. Send the whole list; send `[]` to clear it.
 */

export type PartyWriteResult =
  | { ok: true; people: TripPerson[]; travellers: Figure[] }
  | { ok: false; error: string; message?: string; bug?: true };

/** What the trip says today. Read through `getTrip`, so it is exactly what
 * the site itself reads — a block this module wrote and the site then ignored
 * would show up here as a difference rather than as agreement. */
export function readTripParty(ref: TripRef): { people: TripPerson[]; travellers: Figure[] } | null {
  const trip = getTrip(ref);
  if (!trip) return null;
  return { people: trip.people, travellers: trip.travellers };
}

/**
 * Write one of the two blocks. `raw` is the same shape `createTrip` takes for
 * that field — a list, or `[]` to clear it.
 */
export function patchTripParty(
  ref: TripRef,
  key: "people" | "travellers",
  raw: unknown,
): PartyWriteResult {
  const trip = getTrip(ref);
  if (!trip) return { ok: false, error: "unknown_trip" };

  if (!Array.isArray(raw)) {
    return {
      ok: false,
      error: `invalid_${key}`,
      message:
        `${key} must be a list — the whole list, not the part that changed. Send \`[]\` to ` +
        `clear it. Read the trip back first if you only mean to add somebody: this replaces ` +
        `what is there.`,
    };
  }

  // The same validator the create call uses, so a body refused here would
  // have been refused at creation and one accepted reads back identically.
  // An empty list is `{ok: true, lines: []}` from both, which `spliceBlock`
  // then reads as "remove the key".
  const block: BlockResult = key === "people" ? peopleBlock(raw) : travellersBlock(raw);
  if (!block.ok) return { ok: false, error: block.error, message: block.message };

  const file = path.join(tripDir(ref), "trip.md");
  const text = fs.readFileSync(file, "utf8");
  const spliced = spliceBlock(text, key, block.lines);
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

  const after = readTripParty(ref);
  if (!after) {
    return {
      ok: false,
      bug: true,
      error: "trip.md was written and the trip no longer reads. This is a bug; please report it.",
    };
  }
  // Written but not read back is the failure worth naming out loud: both
  // parsers fail *open* on a bad entry (`parsePeople` drops the whole list,
  // `parseTravellers` substitutes defaults), so a silent disagreement between
  // this writer and those readers would otherwise look like success.
  if (after[key].length !== raw.length) {
    return {
      ok: false,
      bug: true,
      error:
        `trip.md was written with ${raw.length} ${key} but reads back with ` +
        `${after[key].length}. This is a bug; please report it.`,
    };
  }
  return { ok: true, ...after };
}

/**
 * The gate both routes stand behind: the journal's owner, on a trip that
 * exists.
 *
 * Shared rather than copied a third and fourth time — `.../rates` and
 * `.../visibility` each carry their own `resolve()`, and the only thing that
 * differs between them is the sentence in the refusal. That sentence is the
 * argument, so it is the parameter.
 *
 * **Owner only, and `people:` is why it has to be.** `mayWriteTrip` would let
 * anyone already on the trip through, and everyone on `people:` may write to
 * the whole trip — so a trip-scoped token could add its holder's friends to
 * the list that decides who else may write, and remove the owner's own
 * co-traveller. Being on the bus is not deciding who is on it. `travellers:`
 * is cosmetic and could defensibly be looser; it is held to the same line so
 * there is one answer to "who may edit a trip's own fields" rather than two.
 */
export async function resolveTripOwner(
  request: Request,
  user: string,
  trip: string,
  refusal: string,
): Promise<{ ok: true; ref: TripRef } | { ok: false; response: Response }> {
  const auth = await authenticate(request);
  if (!auth.ok) return { ok: false, response: errorResponse(auth) };

  if (!ownsUser(auth.session, user)) {
    return { ok: false, response: Response.json({ error: "out_of_scope" }, { status: 403 }) };
  }

  const ref = tripRef(user, trip);
  if (!getTrip(ref)) {
    return { ok: false, response: Response.json({ error: "unknown_trip" }, { status: 404 }) };
  }

  if (auth.session.scope !== SESSION_SCOPE.agent) {
    return {
      ok: false,
      response: Response.json({ error: "out_of_scope", message: refusal }, { status: 403 }),
    };
  }

  return { ok: true, ref };
}
