import "server-only";
import fs from "node:fs";
import path from "node:path";
import { contentRoot } from "./contentRoot";
import { ID_RE } from "./tripWrite";
import { forgetEntries } from "./entries";
import { getTrip, tripDir, tripRef } from "./trips";
import { getDatabase, TABLE_NAMES } from "./db";
import { sql } from "kysely";

/**
 * Renaming a trip's id — B2015.
 *
 * A trip id is the folder name, `trip.json`'s own `id`, the name of its
 * derived `track.json` (which lives inside the folder and moves with it —
 * `lib/gps/track.ts`'s `trackFile` builds its path from the same two
 * arguments this module renames), and every database row a `trip_id`
 * column names. Once it is wrong there was no way back short of editing the
 * folder by hand, which misses every one of those.
 *
 * **What this never touches.** `content/<user>/gps/` is not addressed by
 * trip id at all (`lib/gps/store.ts`) — a rename changes nothing about it.
 * `credit_ledger.ref` (`<username>/<trip-id>/<slug>`) is a historical
 * record of what was actually spent, under the name the trip had at the
 * time, and is left alone the same way `deleteTrip` in `lib/deletions.ts`
 * leaves it (that table carries no `trip_id` column to begin with).
 *
 * **The redirect record.** `content/<user>/renamed.json` maps old id → new
 * id, appended to on every rename — never overwritten — so a trip renamed
 * twice (`a` → `b` → `c`) resolves from either earlier address by following
 * the chain. `resolveRenamedTripId` is the one place that walks it.
 */

const RENAME_CHAIN_LIMIT = 20;

/** Same shape trip creation already enforces (`lib/tripWrite.ts`'s `ID_RE`),
 * plus the length ceiling this ticket asks for. Not folded into `ID_RE`
 * itself — that pattern is also used to validate an id that is simply being
 * *read*, e.g. `parseTripRef`, and widening its job to "and short enough"
 * would be a change with a much bigger blast radius than a rename needs. */
export function isValidTripId(id: string): boolean {
  return typeof id === "string" && id.length > 0 && id.length <= 60 && ID_RE.test(id);
}

function renamedMapFile(username: string): string {
  return path.join(contentRoot(), username, "renamed.json");
}

/** The raw map on disk: old id → new id, one entry per rename ever done.
 * `{}` for a journal that has never renamed a trip, or an unreadable file —
 * a corrupt map must not make every trip look renamed away. */
export function readRenamedMap(username: string): Record<string, string> {
  try {
    const raw = JSON.parse(fs.readFileSync(renamedMapFile(username), "utf8"));
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === "string") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function writeRenamedMap(username: string, map: Record<string, string>): void {
  fs.mkdirSync(path.join(contentRoot(), username), { recursive: true });
  fs.writeFileSync(renamedMapFile(username), `${JSON.stringify(map, null, 2)}\n`, "utf8");
}

/**
 * Follows the chain from `id` to wherever it now lands — `id` itself when
 * nothing has ever renamed it away. Cycle-safe: a map that somehow loops
 * (never written by `renameTrip`, but this reads a file a person could
 * hand-edit) stops after `RENAME_CHAIN_LIMIT` hops rather than looping the
 * request forever.
 */
export function resolveRenamedTripId(username: string, id: string): string {
  const map = readRenamedMap(username);
  let current = id;
  const seen = new Set<string>([current]);
  for (let hop = 0; hop < RENAME_CHAIN_LIMIT; hop++) {
    const next = map[current];
    if (next === undefined || seen.has(next)) return current;
    current = next;
    seen.add(current);
  }
  return current;
}

export type RenameRefusal = {
  ok: false;
  error: "unknown_trip" | "invalid_trip_id" | "same_id" | "trip_id_taken";
};

export type RenameDone = { ok: true; id: string };

/**
 * Every table `lib/db/schema.ts` gives a `trip_id` column, discovered the
 * same way `deleteTrip` (`lib/deletions.ts`) discovers them for a delete —
 * a list written out by hand here is a list that stops being true the first
 * time a table gains one. All of it inside one transaction: a rename that
 * moved the folder but updated only half the database would leave a grant,
 * an order or an agent key pointing at an id that no longer exists.
 */
async function renameDatabaseRows(username: string, oldId: string, newId: string): Promise<void> {
  const { db } = await getDatabase();
  await db.transaction().execute(async (trx) => {
    const tables = await trx.introspection.getTables();
    for (const table of tables) {
      if (!(TABLE_NAMES as readonly string[]).includes(table.name)) continue;
      if (!table.columns.some((c) => c.name === "trip_id")) continue;
      await sql`update ${sql.table(table.name)} set trip_id = ${newId} where owner_id = ${username} and trip_id = ${oldId}`.execute(
        trx,
      );
    }
  });
}

/**
 * The whole operation: refuse, or rename the folder, rewrite `trip.json`'s
 * `id`, move every database row, and keep the redirect record.
 *
 * The track (`trips/<id>/track.json`) needs no move of its own — it lives
 * inside the folder this renames and travels with it, the same as every
 * day file and every photograph.
 */
export async function renameTrip(
  username: string,
  oldId: string,
  newId: string,
): Promise<RenameDone | RenameRefusal> {
  if (!isValidTripId(newId)) return { ok: false, error: "invalid_trip_id" };
  if (newId === oldId) return { ok: false, error: "same_id" };

  const trip = getTrip(tripRef(username, oldId));
  if (!trip) return { ok: false, error: "unknown_trip" };
  if (getTrip(tripRef(username, newId))) return { ok: false, error: "trip_id_taken" };

  const fromDir = tripDir(tripRef(username, oldId));
  const toDir = tripDir(tripRef(username, newId));
  if (fs.existsSync(toDir)) return { ok: false, error: "trip_id_taken" };

  // The folder move first: if this throws (e.g. a permission error), nothing
  // has been recorded as renamed and the database still names the id that is
  // still the one on disk.
  fs.renameSync(fromDir, toDir);

  const tripJsonPath = path.join(toDir, "trip.json");
  const raw = JSON.parse(fs.readFileSync(tripJsonPath, "utf8")) as Record<string, unknown>;
  raw.id = newId;
  fs.writeFileSync(tripJsonPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");

  // The folder moved first so a database failure can put it back; the
  // other order would leave rows naming a folder that does not exist yet.
  try {
    await renameDatabaseRows(username, oldId, newId);
  } catch (error) {
    raw.id = oldId;
    fs.writeFileSync(tripJsonPath, `${JSON.stringify(raw, null, 2)}\n`, "utf8");
    fs.renameSync(toDir, fromDir);
    throw error;
  }

  const map = readRenamedMap(username);
  map[oldId] = newId;
  writeRenamedMap(username, map);

  forgetEntries(tripRef(username, oldId));
  forgetEntries(tripRef(username, newId));

  return { ok: true, id: newId };
}
