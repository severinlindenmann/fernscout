import "server-only";
import { getDatabaseOrNull, nowIso } from "../db";
import type { BookOptions } from "./options";

/**
 * A photobook order: a row that says money moved and paper was planned.
 *
 * ## Why the row appears at pay and not before
 *
 * A postcard order is a *proposal*: an agent composes it and a person looks at
 * it later, so the row has to exist before anybody presses anything. Nothing
 * of that applies here. The person configuring the book and the person paying
 * for it are one person looking at one screen, and a row per abandoned
 * configuration would be a table of half-imagined books nobody will ever open.
 *
 * ## What replaces `claimForSend`
 *
 * The double-press guard is still rows-affected rather than read-then-write,
 * but the statement is the insert: the page renders an id, the form posts it,
 * and `id` is the primary key. Two presses race to insert the same key and
 * exactly one of them wins. The second is told the book is already being
 * made, which is true.
 *
 * That id arrives from a browser, so it is validated rather than trusted —
 * it names a directory under `content/<user>/photobooks/` a moment later.
 */

/** Long enough not to collide, plain enough to be a directory name. */
export const ORDER_ID_RE = /^[a-z0-9][a-z0-9-]{6,63}$/;

export type PhotobookPayload = {
  /** `<username>/<trip-id>`. */
  trip: string;
  options: BookOptions;
  /** Interior pages, summed over the volumes. */
  pages: number;
  volumes: number;
  /** What was charged, in credits. Frozen here: the price table may change. */
  credits: number;
  /** File names under the order's directory, written when the render finishes. */
  files?: string[];
  /** Why nothing was made. Set with `markFailed`, and the credits are back. */
  failure?: string;
};

export type PhotobookOrder = {
  id: string;
  owner: string;
  status: string;
  payload: PhotobookPayload;
  createdAt: string;
  updatedAt: string;
};

/**
 * Take an id for this order, or say somebody already has.
 *
 * `id` is the primary key, so the insert itself is the double-press guard:
 * two presses race to insert the same row and exactly one succeeds. The
 * loser is told the book is already being made, which is true — nothing here
 * distinguishes a primary-key conflict from any other reason the insert
 * failed, because every failure means the same safe thing: no order was
 * claimed, and no credits should be read as spent.
 */
export async function claimOrder(
  owner: string,
  id: string,
  payload: PhotobookPayload,
): Promise<boolean> {
  if (!ORDER_ID_RE.test(id)) return false;
  const handle = await getDatabaseOrNull();
  if (!handle) return false;
  const now = nowIso();
  try {
    await handle.db
      .insertInto("print_orders")
      .values({
        id,
        owner_id: owner,
        kind: "photobook",
        // No provider has been called and none will be by this code path.
        // `dry-run` is what the postcard pipeline calls the same honesty.
        provider: "dry-run",
        provider_ref: null,
        contact_id: null,
        trip_id: payload.trip,
        status: "submitted",
        payload: JSON.stringify(payload),
        cost_minor: null,
        currency: null,
        created_at: now,
        updated_at: now,
      })
      .execute();
    return true;
  } catch (err) {
    // A primary-key conflict is the ordinary double-press and is expected
    // constantly; a lock timeout or a full disk looks identical from here and
    // is not. Telling the two apart reliably across SQLite and Postgres isn't
    // worth the code, so this logs unconditionally, at a level quiet enough
    // not to page anyone over a double click but present in the logs for the
    // outage that isn't one.
    console.warn(`photobook claimOrder(${owner}, ${id}) failed:`, err);
    return false;
  }
}

/**
 * One order, or null.
 *
 * Scoped to the owner in the query, not checked afterwards — a journal
 * cannot read another journal's order by guessing an id.
 */
export async function getPhotobookOrder(owner: string, id: string): Promise<PhotobookOrder | null> {
  if (!ORDER_ID_RE.test(id)) return null;
  const handle = await getDatabaseOrNull();
  if (!handle) return null;
  const row = await handle.db
    .selectFrom("print_orders")
    .select(["id", "owner_id", "status", "payload", "created_at", "updated_at"])
    .where("id", "=", id)
    .where("owner_id", "=", owner)
    .where("kind", "=", "photobook")
    .executeTakeFirst();
  if (!row) return null;
  return {
    id: row.id,
    owner: row.owner_id,
    status: row.status,
    payload: JSON.parse(row.payload) as PhotobookPayload,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Move a claimed order to a terminal status, and say whether it happened.
 *
 * Gated on `status = 'submitted'`, the same rows-affected reasoning as
 * `claimForSend`: `submitted` is the only status this is meant to leave, so a
 * second call — the render finishing twice, or a failure notice arriving
 * after a printed one — changes nothing instead of overwriting a `failed` row
 * (whose `payload.failure` means the credits were already returned) back to
 * `printed`, which would read as fine while the refund silently stood.
 */
async function setStatus(
  owner: string,
  id: string,
  status: string,
  payload: PhotobookPayload,
): Promise<boolean> {
  if (!ORDER_ID_RE.test(id)) return false;
  const handle = await getDatabaseOrNull();
  if (!handle) return false;
  const result = await handle.db
    .updateTable("print_orders")
    .set({ status, payload: JSON.stringify(payload), updated_at: nowIso() })
    .where("id", "=", id)
    .where("owner_id", "=", owner)
    .where("kind", "=", "photobook")
    .where("status", "=", "submitted")
    .executeTakeFirst();
  // bigint on both dialects; Number() for the same reason claimForSend uses it.
  return Number(result.numUpdatedRows ?? 0) === 1;
}

export async function markPrinted(
  owner: string,
  id: string,
  payload: PhotobookPayload,
): Promise<boolean> {
  return setStatus(owner, id, "printed", payload);
}

export async function markFailed(
  owner: string,
  id: string,
  payload: PhotobookPayload,
  failure: string,
): Promise<boolean> {
  return setStatus(owner, id, "failed", { ...payload, failure });
}
