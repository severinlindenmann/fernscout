import "server-only";

import { NO_JOURNAL } from "./auth";
import { getDatabaseOrNull, newId } from "./db";
import type { Attend } from "./adminConsole";

/**
 * What the operator has already said they know about — B1203.
 *
 * The band above `/admin`'s tabs is the only red on the page, and until this
 * it could be read and not answered. An entry that is a *decision* rather than
 * a job — an off-site destination this instance deliberately does not have —
 * stood above the money on every load for ever, and an alarm nobody can answer
 * is one they stop reading. That is the same finding B1085 acted on from the
 * other side when it stopped the nightly success mail.
 *
 * ## The rule, which is the whole module
 *
 * **An acknowledgement lives exactly as long as the thing it acknowledges.**
 *
 * Two halves, and each one is guarding against a different way of being wrong:
 *
 * - It **lapses when the entry gets worse.** `level` is how bad it was when it
 *   was acknowledged, in that entry's own unit, and the moment the entry is
 *   worse than that it is shown again. Acknowledging is "I know about this, at
 *   this size" and never "do not speak to me about this". Without it, a backup
 *   acknowledged at nine days stale would stay silent at ninety, and this
 *   deployment has already spent two days believing silence was health (B138,
 *   B458).
 * - It **ends when the entry goes away.** `sweepAcks` closes any row whose id
 *   is no longer in the band, so a fault that was fixed loses its
 *   acknowledgement and the same fault happening again is news. Nobody has to
 *   remember to un-hide anything, which is the step a person would never do.
 *
 * ## Nothing here decides who may call it
 *
 * `isInstanceAdmin` does, at the route and at the page. This module is asked
 * only what is hidden and told only what to hide; it holds no notion of a
 * reader and must not grow one.
 *
 * ## No database is not an error
 *
 * An instance without one is the ordinary prototype tier. Every read answers
 * "nothing is acknowledged", which shows the whole band — the safe direction,
 * and the only honest one: a failure to read the suppressions must never look
 * like a suppression.
 */

/** One press, as the page reads it. */
export type Ack = {
  /** The press. Two rows may name the same entry — see the migration. */
  id: string;
  /** What was acknowledged: the band entry's own stable id. */
  entryId: string;
  level: number;
  ackedAt: string;
  ackedBy: string;
  /** Null while it is holding. */
  endedAt: string | null;
  endedWhy: string;
};

/** Why an acknowledgement stopped holding. `fixed` is the entry no longer
 *  being in the band at all, `unhidden` is the operator asking for it back,
 *  and `superseded` is them pressing acknowledge on it again. */
export type EndedWhy = "fixed" | "unhidden" | "superseded";

/** Every acknowledgement, newest first — the history the page shows. Bounded,
 *  because this is a disclosure under a band and not an audit log; the table
 *  keeps everything and a person who wants all of it has SQL. */
export async function listAcks(limit = 50): Promise<Ack[]> {
  const handle = await getDatabaseOrNull();
  if (!handle) return [];
  try {
    const rows = await handle.db
      .selectFrom("admin_acks")
      .selectAll()
      .orderBy("acked_at", "desc")
      .limit(limit)
      .execute();
    return rows.map((row) => ({
      id: row.id,
      entryId: row.entry_id,
      level: Number(row.level ?? 0),
      ackedAt: row.acked_at,
      ackedBy: row.acked_by ?? "",
      endedAt: row.ended_at,
      endedWhy: row.ended_why ?? "",
    }));
  } catch {
    return [];
  }
}

/**
 * Acknowledge one entry, at the size it is now.
 *
 * The level is taken from the entry the caller is looking at rather than from
 * the request, so an acknowledgement cannot be filed at a level nothing ever
 * measured — which would be a way to silence something for ever by claiming it
 * was already at its worst.
 *
 * Pressing it again on an entry that is already holding ends the old press and
 * files a new one at the current level. Two rows, because that is what
 * happened, and the second one is how the history says "still, and now at this
 * size".
 */
export async function ack(entry: Attend, by: string, now = new Date()): Promise<void> {
  const handle = await getDatabaseOrNull();
  if (!handle) return;
  try {
    // At most one live row per entry, kept true here rather than by a unique
    // index: two live rows are a bug to fix, not a refusal anybody could act
    // on, and a constraint that threw would take the console down with it.
    await endAck(entry.id, "superseded", now);
    await handle.db
      .insertInto("admin_acks")
      .values({
        id: newId(),
        // Instance state and not a journal's; see the migration.
        owner_id: NO_JOURNAL,
        entry_id: entry.id,
        level: entry.level,
        acked_at: now.toISOString(),
        acked_by: by,
        ended_at: null,
        ended_why: "",
      })
      .execute();
  } catch {
    // A page that could not record an acknowledgement shows the entry again,
    // which is the failure that leaves somebody looking at a thing they have
    // already answered. The other direction hides an alarm nobody agreed to.
  }
}

/** Stop whatever is holding for one entry, with a reason for the history. */
export async function endAck(entryId: string, why: EndedWhy, now = new Date()): Promise<void> {
  const handle = await getDatabaseOrNull();
  if (!handle) return;
  try {
    await handle.db
      .updateTable("admin_acks")
      .set({ ended_at: now.toISOString(), ended_why: why })
      .where("entry_id", "=", entryId)
      .where("ended_at", "is", null)
      .execute();
  } catch {
    // As above: failing to end one leaves an entry hidden that should be
    // shown, and the next sweep tries again.
  }
}

/**
 * Close the acknowledgements whose entry is no longer there.
 *
 * Called with the band as it stands *before* anything is hidden, so an entry
 * that is merely suppressed is not mistaken for one that was fixed. Returns
 * how many were closed, which nothing reads and a test does.
 */
export async function sweepAcks(present: Attend[], acks: Ack[], now = new Date()): Promise<number> {
  const ids = new Set(present.map((one) => one.id));
  const gone = acks.filter((one) => one.endedAt === null && !ids.has(one.entryId));
  for (const one of gone) await endAck(one.entryId, "fixed", now);
  return gone.length;
}

/**
 * What the band actually shows, and what it is holding back.
 *
 * Pure, so the rule above is checkable without a database — which matters more
 * here than anywhere else on this page, because the failure mode is silence
 * and silence is what a working system also looks like.
 */
export function applyAcks(
  items: Attend[],
  acks: Ack[],
): { shown: Attend[]; hidden: Attend[] } {
  const live = new Map(acks.filter((one) => one.endedAt === null).map((one) => [one.entryId, one]));
  const shown: Attend[] = [];
  const hidden: Attend[] = [];
  for (const item of items) {
    const held = live.get(item.id);
    // Strictly worse, not merely different: a percentage that ticked *down*
    // is the thing improving, and an acknowledgement that lapsed on any
    // change at all would be one that never held for a day.
    if (held && item.level <= held.level) hidden.push(item);
    else shown.push(item);
  }
  return { shown, hidden };
}
