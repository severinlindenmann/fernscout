import "server-only";
import crypto from "node:crypto";
import { getDatabaseOrNull, newId, nowIso } from "./db";
import { type CreditTier } from "./credits/pricing";

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
export type PaymentMethod = "twint" | "card";

export type Payment = {
  id: string;
  owner: string;
  credits: number;
  amountRappen: number;
  status: PaymentStatus;
  method: PaymentMethod | null;
  createdAt: string;
  paidAt: string | null;
};

const METHODS: readonly PaymentMethod[] = ["twint", "card"];
export function isPaymentMethod(v: unknown): v is PaymentMethod {
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
  };
}

/**
 * Start a purchase. Amount and credits come from the tier — a fixed table —
 * never from anything a caller supplied, so no request can conjure a cheaper
 * price or more credits.
 *
 * The id is a random token and is the whole link: unguessable, and worth
 * nothing beyond viewing and mock-paying this one transaction (which adds no
 * credits).
 */
export async function createPayment(owner: string, tier: CreditTier): Promise<Payment | null> {
  const handle = await getDatabaseOrNull();
  if (!handle) return null;
  const row = {
    id: newId(),
    owner_id: owner,
    credits: tier.credits,
    amount_rappen: tier.priceRappen,
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
  method: PaymentMethod,
): Promise<SubmitResult> {
  if (!isPaymentMethod(method)) return { ok: false, reason: "bad_method" };
  const handle = await getDatabaseOrNull();
  if (!handle) return { ok: false, reason: "unknown" };

  const existing = await getPayment(owner, id);
  if (!existing) return { ok: false, reason: "unknown" };
  if (existing.status === "paid") return { ok: false, reason: "unknown" };
  if (existing.status === "requested") {
    // Already in the queue; do not re-mail or re-token.
    return { ok: true, payment: existing, token: "", alreadyRequested: true };
  }

  const token = crypto.randomBytes(32).toString("base64url");
  await handle.db
    .updateTable("payments")
    .set({
      status: "requested",
      method,
      requested_at: nowIso(),
      approve_token_hash: hashToken(token),
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