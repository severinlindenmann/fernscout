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
  } catch {
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

async function setStatus(
  owner: string,
  id: string,
  status: string,
  payload: PhotobookPayload,
): Promise<void> {
  const handle = await getDatabaseOrNull();
  if (!handle) return;
  await handle.db
    .updateTable("print_orders")
    .set({ status, payload: JSON.stringify(payload), updated_at: nowIso() })
    .where("id", "=", id)
    .where("owner_id", "=", owner)
    .where("kind", "=", "photobook")
    .execute();
}

export async function markPrinted(
  owner: string,
  id: string,
  payload: PhotobookPayload,
): Promise<void> {
  await setStatus(owner, id, "printed", payload);
}

export async function markFailed(
  owner: string,
  id: string,
  payload: PhotobookPayload,
  failure: string,
): Promise<void> {
  await setStatus(owner, id, "failed", { ...payload, failure });
}
