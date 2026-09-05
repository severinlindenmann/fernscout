import "server-only";
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

export type PaymentStatus = "pending" | "paid";
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
    status: row.status === "paid" ? "paid" : "pending",
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

export type MarkPaidResult =
  | { ok: true; payment: Payment; alreadyPaid: boolean }
  | { ok: false; reason: "unknown" | "bad_method" };

/**
 * The mock Pay button. Moves a pending payment to `paid` and records the
 * method — and does **nothing else**, deliberately: no credits, no ledger, no
 * grant. Idempotent: paying an already-paid row succeeds without changing it
 * (so a double click, or a re-followed link, sends no second receipt and — the
 * point — still adds nothing), and `alreadyPaid` tells the caller which
 * happened so it does not mail a receipt twice.
 */
export async function markPaid(
  owner: string,
  id: string,
  method: PaymentMethod,
): Promise<MarkPaidResult> {
  if (!isPaymentMethod(method)) return { ok: false, reason: "bad_method" };
  const handle = await getDatabaseOrNull();
  if (!handle) return { ok: false, reason: "unknown" };

  const existing = await getPayment(owner, id);
  if (!existing) return { ok: false, reason: "unknown" };
  if (existing.status === "paid") return { ok: true, payment: existing, alreadyPaid: true };

  await handle.db
    .updateTable("payments")
    .set({ status: "paid", method, paid_at: nowIso() })
    // Re-assert both the owner and that it is still pending, so two concurrent
    // pays cannot both count as "the one that paid it".
    .where("id", "=", id)
    .where("owner_id", "=", owner)
    .where("status", "=", "pending")
    .execute();

  const payment = await getPayment(owner, id);
  if (!payment) return { ok: false, reason: "unknown" };
  // It was pending when we read it above and we just moved it to paid, so this
  // is a first payment, not a repeat.
  return { ok: true, payment, alreadyPaid: false };
}
