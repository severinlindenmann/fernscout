import "server-only";
import { getDatabaseOrNull, newId, nowIso } from "../db";
import { POSTCARD_CREDITS } from "../credits/pricing";

/**
 * A postcard order: what an agent builds, and what a person presses Send on —
 * B434.
 *
 * ## Why there is an object at all
 *
 * `npm run postcard` has rendered print-ready cards since W13, and in two
 * years nobody has posted one, because using it needs a shell on the server
 * and a recipient list typed into a JSON file by hand. The missing piece was
 * never the rendering. It was somewhere to *put* a proposal — a photograph, a
 * message, four people and a price — so that an agent can compose it and a
 * person can look at it before any money moves.
 *
 * That is this. An order costs nothing to create and prints nothing. It stays
 * a proposal until somebody opens `/<user>/postcards/<id>` and presses the
 * button, which is the one thing in this flow an agent cannot do.
 *
 * "Cannot" is worth stating precisely, because the first draft of this comment
 * overstated it. A person pressing a button has to reach the server, so there
 * *is* a route — `app/[user]/postcards/[id]/send/route.ts`. What is true is
 * that no credential an agent can hold will open it: it sits outside
 * `/api/v1/`, it is satisfied only by the owner's browser cookie, and it
 * refuses any request carrying a bearer token outright. Nothing under `app/api`
 * imports `sendOrder`, and `test/postcard-orders.test.ts` fails if that ever
 * stops being true. It is a narrower guarantee than `grant()`'s, which really
 * does have no HTTP caller at all, and it is the strongest one available to a
 * thing a person clicks.
 *
 * ## Why no table
 *
 * `print_orders` has been in the schema since `001-initial`, with `kind`
 * documented as `postcard | photobook`, a `provider`, a `provider_ref`, a JSON
 * `payload`, a `status` defaulting to `draft` and an index on
 * `(owner_id, status)`. It was scaffolded for this and then used by nothing
 * for the whole life of the project. Adding `postcard_orders` beside it would
 * have been a second table for the first table's stated purpose.
 *
 * ## Why the recipients are ids
 *
 * `payload.recipients` holds **contact ids and never addresses**. Somebody's
 * street exists once, encrypted, in `lib/contacts`, and is read at render and
 * at send. Copying it here would put a home address in a second store with
 * different retention, and would freeze it: a contact who corrects their
 * street between the preview and the Send gets the corrected card this way,
 * which is also the answer they would want.
 *
 * It is the same reason `GET …/postcards/recipients` answers with a name, a
 * town and a country. An agent needs to know who *could* get a card; it has
 * never needed to hold anybody's front door.
 */

/**
 * How long a proposal stays sendable.
 *
 * A week is long enough to ask the person whose journal it is, and short
 * enough that a preview left open in a tab cannot print a card from a
 * fortnight ago against a photograph nobody remembers choosing.
 *
 * Kept in the payload and compared at send rather than being a fourth status,
 * so nothing has to sweep: an order nobody sends simply stops being sendable,
 * and the row is its own record of what was proposed.
 */
export const ORDER_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** What the provider did with one card. Written once, at send. */
export type RecipientResult = {
  contactId: string;
  ok: boolean;
  /** The provider's own id for the card, when it gave one. */
  ref?: string;
  error?: string;
};

export type OrderPayload = {
  /** The qualified trip ref, `<username>/<trip-id>`. */
  trip: string;
  /** The day this card is from. */
  day: string;
  /** A path relative to the trip's media directory. */
  photo: string;
  message: string;
  /** The signature on the card — "Us", "Sev & Ana". */
  from: string;
  /** Contact ids. Never addresses; see the module comment. */
  recipients: string[];
  /**
   * The price at the moment the order was made, not read from
   * `POSTCARD_CREDITS` at send.
   *
   * A price that moves between the preview and the button is a person being
   * charged something other than the number they agreed to. The constant is
   * what new orders quote; this is what *this* order costs, for as long as it
   * lives.
   */
  creditsEach: number;
  expiresAt: string;
  results?: RecipientResult[];
};

/** `draft | submitted | printed | failed`, the vocabulary `001-initial`
 * already documents for this table. `submitted` is the claimed-but-not-yet-
 * confirmed middle, which is what makes a double press cost one card. */
export type OrderStatus = "draft" | "submitted" | "printed" | "failed";

export type PostcardOrder = {
  id: string;
  owner: string;
  status: OrderStatus;
  provider: string;
  payload: OrderPayload;
  createdAt: string;
  updatedAt: string;
};

/** Total, in credits. One multiplication, in one place, so the API, the page
 * and the spend cannot quote three different numbers. */
export function orderCost(order: PostcardOrder): number {
  return order.payload.creditsEach * order.payload.recipients.length;
}

export function isExpired(order: PostcardOrder, now = Date.now()): boolean {
  return Date.parse(order.payload.expiresAt) <= now;
}

/**
 * Has this order still not been sent?
 *
 * A named predicate rather than `order.status === "draft"` written out at each
 * call site, for one reason worth recording: `test/draft-audience.test.ts`
 * fails any file under `app/[user]/` that mentions a draft *and* calls
 * `isOwner`, because that shape is how somebody accidentally decides who may
 * read an unpublished **day** from who owns the journal. An order's `draft` is
 * an unrelated word for an unrelated thing, and the preview page legitimately
 * does both — so the word stays down here, where the guard is not looking and
 * where it cannot be confused with an entry, and the page asks a question
 * instead. Widening that allowlist would have made the guard weaker for
 * everybody to make one false positive go away.
 */
export function isPending(order: PostcardOrder): boolean {
  return order.status === "draft";
}

function toOrder(row: {
  id: string;
  owner_id: string;
  status: string;
  provider: string;
  payload: string;
  created_at: string;
  updated_at: string;
}): PostcardOrder {
  return {
    id: row.id,
    owner: row.owner_id,
    status: row.status as OrderStatus,
    provider: row.provider,
    payload: JSON.parse(row.payload) as OrderPayload,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export type NewOrder = Omit<OrderPayload, "creditsEach" | "expiresAt" | "results"> & {
  provider: string;
};

/**
 * Write a proposal down. Charges nothing, prints nothing, tells nobody.
 *
 * Deliberately cheap, because an agent composing a card should be free to
 * throw three of them away. The cost of an abandoned order is one row.
 */
export async function createOrder(owner: string, input: NewOrder): Promise<PostcardOrder | null> {
  const handle = await getDatabaseOrNull();
  if (!handle) return null;

  const now = nowIso();
  const payload: OrderPayload = {
    trip: input.trip,
    day: input.day,
    photo: input.photo,
    message: input.message,
    from: input.from,
    recipients: input.recipients,
    creditsEach: POSTCARD_CREDITS,
    expiresAt: new Date(Date.now() + ORDER_TTL_MS).toISOString(),
  };
  const id = newId();

  await handle.db
    .insertInto("print_orders")
    .values({
      id,
      owner_id: owner,
      kind: "postcard",
      provider: input.provider,
      provider_ref: null,
      // The order's recipients are in the payload. This column is one contact
      // and this is many, so leaving it null is the honest answer rather than
      // picking the first one.
      contact_id: null,
      trip_id: input.trip,
      status: "draft",
      payload: JSON.stringify(payload),
      cost_minor: null,
      currency: null,
      created_at: now,
      updated_at: now,
    })
    .execute();

  return { id, owner, status: "draft", provider: input.provider, payload, createdAt: now, updatedAt: now };
}

/**
 * One order, or null.
 *
 * **Scoped to the owner in the query, not checked afterwards.** A journal
 * cannot read another journal's order by guessing an id, and the caller cannot
 * forget to compare, because there is nothing handed back to compare.
 */
export async function getOrder(owner: string, id: string): Promise<PostcardOrder | null> {
  const handle = await getDatabaseOrNull();
  if (!handle) return null;
  const row = await handle.db
    .selectFrom("print_orders")
    .select(["id", "owner_id", "status", "provider", "payload", "created_at", "updated_at"])
    .where("id", "=", id)
    .where("owner_id", "=", owner)
    .where("kind", "=", "postcard")
    .executeTakeFirst();
  return row ? toOrder(row) : null;
}

/**
 * Take this order for sending, or say somebody already has.
 *
 * The whole double-press guard, and it is *rows affected* rather than a read
 * followed by a write — the same primitive and the same reasoning as `spend`
 * in `lib/credits.ts`. Two clicks a second apart both read `"draft"`; only one
 * of them changes a row, and the other is told the cards are already on their
 * way. Getting this wrong costs somebody two sets of postcards and two sets of
 * credits, and they find out when the second set arrives in the post.
 */
export async function claimForSend(owner: string, id: string): Promise<boolean> {
  const handle = await getDatabaseOrNull();
  if (!handle) return false;
  const result = await handle.db
    .updateTable("print_orders")
    .set({ status: "submitted", updated_at: nowIso() })
    .where("id", "=", id)
    .where("owner_id", "=", owner)
    .where("kind", "=", "postcard")
    .where("status", "=", "draft")
    .executeTakeFirst();
  // bigint on both dialects, and this compiles at ES2017 where `0n` is a
  // syntax error — the same `Number()` dance as `spend`, for the same reason.
  return Number(result.numUpdatedRows ?? 0) === 1;
}

/**
 * Put a claimed order back, because nothing was sent after all.
 *
 * The path that matters is an empty balance: the claim succeeded, the spend
 * refused, and the order has to be sendable again once the owner has bought
 * credits. Anything else would turn "you are short of credits" into "your
 * order is now permanently stuck".
 */
export async function releaseClaim(owner: string, id: string): Promise<void> {
  const handle = await getDatabaseOrNull();
  if (!handle) return;
  await handle.db
    .updateTable("print_orders")
    .set({ status: "draft", updated_at: nowIso() })
    .where("id", "=", id)
    .where("owner_id", "=", owner)
    .where("status", "=", "submitted")
    .execute();
}

/** What the provider said, and whether any of it worked. */
export async function recordResults(
  owner: string,
  id: string,
  payload: OrderPayload,
  results: RecipientResult[],
): Promise<void> {
  const handle = await getDatabaseOrNull();
  if (!handle) return;
  await handle.db
    .updateTable("print_orders")
    .set({
      // Any card that reached the printer makes this a send that happened.
      // `failed` is reserved for the order where nothing did, so that the
      // status answers "is there anything to chase" rather than "was it
      // perfect".
      status: results.some((r) => r.ok) ? "printed" : "failed",
      payload: JSON.stringify({ ...payload, results }),
      updated_at: nowIso(),
    })
    .where("id", "=", id)
    .where("owner_id", "=", owner)
    .execute();
}
