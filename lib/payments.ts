import "server-only";
import crypto from "node:crypto";
import { getDatabaseOrNull, newId, nowIso } from "./db";

/**
 * The mock payment ledger — B405.
 *
 * A "buy credits" purchase becomes a row here so the owner can leave the
 * checkout and come back to the same link later and see where it stands. It is
 * deliberately separate from `lib/credits.ts`: **nothing in this file touches a
 * balance or the credit ledger.** Marking a payment `paid` is the mock Pay
 * button being pressed in a preview; it never adds credits. When a real
 * provider is wired in, a verified server-to-server webhook will read a `paid`
 * row and call `grant()` — the browser never will, which is why paying grants
 * nothing today.
 *
 * It imports the pricing table (`lib/credits/pricing.ts`), which is plain data,
 * and never the server-only `lib/credits.ts` — so there is no path from a
 * payment to a `spend`/`grant`.
 */

export type PaymentStatus = "pending" | "requested" | "paid";
/**
 * How a purchase was settled. `admin` is not a way to pay — it is the operator
 * granting credits by hand from `/admin` (B746), recorded as a zero-franc
 * transaction so it lands in the same queue, spends the same single-use
 * token, and is reconciled from the same table as a real purchase.
 */
export type PaymentMethod = "twint" | "card" | "admin";

export type Payment = {
  id: string;
  owner: string;
  credits: number;
  amountRappen: number;
  status: PaymentStatus;
  method: PaymentMethod | null;
  createdAt: string;
  paidAt: string | null;
  /** When the buyer pressed Pay and the operator's approval was asked for.
   *  Null on a `pending` row, which nobody is waiting on. B774 reads it to say
   *  how long a queued purchase has been sitting there. */
  requestedAt: string | null;
  /** The latest Stripe checkout session this row is being paid through, so a
   *  second Pay reuses it rather than opening a rival — B831. */
  providerRef: string | null;
};

const METHODS: readonly PaymentMethod[] = ["twint", "card", "admin"];

/** What a buyer may choose. `admin` is deliberately absent: it is the
 *  operator's own method, and a request that could name it would be a way to
 *  file a zero-franc purchase for any number of credits. `/api/v1/.../pay`
 *  validates against this, `/admin` sets `admin` itself. */
const BUYER_METHODS: readonly PaymentMethod[] = ["twint", "card"];
export function isBuyerMethod(v: unknown): v is PaymentMethod {
  return typeof v === "string" && (BUYER_METHODS as readonly string[]).includes(v);
}
function isPaymentMethod(v: unknown): v is PaymentMethod {
  return typeof v === "string" && (METHODS as readonly string[]).includes(v);
}

function toPayment(row: {
  id: string;
  owner_id: string;
  credits: number;
  amount_rappen: number;
  status: string;
  method: string | null;
  created_at: string;
  paid_at: string | null;
  // Optional because two callers build the row literal themselves rather than
  // reading it back, and neither has stamped it at that point.
  requested_at?: string | null;
  provider_ref?: string | null;
}): Payment {
  return {
    id: row.id,
    owner: row.owner_id,
    credits: Number(row.credits),
    amountRappen: Number(row.amount_rappen),
    status: row.status === "paid" ? "paid" : row.status === "requested" ? "requested" : "pending",
    method: isPaymentMethod(row.method) ? row.method : null,
    createdAt: row.created_at,
    paidAt: row.paid_at,
    requestedAt: row.requested_at ?? null,
    providerRef: row.provider_ref ?? null,
  };
}

/**
 * Start a purchase.
 *
 * **The caller passes both the amount and the price, and the price must be
 * `priceRappen(credits)`** — B854 replaced the fixed tier table with a
 * function, so the guarantee moved rather than went away: the route computes
 * the price from the amount it validated, and nothing a request body carries
 * reaches either field. Passing a price a request supplied would be a way to
 * buy five hundred credits for a franc.
 *
 * The id is a random token and is the whole link: unguessable, and worth
 * nothing beyond viewing and mock-paying this one transaction (which adds no
 * credits).
 */
export async function createPayment(
  owner: string,
  credits: number,
  amountRappen: number,
): Promise<Payment | null> {
  const handle = await getDatabaseOrNull();
  if (!handle) return null;
  const row = {
    id: newId(),
    owner_id: owner,
    credits,
    amount_rappen: amountRappen,
    status: "pending",
    method: null as string | null,
    created_at: nowIso(),
    paid_at: null as string | null,
  };
  await handle.db.insertInto("payments").values(row).execute();
  return toPayment(row);
}

/**
 * One payment, and only if it belongs to `owner`.
 *
 * The owner scoping is the tenant boundary made a query: `/<userA>/payment/<id>`
 * where the id is `userB`'s resolves to `null` here, the same answer as an id
 * that never existed — no cross-journal read, no existence oracle.
 */
/**
 * Remember which Stripe checkout session a payment is being paid through — B831.
 *
 * The pay route calls this after it creates (or reuses) a session, so the next
 * press can find an open session rather than opening a second payable one.
 * Owner-scoped like every write here; a no-op if the row is not this owner's.
 */
export async function attachCheckoutSession(owner: string, id: string, sessionId: string): Promise<void> {
  const handle = await getDatabaseOrNull();
  if (!handle) return;
  await handle.db
    .updateTable("payments")
    .set({ provider_ref: sessionId })
    .where("id", "=", id)
    .where("owner_id", "=", owner)
    .execute();
}

/**
 * A journal's recent transactions, newest first — for the history under the
 * Payment card (B413). Owner-facing only; the caller gates on ownership.
 */
export async function listPayments(owner: string, limit = 8): Promise<Payment[]> {
  const handle = await getDatabaseOrNull();
  if (!handle) return [];
  const rows = await handle.db
    .selectFrom("payments")
    .selectAll()
    .where("owner_id", "=", owner)
    .orderBy("created_at", "desc")
    .limit(limit)
    .execute();
  return rows.map(toPayment);
}

export async function getPayment(owner: string, id: string): Promise<Payment | null> {
  const handle = await getDatabaseOrNull();
  if (!handle) return null;
  const row = await handle.db
    .selectFrom("payments")
    .selectAll()
    .where("id", "=", id)
    .where("owner_id", "=", owner)
    .executeTakeFirst();
  return row ? toPayment(row) : null;
}

/**
 * The operator grants credits by hand — B746.
 *
 * **This grants nothing.** It files a zero-franc transaction already in the
 * `requested` state and mints the same single-use approval token an ordinary
 * purchase mints; the credits land only when the mailed link is opened and
 * `claimApproval` + `grant` run in the approve route, which stays the one and
 * only HTTP path that raises a balance. `test/credits.test.ts` is unchanged
 * and `GRANT_ALLOWED` does not widen, which is the whole reason this is shaped
 * as a payment rather than as a second grant route.
 *
 * **Why `credits` may be any number here, when `createPayment` takes only a
 * fixed tier.** The tier exists so a *buyer's* request cannot conjure a
 * cheaper price or more credits. The caller here is the instance admin
 * (`lib/admin.ts`), who is the person the approval mail goes to and the
 * person who reconciles the money — there is no price to undercut, because
 * there is no price. The protection that matters is unchanged: the admin
 * cannot grant by asking, only by opening what was mailed to the operator.
 */
export async function createAdminGrant(
  owner: string,
  credits: number,
): Promise<{ payment: Payment; token: string } | null> {
  if (!Number.isInteger(credits) || credits <= 0) return null;
  const handle = await getDatabaseOrNull();
  if (!handle) return null;
  const token = crypto.randomBytes(32).toString("base64url");
  const row = {
    id: newId(),
    owner_id: owner,
    credits,
    amount_rappen: 0,
    status: "requested",
    method: "admin" as string | null,
    created_at: nowIso(),
    paid_at: null as string | null,
  };
  await handle.db
    .insertInto("payments")
    .values({ ...row, requested_at: nowIso(), approve_token_hash: hashToken(token) })
    .execute();
  return { payment: toPayment(row), token };
}

/**
 * Every purchase still waiting for the operator to approve it — B774.
 *
 * Instance-wide, unlike `listPayments`, which is scoped to one journal because
 * it feeds that journal's own page. This one exists for `/admin`, where the
 * question is "who is waiting on me" and the answer spans every journal.
 *
 * `requested` only. A `pending` row is a checkout page somebody opened and may
 * simply have closed; it is not a queue, and listing it would turn idle
 * curiosity into a to-do. `paid` is done.
 *
 * **The approval token is not selected and must never be.** It is mailed to
 * the operator and spent once; a page that rendered it would put a
 * balance-raising credential into a browser, a screenshot and a scrollback,
 * which is the whole thing B425 avoided by using a mailbox.
 */
export async function paymentsAwaiting(): Promise<Payment[]> {
  const handle = await getDatabaseOrNull();
  if (!handle) return [];
  const rows = await handle.db
    .selectFrom("payments")
    .selectAll()
    .where("status", "=", "requested")
    // Only rows a token was actually minted and mailed for — B833. A Stripe
    // row is `requested` too, but it is settled by webhook and has no token,
    // so listing it here would grow the queue without bound under a sentence
    // ("mailed to you with a link that approves it") that is false for it.
    .where("approve_token_hash", "is not", null)
    .orderBy("requested_at", "asc")
    .execute();
  return rows.map(toPayment);
}

/**
 * Purchases settled in a period, newest first — B774, for the takings on
 * `/admin`.
 *
 * `paid_at` rather than `created_at`: a checkout opened in March and approved
 * in April is April's money, and reconciling against a card statement is the
 * only reason this list exists.
 */
export async function paymentsPaidSince(since: string): Promise<Payment[]> {
  const handle = await getDatabaseOrNull();
  if (!handle) return [];
  const rows = await handle.db
    .selectFrom("payments")
    .selectAll()
    .where("status", "=", "paid")
    .where("paid_at", ">=", since)
    .orderBy("paid_at", "desc")
    .execute();
  return rows.map(toPayment);
}

/**
 * What a list of purchases came to, in rappen.
 *
 * **An admin grant is excluded, and that is the point of this function
 * existing rather than a `reduce` at the call site.** `createAdminGrant` files
 * a payment with `amount_rappen: 0` and `method: "admin"` (B746) so that it
 * rides the same approval machinery. Summing it as takings would report income
 * nobody paid — zero today, and a real number the moment anybody gives an
 * admin grant a nominal price.
 */
export function takings(payments: Payment[]): number {
  return payments
    .filter((payment) => payment.method !== "admin")
    .reduce((total, payment) => total + payment.amountRappen, 0);
}

export type SubmitResult =
  | { ok: true; payment: Payment; token: string; alreadyRequested: boolean }
  | { ok: false; reason: "unknown" | "bad_method" };

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * The buyer presses Pay — B425. A pending payment becomes a **request**: it
 * records the method, stamps `requested_at`, and mints a single-use approval
 * token whose hash it stores (the raw token is returned once, for the operator
 * email). It does **not** grant anything; approval does that.
 *
 * Idempotent on an already-requested row: it does not mint a second token or
 * move the state, and `alreadyRequested` tells the caller not to email the
 * operator again. A paid row is refused as `unknown` (there is nothing to
 * request).
 */
export async function submitRequest(
  owner: string,
  id: string,
  method: PaymentMethod | null,
): Promise<SubmitResult> {
  // Null is the Stripe path (B792): the buyer has not chosen yet — Stripe's own
  // page is where they choose — and the webhook records what they actually
  // used. A *named* method is still checked, so a request cannot smuggle in
  // "admin".
  if (method !== null && !isPaymentMethod(method)) return { ok: false, reason: "bad_method" };
  const handle = await getDatabaseOrNull();
  if (!handle) return { ok: false, reason: "unknown" };

  const existing = await getPayment(owner, id);
  if (!existing) return { ok: false, reason: "unknown" };
  if (existing.status === "paid") return { ok: false, reason: "unknown" };
  if (existing.status === "requested") {
    // Already in the queue; do not re-mail or re-token.
    return { ok: true, payment: existing, token: "", alreadyRequested: true };
  }

  // A token is minted only on the manual approval path — B833. The Stripe path
  // (method null) is settled by a signed webhook, never by this token, so
  // minting one there put a hash on the row that nothing could ever spend and
  // parked the row in the operator's /admin queue under a sentence promising a
  // mail that was never sent. No method, no token, no queue entry.
  const manual = method !== null;
  const token = manual ? crypto.randomBytes(32).toString("base64url") : "";
  await handle.db
    .updateTable("payments")
    .set({
      status: "requested",
      method,
      requested_at: nowIso(),
      approve_token_hash: manual ? hashToken(token) : null,
    })
    .where("id", "=", id)
    .where("owner_id", "=", owner)
    .where("status", "=", "pending")
    .execute();

  const payment = await getPayment(owner, id);
  if (!payment || payment.status !== "requested") return { ok: false, reason: "unknown" };
  return { ok: true, payment, token, alreadyRequested: false };
}

/**
 * Does this token match a request still awaiting approval? A read for the
 * operator's confirm page — it does not consume anything, so the page can show
 * "approve N credits?" before the operator presses the button.
 */
export async function approvableByToken(
  owner: string,
  id: string,
  token: string,
): Promise<Payment | null> {
  const payment = await getPayment(owner, id);
  if (!payment) return null;
  if (payment.status !== "requested") return null;
  const handle = await getDatabaseOrNull();
  if (!handle) return null;
  const row = await handle.db
    .selectFrom("payments")
    .select("approve_token_hash")
    .where("id", "=", id)
    .where("owner_id", "=", owner)
    .executeTakeFirst();
  if (!row?.approve_token_hash) return null;
  // Constant-time compare of the two hex digests.
  const a = Buffer.from(row.approve_token_hash);
  const b = Buffer.from(hashToken(token));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  return payment;
}

export type ClaimResult =
  | { ok: true; credits: number }
  | { ok: false; reason: "unknown" | "not_requested" | "bad_token" };

/**
 * The atomic heart of approval — B425. In one conditional UPDATE it flips a
 * request to paid, marks it granted, clears the token and stamps `paid_at`,
 * **only** when the row is still `requested`, still ungranted, and the token
 * matches. Rows-affected is the whole answer: exactly one caller can ever
 * claim a given request, so the grant the route does next runs at most once,
 * however many times the link is followed or two operators race it.
 *
 * It returns the credit count for the route to `grant` — deliberately, so the
 * one `grant` call stays in the approve route and the "only that route imports
 * grant" invariant remains true and checkable. It never grants here.
 */
export async function claimApproval(
  owner: string,
  id: string,
  token: string,
): Promise<ClaimResult> {
  const handle = await getDatabaseOrNull();
  if (!handle) return { ok: false, reason: "unknown" };
  const payment = await getPayment(owner, id);
  if (!payment) return { ok: false, reason: "unknown" };
  if (payment.status !== "requested") return { ok: false, reason: "not_requested" };

  const result = await handle.db
    .updateTable("payments")
    .set({ status: "paid", granted: 1, paid_at: nowIso(), approve_token_hash: null })
    .where("id", "=", id)
    .where("owner_id", "=", owner)
    .where("status", "=", "requested")
    .where("granted", "=", 0)
    .where("approve_token_hash", "=", hashToken(token))
    .executeTakeFirst();

  if (Number(result.numUpdatedRows ?? 0) === 0) {
    // Either the token was wrong or somebody claimed it first. Both mean "not
    // yours to grant"; the token being wrong is the common case.
    return { ok: false, reason: "bad_token" };
  }
  return { ok: true, credits: payment.credits };
}
export type ProviderClaimResult =
  | { ok: true; credits: number }
  | { ok: false; reason: "unknown" | "not_requested" | "amount_mismatch" };

/**
 * A payment provider says a purchase was paid — B792, and the same atomic
 * shape as `claimApproval` above, for the same reason.
 *
 * The webhook has already verified Stripe's signature; this is the second
 * half — that the row is ours, is still awaiting settlement, and is for the
 * amount that was actually charged. One conditional UPDATE decides, and
 * rows-affected is the whole answer: Stripe retries a webhook it did not get a
 * 2xx for, and delivers at least once rather than exactly once, so the claim —
 * not the caller's care — is what makes a repeat free.
 *
 * `amountRappen` is re-checked against our own row rather than trusted: the
 * session was created by this server from a fixed tier, and a session whose
 * total does not match the row it names is not a purchase of that row.
 *
 * It returns the credit count for the route to `grant`, deliberately, so the
 * single `grant` call stays in the route and the "only sanctioned routes
 * import grant" invariant stays checkable. It never grants here.
 */
export async function claimProviderPayment(
  owner: string,
  id: string,
  amountRappen: number,
  method: PaymentMethod | null,
): Promise<ProviderClaimResult> {
  const handle = await getDatabaseOrNull();
  if (!handle) return { ok: false, reason: "unknown" };
  const payment = await getPayment(owner, id);
  if (!payment) return { ok: false, reason: "unknown" };
  if (payment.amountRappen !== amountRappen) return { ok: false, reason: "amount_mismatch" };
  if (payment.status !== "requested") return { ok: false, reason: "not_requested" };

  const result = await handle.db
    .updateTable("payments")
    .set({
      status: "paid",
      granted: 1,
      paid_at: nowIso(),
      // The approval token this row was minted with was never mailed to
      // anybody on this path; clearing it means a settled purchase leaves no
      // second way to grant it.
      approve_token_hash: null,
      ...(method ? { method } : {}),
    })
    .where("id", "=", id)
    .where("owner_id", "=", owner)
    .where("status", "=", "requested")
    .where("granted", "=", 0)
    .executeTakeFirst();

  if (Number(result.numUpdatedRows ?? 0) === 0) {
    // Somebody claimed it first — a retried webhook, almost always. Not an
    // error, and the caller answers 200 so Stripe stops retrying.
    return { ok: false, reason: "not_requested" };
  }
  return { ok: true, credits: payment.credits };
}
