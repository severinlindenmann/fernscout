import "server-only";
import { isEnabled } from "./capabilities";
// The unit and its arithmetic live beside `pricing.ts` and not here, because
// a balance is rendered in the browser and this file is `server-only` — B987.
import { creditsFromUnits, toUnits } from "./credits/format";
import { getDatabaseOrNull, newId, nowIso } from "./db";

/**
 * What a journal has left to spend on reaching its readers — B366.
 *
 * ## What costs a credit, and what does not
 *
 * **Reader-facing bulk costs.** One credit per email delivered by
 * `lib/digest/dayLetter.ts`, one per WhatsApp message delivered by
 * `lib/digest/dayWhatsapp.ts`, and `POSTCARD_CREDITS` per printed card posted
 * by `lib/postcard/send.ts` (B434). Those three are the only callers of
 * `spend` that should ever exist: they are the sends that fan out to people a
 * journal knows, and they are the ones that arrive on a card statement.
 *
 * The postcard is the odd one of the three and the reason to be careful: it
 * costs real money at a printer rather than fractions of a cent at an SMTP
 * relay, and it is the only one a person presses a button for. See
 * `lib/postcard/send.ts` for why the claim comes before the spend.
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
 * **1. A balance only ever increases where the amount is fixed and the event
 * is one this server already verified.** `grant` is exported for three
 * callers, and `test/credits.test.ts` asserts exactly that allowlist.
 * `scripts/grant-credits.ts` needs a shell on the server, after money has
 * actually arrived. `POST /api/v1/journals` (B688) grants `SIGNUP_CREDIT_GRANT`
 * exactly once, only after `createJournal` has written a journal to disk under
 * a freshly spent signup token — the same one-journal-per-token guarantee
 * `test/signup-token.test.ts` already checks. `POST /api/webhooks/stripe`
 * (B792) grants a purchase's credits once Stripe's signed webhook confirms the
 * payment, behind a single conditional claim that a replay or race cannot win
 * twice. In all three the amount is fixed or measured, never named by a
 * caller. Nothing else grants: no form, no other route, no amount a request
 * gets to choose — a rule stated in a comment is a rule until somebody is in a
 * hurry, which is why the test holds it too.
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
type LedgerReason =
  | "grant"
  | "day_mail"
  | "day_whatsapp"
  | "digest"
  | "postcard"
  | "photobook"
  | "photobook_print"
  | "storage"
  | "helper"
  | "transcription"
  | "refund"
  /** Credits taken back because the money that bought them was returned —
   * B878. A negative delta that is not a spend, which is why
   * `spentByReason` excludes it by name. */
  | "purchase_refund";

/**
 * What a *send* may charge for. Narrower than `LedgerReason` on purpose: it is
 * the type that makes `spend(owner, n, "grant")` not compile.
 *
 * `digest` is its own value rather than reusing `day_mail`, even though both
 * are one credit per email through the same transport. The ledger is the
 * audit trail an operator reconciles a card statement against, and "forty
 * credits went on mail last week" is not an answer to "was that one busy trip
 * or four weekly digests" — a distinction that costs one string here and
 * cannot be recovered later from rows that never carried it.
 */
export type SpendReason =
  | "day_mail"
  | "day_whatsapp"
  | "digest"
  | "postcard"
  | "photobook"
  /** Turning a built book into a posted one — B434's photobook counterpart.
   * Its own value rather than reusing `photobook`, for the reason `digest`
   * is its own value above: the ledger is what an operator reconciles a
   * supplier bill against, and rendering a PDF and printing a physical
   * object are two different suppliers — one a model call, the other a
   * Gelato invoice — so "photobook" spend alone cannot say which of the two
   * a month's credits went on. */
  | "photobook_print"
  /** More disk, bought once and for good — B661. The one spend that buys the
   * journal something rather than reaching somebody, and the reason it is
   * counted rather than merely logged: `purchasedBytes` in
   * `lib/storageQuota.ts` reads these rows back as the extension itself. */
  | "storage"
  /** One write-up by the helper's model — B684. The first spend that buys
   * neither a delivery nor disk but a single request to a provider, and the
   * fourth caller of `spend` after the three named above. It is charged
   * *before* the call and refunded when the call fails, because a credit that
   * bought nothing is not spent; `lib/idempotency.ts` is what stops a retry
   * charging twice. */
  | "helper"
  /** One recording turned into text — B686. Its own value rather than
   * `helper` for the reason `digest` is its own value above: the ledger is
   * what an operator reconciles a bill against, and two suppliers are two
   * bills. Charged per *started* minute, before the call, refunded when the
   * call fails. */
  | "transcription";

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
 *
 * In credits, which since B987 may carry a fraction: the stored number is
 * hundredths and this is where it stops being one.
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
  return row ? creditsFromUnits(Number(row.balance)) : 0;
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
  // Hundredths since B987 — a spend of 0.01 is the smallest real charge, and
  // anything finer is a pricing bug rather than a discount.
  const units = toUnits(n, "a spend");
  if (units <= 0) return true;

  const handle = await getDatabaseOrNull();
  // Credits are on and there is nowhere to record them. Refusing is the only
  // safe answer: succeeding here would send to everybody, for free, with no
  // record — which is the exact outcome this module exists to prevent.
  if (!handle) return false;

  return handle.db.transaction().execute(async (trx) => {
    const result = await trx
      .updateTable("credits")
      .set((eb) => ({ balance: eb("balance", "-", units), updated_at: nowIso() }))
      .where("owner_id", "=", owner)
      // The whole guard, in one statement. A missing row affects nothing and
      // is therefore refused, the same answer as a row holding too little.
      .where("balance", ">=", units)
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
        delta: -units,
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
  const units = toUnits(n, "a refund");
  if (units <= 0) return;
  const handle = await getDatabaseOrNull();
  if (!handle) return;

  await handle.db.transaction().execute(async (trx) => {
    await trx
      .updateTable("credits")
      .set((eb) => ({ balance: eb("balance", "+", units), updated_at: nowIso() }))
      .where("owner_id", "=", owner)
      .execute();
    await trx
      .insertInto("credit_ledger")
      .values({
        id: newId(),
        owner_id: owner,
        delta: units,
        reason: "refund",
        ref,
        note: null,
        created_at: nowIso(),
      })
      .execute();
  });
}

/**
 * Take credits back off a balance because the purchase was refunded — B878.
 *
 * **Floored at zero, and that is a decision rather than a limitation.** A
 * journal that bought a hundred credits, spent sixty and asked for its money
 * back has forty to give: the sixty are gone into letters that were delivered
 * and models that answered, and there is no way to un-send them. A negative
 * balance would be the alternative, and it would put `spend`'s one guard —
 * `balance >= n` — in charge of a state it was never written for, on every
 * send in the system, to express a debt of sixty credits that no route can
 * collect. So it takes what is there, records what it took, and returns the
 * shortfall for the operator to read; a person who was refunded more than
 * they had left is a conversation, not a database state.
 *
 * Property 2 is kept the way `spend` keeps it: the deduction carries its own
 * `balance >= taken` guard, so a spend landing between the read and the write
 * makes the update affect nothing rather than push the balance under. When
 * that happens it re-reads and tries again — a handful of times, because the
 * loop is bounded by the balance falling, and a balance cannot fall forever.
 *
 * Returns what was actually taken. The caller has already moved real money and
 * cannot be failed here.
 */
export async function clawBack(owner: string, n: number, ref: string): Promise<number> {
  if (!creditsEnabled()) return 0;
  if (!Number.isInteger(n) || n <= 0) return 0;
  // A purchase is always a whole number of credits, so the guard above stands;
  // the *balance* it is compared against is hundredths since B987, so the
  // comparison has to happen down there rather than up here.
  const wanted = toUnits(n, "a claw-back");
  const handle = await getDatabaseOrNull();
  if (!handle) return 0;

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const row = await handle.db
      .selectFrom("credits")
      .select("balance")
      .where("owner_id", "=", owner)
      .executeTakeFirst();
    const taken = Math.min(wanted, Number(row?.balance ?? 0));
    if (taken <= 0) return 0;

    const done = await handle.db.transaction().execute(async (trx) => {
      const result = await trx
        .updateTable("credits")
        .set((eb) => ({ balance: eb("balance", "-", taken), updated_at: nowIso() }))
        .where("owner_id", "=", owner)
        .where("balance", ">=", taken)
        .executeTakeFirst();
      if (Number(result.numUpdatedRows ?? 0) === 0) return false;
      await trx
        .insertInto("credit_ledger")
        .values({
          id: newId(),
          owner_id: owner,
          delta: -taken,
          reason: "purchase_refund" satisfies LedgerReason,
          ref,
          note: null,
          created_at: nowIso(),
        })
        .execute();
      return true;
    });
    if (done) return creditsFromUnits(taken);
  }

  // Five reads in a row each overtaken by a spend. Vanishingly unlikely, and
  // the honest answer is that nothing was taken — never a deduction the guard
  // did not agree to.
  console.warn(`[credits] could not claw back ${n} from ${owner} for ${ref}; balance kept moving`);
  return 0;
}

/** The first grant a new journal ever sees — B688, plan §6's "a free grant on
 * signup". Fixed rather than configurable: a number a request could name
 * would be property 1's whole exception swallowed by its own loophole.
 *
 * **Ten, and the number is chosen against `POSTCARD_CREDITS` rather than
 * picked for generosity.** Signing up is self-service — an email address and a
 * code, five an hour per IP — so this grant is mintable by anyone willing to
 * hold a throwaway inbox. That is fine while it only buys things this server
 * computes: ten days written, or a hundred photographs captioned, or fifty
 * minutes of speech. It stops being fine the moment it reaches something a
 * printer invoices the operator for, because then a signup is a way to spend
 * somebody else's money. A posted postcard is fifteen credits and about two
 * euros of real cost; a photobook is ninety and up.
 *
 * So the rule is: **the signup grant stays strictly below the cheapest spend
 * that leaves the building.** `test/credits.test.ts` asserts it, because this
 * is exactly the number somebody raises to be welcoming without noticing what
 * it unlocks. Raising it means either finding another way to keep granted
 * credits away from the printers, or accepting the invoice. */
export const SIGNUP_CREDIT_GRANT = 10;

/**
 * Put credits into a journal. **Operator only, or the signup route.**
 *
 * The one function in this module that increases a balance, and the reason
 * property 1 above is stated as loudly as it is. `scripts/grant-credits.ts`
 * is run by somebody with a shell on the server after money has actually
 * arrived. `POST /api/v1/journals` is the one other caller (B688), and it may
 * only ever pass `SIGNUP_CREDIT_GRANT` and only once a journal exists — see
 * property 1. A third caller must not appear casually: B368's "buy credits"
 * button mails information and grants nothing, precisely so that this stays
 * narrow.
 *
 * Ignores the capability switch — an operator granting credits to a journal
 * before switching charging on is the ordinary order of operations, and a
 * grant that silently did nothing would be found out much later.
 */
export async function grant(owner: string, n: number, note?: string): Promise<void> {
  // Still whole credits, and deliberately: everything that grants is a fixed
  // amount or a purchase somebody made in whole credits (property 1 above),
  // and a fractional grant would be a sign that something a caller controls
  // had reached this function.
  if (!Number.isInteger(n) || n <= 0) {
    throw new Error(`credits: a grant must be a positive whole number, got ${n}`);
  }
  const units = toUnits(n, "a grant");
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
        .set((eb) => ({ balance: eb("balance", "+", units), updated_at: nowIso() }))
        .where("owner_id", "=", owner)
        .execute();
    } else {
      await trx
        .insertInto("credits")
        .values({ owner_id: owner, balance: units, updated_at: nowIso() })
        .execute();
    }

    await trx
      .insertInto("credit_ledger")
      .values({
        id: newId(),
        owner_id: owner,
        delta: units,
        reason: "grant",
        ref: null,
        note: note ?? null,
        created_at: nowIso(),
      })
      .execute();
  });
}

/**
 * How many times this journal has been charged for one thing.
 *
 * The ledger is append-only and is already the record of every purchase, so a
 * repeatable one-off — storage, today — needs no column of its own: the count
 * of its rows *is* how much was bought. Refunds do not subtract here, and are
 * not meant to: `refund` is its own reason, for sends that did not happen.
 */
export async function countSpends(owner: string, reason: SpendReason): Promise<number> {
  const handle = await getDatabaseOrNull();
  if (!handle) return 0;
  const row = await handle.db
    .selectFrom("credit_ledger")
    .select((eb) => eb.fn.countAll<number>().as("n"))
    .where("owner_id", "=", owner)
    .where("reason", "=", reason)
    .executeTakeFirst();
  // `count` is a bigint on Postgres, which `pg` hands back as a string.
  return Number(row?.n ?? 0);
}

/**
 * What this journal's credits have gone on, by reason — B860.
 *
 * Spends only (`delta < 0`), returned as positive counts, biggest first. The
 * account page is the one reader of it, and the reason it exists is the two
 * model-backed reasons: `helper` and `transcription` are the only spends a
 * person cannot see the result of on a shelf or in a mailbox, so a balance
 * that drops without them named reads as unexplained. Grouped in SQL for the
 * reason `usageSince` is — a busy journal is thousands of rows and the answer
 * is at most eight lines.
 */
export async function spentByReason(owner: string): Promise<{ reason: string; credits: number }[]> {
  const handle = await getDatabaseOrNull();
  if (!handle) return [];
  const rows = await handle.db
    .selectFrom("credit_ledger")
    .select((eb) => ["reason", eb.fn.sum<number>("delta").as("total")])
    .where("owner_id", "=", owner)
    .where("delta", "<", 0)
    // Credits taken back with the money that bought them (B878). Negative,
    // and not a thing the journal spent on anything — listing it under
    // "where credits went" would invent a purchase nobody made.
    .where("reason", "!=", "purchase_refund")
    .groupBy("reason")
    .execute();
  return rows
    // `sum` is a bigint on Postgres and arrives as a string; negated here so
    // the caller renders a spend as the positive number a person would say.
    // Hundredths in the table, credits out — B987, the same boundary
    // `balanceOf` is.
    .map((row) => ({ reason: row.reason, credits: creditsFromUnits(-Number(row.total ?? 0)) }))
    .sort((a, b) => b.credits - a.credits);
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
    // In credits, like everything else this module hands out — B987.
    delta: creditsFromUnits(Number(r.delta)),
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
  // Both sides in credits — B987. The equality is the same question in either
  // unit; the numbers are read by an operator, so they are reported in the
  // unit an operator thinks in.
  const balance = creditsFromUnits(row ? Number(row.balance) : 0);
  // `sum` is `numeric` on Postgres, which `pg` returns as a string, and null
  // when there are no rows at all.
  const ledger = creditsFromUnits(Number(sum?.total ?? 0));
  return { balance, ledger, ok: balance === ledger };
}
