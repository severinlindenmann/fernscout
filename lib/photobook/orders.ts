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
  /**
   * Set by `pruneOldPhotobooks` (B483, `lib/photobook/retention.ts`) once the
   * PDFs have been deleted to make room for newer orders. `files` is emptied
   * at the same time, so a page rendering this order stops offering downloads
   * that would 404 rather than discovering that the hard way.
   */
  pruned?: true;
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
 * Every state `order/route.ts`'s redirect can carry back to the page — B484.
 *
 * `PhotobookOutcome.state` used to be typed `string`, so `OUTCOME_MESSAGE` in
 * `PhotobookPageContent.tsx` could be missing an entry for a state the route
 * actually sends and nothing would say so: the page rendered nothing at all
 * for a redirect it did not recognise, which is exactly how a *future* state
 * would show the owner — who has often just paid — a blank page. Typed as a
 * union instead, `OUTCOME_MESSAGE` is declared as an exact `Record` over it
 * (minus `"done"`, which renders its own success panel rather than a message
 * from that table), so adding a state here without a matching entry there
 * fails the typecheck instead of failing silently in a browser.
 *
 * `"refund_failed"` is deliberately not a member: B509 reordered the route to
 * build before spending, so a failed build is never charged and there is
 * nothing left to refund. The locale string survives, unused, because a
 * dictionary entry costs nothing to leave and `test/locales.test.ts` only
 * asks that every *shipped* key exists in every locale, not that every key is
 * reachable.
 */
export const PHOTOBOOK_OUTCOME_STATES = ["done", "duplicate", "no_credits", "no_photos", "failed"] as const;
export type PhotobookOutcomeState = (typeof PHOTOBOOK_OUTCOME_STATES)[number];

function isOutcomeState(value: string): value is PhotobookOutcomeState {
  return (PHOTOBOOK_OUTCOME_STATES as readonly string[]).includes(value);
}

/**
 * Every printed order for one journal, newest first — B483's retention needs
 * to know which ones are oldest, and `printed` is deliberately the only
 * status considered: a `submitted` order is a build in progress and must
 * never be touched, and a `failed` one left no files behind to prune.
 */
export async function listPrintedOrderIds(owner: string): Promise<string[]> {
  const handle = await getDatabaseOrNull();
  if (!handle) return [];
  const rows = await handle.db
    .selectFrom("print_orders")
    .select(["id"])
    .where("owner_id", "=", owner)
    .where("kind", "=", "photobook")
    .where("status", "=", "printed")
    .orderBy("created_at", "desc")
    .orderBy("id", "desc")
    .execute();
  return rows.map((r) => r.id);
}

/**
 * Records that an order's PDFs were removed to make room for newer ones.
 *
 * Deliberately not `setStatus`: the order is not failing or being reprinted,
 * it stays `printed` — the book was made and paid for — only its files are
 * gone. Not gated on the current status the way `setStatus` is, either,
 * because pruning only ever runs against orders `listPrintedOrderIds` already
 * found `printed`, moments earlier in the same call.
 */
export async function clearPrunedFiles(
  owner: string,
  id: string,
  payload: PhotobookPayload,
): Promise<void> {
  const handle = await getDatabaseOrNull();
  if (!handle) return;
  await handle.db
    .updateTable("print_orders")
    .set({ payload: JSON.stringify({ ...payload, files: [], pruned: true }), updated_at: nowIso() })
    .where("id", "=", id)
    .where("owner_id", "=", owner)
    .where("kind", "=", "photobook")
    .execute();
}

/** What the options page shows above the form, once the button has actually
 * been pressed. `orderId` is carried alongside `files` — rather than left for
 * the page to re-read off `window.location` — so the download links below
 * can be built without touching a browser API that does not exist during the
 * server render. */
export type PhotobookOutcome = { state: PhotobookOutcomeState; orderId: string | null; files: string[] };

/**
 * Turn `order/route.ts`'s redirect query into what the page needs to render
 * it — both `photobook/page.tsx` and `trips/[trip]/photobook/page.tsx` read
 * an identical `?state=&order=` this way, since `back()` always lands on the
 * second one but both accept the query.
 *
 * Only a successful order has files to hand over, and the lookup only runs
 * for `state=done` with an id shaped like one this route would ever have
 * produced — a stray query parameter must not turn into a lookup of somebody
 * else's order, and every other state needs no row at all.
 */
export async function outcomeFrom(
  owner: string,
  query: Record<string, string | string[] | undefined>,
): Promise<PhotobookOutcome | null> {
  const state = query.state;
  const order = query.order;
  // A stray or stale `?state=` — a bookmarked link from before a state was
  // renamed, or somebody's own typing — is treated the same as no outcome at
  // all, rather than reaching the page as a value `OUTCOME_MESSAGE` was never
  // going to have an entry for.
  if (typeof state !== "string" || !isOutcomeState(state)) return null;
  if (state !== "done" || typeof order !== "string" || !ORDER_ID_RE.test(order)) {
    return { state, orderId: null, files: [] };
  }
  const found = await getPhotobookOrder(owner, order);
  return { state, orderId: order, files: found?.payload.files ?? [] };
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
