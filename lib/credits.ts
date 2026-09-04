import "server-only";
import { isEnabled } from "./capabilities";
import { getDatabaseOrNull, newId, nowIso } from "./db";

/**
 * What a journal has left to spend on reaching its readers — B366.
 *
 * ## What costs a credit, and what does not
 *
 * **Reader-facing bulk costs.** One credit per email delivered by
 * `lib/digest/dayLetter.ts`, one per WhatsApp message delivered by
 * `lib/digest/dayWhatsapp.ts`. Those two are the only callers of `spend` that
 * should ever exist: they are the sends that fan out to everybody a journal
 * knows, and they are the ones that arrive on a card statement.
 *
 * **Transactional mail is free.** A login code, a deletion confirmation, an
 * approval notice, an invite, a purchase receipt — each goes to one person
 * about their own account, at their own request. Charging them would mean a
 * journal at zero credits could not sign its owner in, which turns an empty
 * balance into a lockout. If you are adding a mail path and wondering which
 * kind it is: if the recipient asked for this specific message, it is free.
 *
 * ## The two properties everything else is arranged around
 *
 * **1. Nothing reachable over HTTP may increase a balance.** `grant` is
 * exported for exactly one caller, `scripts/grant-credits.ts`, which needs a
 * shell on the server. There is deliberately no API route, no server action
 * and no form that grants — a credit card is downstream of this number, and a
 * grant path that a request can reach is a card that a request can spend.
 * `test/credits.test.ts` asserts that nothing under `app/` imports it, because
 * a rule stated in a comment is a rule until somebody is in a hurry.
 *
 * **2. A balance never goes below zero, under concurrency.** `spend` is one
 * conditional `UPDATE … SET balance = balance - :n WHERE owner_id = :u AND
 * balance >= :n`, and it is the *rows affected* that decides. Never a `SELECT`
 * followed by an `UPDATE`: two publish calls arriving together would each read
 * ten, each decide ten is enough for eight, and send sixteen. That statement
 * is atomic on both SQLite and Postgres, which is why it is the primitive here
 * rather than `SELECT … FOR UPDATE` (SQLite has none) or a `SUM()` over the
 * ledger (not conditionally insertable on either).
 *
 * ## All or nothing
 *
 * A send is charged once, for its whole recipient list, before the first
 * message leaves. Twenty-five recipients against ten credits refuses the whole
 * send rather than reaching fifteen of them: nobody gets a half-delivered
 * announcement, and the owner never has to work out which ten of twenty-five
 * heard from them. Recipients whose send then *fails* are refunded, because
 * that credit bought nothing.
 */

/** `grant` is one of these too, but it is deliberately not in the union a
 * send can pass — see `SpendReason`. */
export type LedgerReason = "grant" | "day_mail" | "day_whatsapp" | "refund";

/** What a *send* may charge for. Narrower than `LedgerReason` on purpose: it
 * is the type that makes `spend(owner, n, "grant")` not compile. */
export type SpendReason = "day_mail" | "day_whatsapp";

export type LedgerRow = {
  id: string;
  delta: number;
  reason: string;
  ref: string | null;
  note: string | null;
  createdAt: string;
};

/**
 * Is this instance charging for sends at all?
 *
 * **Server-only, and asked without a username on purpose** — the same shape as
 * `logging` and for a sharper reason (B257 is the precedent). Every other
 * capability is a server ceiling that a journal opts into, and a journal that
 * never mentions it has it off. Charging cannot work that way in either
 * direction: opt-in would mean the operator switches billing on and no journal
 * is actually charged until each one asks to be, and opt-*out* would mean a
 * journal can decline to be charged for sends that still arrive on the
 * operator's card statement. `resolveOne` lets a user's config narrow but
 * never widen, so passing a username here would hand every journal the second
 * one.
 *
 * With it off, `spend` succeeds without writing and `balanceOf` answers null,
 * so no caller needs a branch of its own and none can forget one — the
 * AGENTS.md rule that a disabled capability is *absent* rather than broken,
 * which is what keeps a fresh clone able to send letters.
 */
export function creditsEnabled(): boolean {
  return isEnabled("credits");
}

/**
 * What this journal has, or `null` when credits are switched off — which is
 * "there is no such number here", a different answer from zero and rendered
 * differently by `/[user]/me`.
 */
export async function balanceOf(owner: string): Promise<number | null> {
  if (!creditsEnabled()) return null;
  const handle = await getDatabaseOrNull();
  if (!handle) return 0;
  const row = await handle.db
    .selectFrom("credits")
    .select("balance")
    .where("owner_id", "=", owner)
    .executeTakeFirst();
  // No row is a balance of zero. Every journal starts that way and nothing
  // back-fills; the row appears at the first grant.
  return row ? Number(row.balance) : 0;
}

/**
 * Take `n` credits, or take none and say so.
 *
 * `false` means the balance would not cover it — the caller must send nothing.
 * It is not an error and does not throw; a journal running out of credits is
 * an ordinary Tuesday, and the API routes turn it into a sentence.
 *
 * `n <= 0` is a no-op that succeeds: a send with no recipients costs nothing
 * and should not be refused.
 */
export async function spend(
  owner: string,
  n: number,
  reason: SpendReason,
  ref: string,
): Promise<boolean> {
  if (!creditsEnabled()) return true;
  if (!Number.isInteger(n)) throw new Error(`credits: refusing a fractional spend of ${n}`);
  if (n <= 0) return true;

  const handle = await getDatabaseOrNull();
  // Credits are on and there is nowhere to record them. Refusing is the only
  // safe answer: succeeding here would send to everybody, for free, with no
  // record — which is the exact outcome this module exists to prevent.
  if (!handle) return false;

  return handle.db.transaction().execute(async (trx) => {
    const result = await trx
      .updateTable("credits")
      .set((eb) => ({ balance: eb("balance", "-", n), updated_at: nowIso() }))
      .where("owner_id", "=", owner)
      // The whole guard, in one statement. A missing row affects nothing and
      // is therefore refused, the same answer as a row holding too little.
      .where("balance", ">=", n)
      .executeTakeFirst();

    // `numUpdatedRows` is a bigint on both dialects, and this file compiles
    // at ES2017 where a `0n` literal is a syntax error — hence `Number()`
    // rather than the comparison you would write anywhere else. A bigint is
    // never `===` a number, so getting this wrong fails closed but silently.
    if (Number(result.numUpdatedRows ?? 0) === 0) return false;

    await trx
      .insertInto("credit_ledger")
      .values({
        id: newId(),
        owner_id: owner,
        delta: -n,
        reason,
        ref,
        note: null,
        created_at: nowIso(),
      })
      .execute();
    return true;
  });
}

/**
 * Give back credits for sends that did not happen.
 *
 * Only ever for the failures a send already counted per recipient — never a
 * blanket reversal, because a letter that was delivered is spent whatever
 * goes wrong afterwards. Unconditional: it cannot fail for want of balance,
 * and refusing it would strand somebody's credits over a transient SMTP
 * error.
 */
export async function refund(owner: string, n: number, ref: string): Promise<void> {
  if (!creditsEnabled()) return;
  if (n <= 0) return;
  const handle = await getDatabaseOrNull();
  if (!handle) return;

  await handle.db.transaction().execute(async (trx) => {
    await trx
      .updateTable("credits")
      .set((eb) => ({ balance: eb("balance", "+", n), updated_at: nowIso() }))
      .where("owner_id", "=", owner)
      .execute();
    await trx
      .insertInto("credit_ledger")
      .values({
        id: newId(),
        owner_id: owner,
        delta: n,
        reason: "refund",
        ref,
        note: null,
        created_at: nowIso(),
      })
      .execute();
  });
}

/**
 * Put credits into a journal. **Operator only.**
 *
 * The one function in this module that increases a balance, and the reason
 * property 1 above is stated as loudly as it is. Its only caller is
 * `scripts/grant-credits.ts`, run by somebody with a shell on the server after
 * money has actually arrived. It must never gain an HTTP caller: B368's "buy
 * credits" button mails information and grants nothing, precisely so that this
 * stays true.
 *
 * Ignores the capability switch — an operator granting credits to a journal
 * before switching charging on is the ordinary order of operations, and a
 * grant that silently did nothing would be found out much later.
 */
export async function grant(owner: string, n: number, note?: string): Promise<void> {
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`credits: a grant must be a positive whole number, got ${n}`);
  }
  const handle = await getDatabaseOrNull();
  if (!handle) throw new Error("credits: no database is configured, so there is nowhere to grant");

  await handle.db.transaction().execute(async (trx) => {
    // The row appears here or nowhere. Written as insert-then-fall-back rather
    // than an upsert because `onConflict` differs enough between the two
    // dialects to be worth not relying on for a path run by hand once a month.
    const existing = await trx
      .selectFrom("credits")
      .select("owner_id")
      .where("owner_id", "=", owner)
      .executeTakeFirst();

    if (existing) {
      await trx
        .updateTable("credits")
        .set((eb) => ({ balance: eb("balance", "+", n), updated_at: nowIso() }))
        .where("owner_id", "=", owner)
        .execute();
    } else {
      await trx
        .insertInto("credits")
        .values({ owner_id: owner, balance: n, updated_at: nowIso() })
        .execute();
    }

    await trx
      .insertInto("credit_ledger")
      .values({
        id: newId(),
        owner_id: owner,
        delta: n,
        reason: "grant",
        ref: null,
        note: note ?? null,
        created_at: nowIso(),
      })
      .execute();
  });
}

/** Newest first. For `npm run credits -- list`; there is no reader-facing
 * view of this table and adding one is a decision, not a convenience. */
export async function ledgerFor(owner: string, limit = 50): Promise<LedgerRow[]> {
  const handle = await getDatabaseOrNull();
  if (!handle) return [];
  const rows = await handle.db
    .selectFrom("credit_ledger")
    .select(["id", "delta", "reason", "ref", "note", "created_at"])
    .where("owner_id", "=", owner)
    .orderBy("created_at", "desc")
    .limit(limit)
    .execute();
  return rows.map((r) => ({
    id: r.id,
    delta: Number(r.delta),
    reason: r.reason,
    ref: r.ref,
    note: r.note,
    createdAt: r.created_at,
  }));
}

/**
 * Does the stored balance still equal the ledger that produced it?
 *
 * `credits.balance` is authoritative — it has to be, to be the atomic guard —
 * so the ledger cannot correct it. What this can do is notice that the two
 * have parted company, which means a bug rather than a discrepancy to
 * reconcile. `npm run credits -- audit` is the whole point of keeping both.
 */
export async function auditOwner(
  owner: string,
): Promise<{ balance: number; ledger: number; ok: boolean }> {
  const handle = await getDatabaseOrNull();
  if (!handle) return { balance: 0, ledger: 0, ok: true };
  const [row, sum] = await Promise.all([
    handle.db
      .selectFrom("credits")
      .select("balance")
      .where("owner_id", "=", owner)
      .executeTakeFirst(),
    handle.db
      .selectFrom("credit_ledger")
      .select((eb) => eb.fn.sum<number>("delta").as("total"))
      .where("owner_id", "=", owner)
      .executeTakeFirst(),
  ]);
  const balance = row ? Number(row.balance) : 0;
  // `sum` is `numeric` on Postgres, which `pg` returns as a string, and null
  // when there are no rows at all.
  const ledger = Number(sum?.total ?? 0);
  return { balance, ledger, ok: balance === ledger };
}
