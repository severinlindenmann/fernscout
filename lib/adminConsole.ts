import "server-only";
import fs from "node:fs";
import path from "node:path";

import { readBackupStatus, type BackupStatus } from "./backupStatus";
import { basemapProblem } from "./basemap";
import { resolveCapabilities } from "./capabilities";
import { contentRoot } from "./contentRoot";
import { creditsFromUnits } from "./credits/format";
import { getDatabaseOrNull } from "./db";
import { collectStatus, type StatusReport } from "./statusReport";
import { contentRootProblem, getUsernames } from "./users";
import { type Payment } from "./payments";
import { type Tombstone } from "./tombstones";

/**
 * Everything on `/admin` that is not money — B996.
 *
 * `lib/instanceCosts.ts` answers "what did this cost". This answers the other
 * two questions an operator opens the console with: **is anybody waiting on
 * me**, and **is anything broken** — plus the one that gives those a reason to
 * matter, what the instance actually did for people.
 *
 * Deliberately a second module rather than more of the first. Costs are an
 * arithmetic layer over four tables and a price list, and every function there
 * multiplies rappen; nothing here is money at all. Keeping them apart is also
 * what lets the expensive half be cached without a price ever going stale.
 *
 * **Nothing here writes, and nothing here throws.** Every block that reaches
 * disk or the database is wrapped, because this feeds one page whose whole job
 * is to be readable on a bad day — and a bad day is exactly when a section
 * fails. A block that cannot answer returns nothing and says so through the
 * `problems` list it inherits from `collectStatus`, never through an
 * exception.
 */

/** Milliseconds one snapshot of the disk stays good for. */
const SNAPSHOT_TTL_MS = 5 * 60 * 1000;

let cached: { at: number; report: StatusReport } | null = null;

/**
 * The instance's own roster — days, trips, drafts, contacts, guests, bytes —
 * cached for five minutes.
 *
 * **`collectStatus()` is the expensive call in this codebase.** It parses
 * every day file of every journal and walks the whole of `content/` for its
 * byte counts; on this instance that is thirty-five journals and some
 * gigabytes. It was written for a nightly mail, where the cost is invisible.
 * Putting it behind a page load without a cache would make `/admin` the
 * slowest thing here and would do it again on every reload.
 *
 * Five minutes because every number it carries moves in days, not seconds: a
 * journal does not gain a trip while you are reading. The staleness is shown
 * on the page rather than hidden — an operator reading a disk figure deserves
 * to know when it was measured.
 *
 * A single process-wide variable and not a store: it is a cache of a pure
 * read, so the worst a second worker can do is walk the disk twice.
 */
export async function snapshot(): Promise<{ report: StatusReport; measuredAt: number }> {
  if (cached && Date.now() - cached.at < SNAPSHOT_TTL_MS) {
    return { report: cached.report, measuredAt: cached.at };
  }
  const report = await collectStatus();
  cached = { at: Date.now(), report };
  return { report, measuredAt: cached.at };
}

/* ------------------------------------------------------------------ *
 * Takings
 * ------------------------------------------------------------------ */

export type Takings = {
  /** Settled, and actually paid for — admin grants are not takings. */
  paidRappen: number;
  /** What each method brought in, biggest first. Grants are excluded. */
  byMethod: { method: string; rappen: number; count: number }[];
  /** Filed and not yet approved. Money you have not got. */
  waitingRappen: number;
  waitingCount: number;
  /** Given back. Reported separately rather than netted off, because a refund
   *  is an event worth seeing and a net figure hides it. */
  refundedRappen: number;
  /** Credits handed over by the operator, which cost the buyer nothing. */
  grantedCredits: number;
};

/**
 * The other side of the ledger — B996 (X5).
 *
 * Pure, over payments the caller already fetched, so the whole panel costs no
 * query. `paidRappen` counts what was paid rather than what was granted: the
 * distinction is `method === "admin"`, and conflating the two would show an
 * instance that gives credits away as one that sells them.
 */
export function takingsBreakdown(paid: Payment[], awaiting: Payment[]): Takings {
  const byMethod = new Map<string, { rappen: number; count: number }>();
  let paidRappen = 0;
  let refundedRappen = 0;
  let grantedCredits = 0;

  for (const payment of paid) {
    if (payment.status === "refunded") {
      refundedRappen += payment.amountRappen;
      continue;
    }
    if (payment.method === "admin") {
      grantedCredits += payment.credits;
      continue;
    }
    paidRappen += payment.amountRappen;
    const method = payment.method ?? "unknown";
    const row = byMethod.get(method) ?? { rappen: 0, count: 0 };
    row.rappen += payment.amountRappen;
    row.count += 1;
    byMethod.set(method, row);
  }

  return {
    paidRappen,
    byMethod: [...byMethod]
      .map(([method, row]) => ({ method, ...row }))
      .sort((a, b) => b.rappen - a.rappen),
    waitingRappen: awaiting.reduce(
      (sum, payment) => sum + (payment.method === "admin" ? 0 : payment.amountRappen),
      0,
    ),
    waitingCount: awaiting.length,
    refundedRappen,
    grantedCredits,
  };
}

/* ------------------------------------------------------------------ *
 * One query for the whole instance, rather than one per journal
 * ------------------------------------------------------------------ */

/**
 * Why every journal spent what it spent, in one query — B996.
 *
 * The console renders all thirty-five journal panels on the server so that
 * opening one costs no request. `spentByReason(owner)` would therefore be
 * thirty-five round trips for a page nobody has scrolled yet, and
 * `listPayments(owner)` another thirty-five. Both are the same `GROUP BY` with
 * the owner left in, so both are one query — which is the whole difference
 * between a page that opens and a page you wait for.
 *
 * Refunds of purchases are left out for the same reason `spentByReason` leaves
 * them out: giving money back is not a thing the journal spent credits on.
 *
 * **Hundredths in the table, credits out** — the same boundary `balanceOf` and
 * `spentByReason` are, since B987. A sum of `delta` read straight out is a
 * hundred times what a person would say.
 */
export async function spendByReasonAll(): Promise<Record<string, { reason: string; credits: number }[]>> {
  const handle = await getDatabaseOrNull();
  if (!handle) return {};
  try {
    const rows = await handle.db
      .selectFrom("credit_ledger")
      .select(({ fn }) => ["owner_id", "reason", fn.sum<number>("delta").as("total")])
      .where("delta", "<", 0)
      .where("reason", "!=", "purchase_refund")
      .groupBy(["owner_id", "reason"])
      .execute();
    const found: Record<string, { reason: string; credits: number }[]> = {};
    for (const row of rows) {
      const credits = creditsFromUnits(Math.abs(Number(row.total ?? 0)));
      if (credits === 0) continue;
      (found[row.owner_id] ??= []).push({ reason: row.reason, credits });
    }
    for (const list of Object.values(found)) list.sort((a, b) => b.credits - a.credits);
    return found;
  } catch {
    return {};
  }
}

/** Every journal's purchases, newest first, in one query — see above. */
export async function paymentsByOwner(): Promise<Record<string, Payment[]>> {
  const handle = await getDatabaseOrNull();
  if (!handle) return {};
  try {
    const rows = await handle.db
      .selectFrom("payments")
      .select([
        "id",
        "owner_id",
        "credits",
        "amount_rappen",
        "status",
        "method",
        "created_at",
        "paid_at",
        "requested_at",
        "provider_ref",
      ])
      .orderBy("created_at", "desc")
      .limit(500)
      .execute();
    const found: Record<string, Payment[]> = {};
    for (const row of rows) {
      (found[row.owner_id] ??= []).push({
        id: row.id,
        owner: row.owner_id,
        credits: row.credits,
        amountRappen: row.amount_rappen,
        status: row.status as Payment["status"],
        method: (row.method as Payment["method"]) ?? null,
        createdAt: row.created_at,
        paidAt: row.paid_at,
        requestedAt: row.requested_at,
        providerRef: row.provider_ref,
      });
    }
    return found;
  } catch {
    return {};
  }
}

/* ------------------------------------------------------------------ *
 * Things that went wrong
 * ------------------------------------------------------------------ */

export type Trouble = {
  /** What happened, in the operator's words. */
  what: string;
  /** Who it happened to, or null when it is instance-wide. */
  owner: string | null;
  /** When, `YYYY-MM-DD`. */
  when: string;
  /** The detail that makes it actionable. */
  detail: string;
};

/** How long a filed purchase may sit before it is a person kept waiting. */
const STUCK_HOURS = 48;

/**
 * Small counts, each of which is somebody who did not get what they paid for
 * — B996 (X6).
 *
 * **Deliberately not "errors".** Nothing here is a stack trace; every row is a
 * thing a person asked for that did not happen, which is a different list and
 * a much shorter one. Mail is absent because it is sent synchronously and
 * nothing records a failure — a panel that showed "0 mail failures" would be
 * claiming knowledge this instance does not have.
 */
export async function troubles(since: string): Promise<Trouble[]> {
  const handle = await getDatabaseOrNull();
  if (!handle) return [];
  const found: Trouble[] = [];

  try {
    const prints = await handle.db
      .selectFrom("print_orders")
      .select(["owner_id", "kind", "provider", "created_at", "id"])
      .where("status", "=", "failed")
      .where("created_at", ">=", since)
      .orderBy("created_at", "desc")
      .limit(20)
      .execute();
    for (const row of prints) {
      found.push({
        what: row.kind === "photobook" ? "A photobook never printed" : "A postcard never printed",
        owner: row.owner_id,
        when: row.created_at.slice(0, 10),
        detail: `${row.provider} refused it · order ${row.id}`,
      });
    }

    // Filed, mailed, and still sitting there. `requested_at` rather than
    // `created_at`: a row is created when somebody opens the purchase page and
    // may never be filed at all, and an abandoned checkout is not a person
    // waiting on you.
    const stuckBefore = new Date(Date.now() - STUCK_HOURS * 3600_000).toISOString();
    const stuck = await handle.db
      .selectFrom("payments")
      .select(["owner_id", "credits", "requested_at", "id"])
      .where("status", "=", "requested")
      .where("requested_at", "<", stuckBefore)
      .orderBy("requested_at", "asc")
      .limit(20)
      .execute();
    for (const row of stuck) {
      found.push({
        what: "A purchase has waited more than two days",
        owner: row.owner_id,
        when: (row.requested_at ?? "").slice(0, 10),
        detail: `${row.credits} credits · the approval link is in your mailbox`,
      });
    }
  } catch {
    // A database that cannot answer is itself reported by /api/health and by
    // the health card above this panel; an empty list here is not a claim that
    // nothing is wrong, and the card is what says so.
    return found;
  }

  return found;
}

/* ------------------------------------------------------------------ *
 * Growth
 * ------------------------------------------------------------------ */

export type Week = { week: string; count: number };

/**
 * When each journal arrived — B996 (X4).
 *
 * There is no registration table. The nearest true thing is the first `users`
 * row written for an owner id, which is created when the journal's first
 * person signs in and has never been deleted since. `min(created_at)` per
 * owner rather than a count of rows, because a journal with three people would
 * otherwise read as three signups.
 */
export async function signupsByWeek(weeks: number): Promise<Week[]> {
  const handle = await getDatabaseOrNull();
  const buckets = emptyWeeks(weeks);
  if (!handle) return buckets;
  try {
    const rows = await handle.db
      .selectFrom("users")
      .select(({ fn }) => ["owner_id", fn.min<string>("created_at").as("first")])
      .groupBy("owner_id")
      .execute();
    for (const row of rows) put(buckets, String(row.first ?? "").slice(0, 10));
  } catch {
    return buckets;
  }
  return buckets;
}

/**
 * Days written, week by week — B996 (X3).
 *
 * From the filenames alone. Every entry is `YYYY-MM-DD-slug.md`, so the whole
 * series is one `readdir` per trip and not a single file read; `collectStatus`
 * parses every day and is cached for that reason, and this needs none of what
 * parsing would give.
 *
 * The date is **the day being written about**, not the moment it was typed.
 * That is the one a journal is about, and it is also the only one the filename
 * carries. A trip written up a fortnight late therefore lands on the days it
 * happened, which is the honest shape of a travel journal.
 */
export function daysByWeek(weeks: number): Week[] {
  const buckets = emptyWeeks(weeks);
  for (const username of getUsernames()) {
    const trips = path.join(contentRoot(), username, "trips");
    let ids: string[];
    try {
      ids = fs.readdirSync(trips, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      continue;
    }
    for (const id of ids) {
      let files: string[];
      try {
        files = fs.readdirSync(path.join(trips, id, "entries"));
      } catch {
        continue;
      }
      for (const file of files) {
        if (!file.endsWith(".md")) continue;
        put(buckets, file.slice(0, 10));
      }
    }
  }
  return buckets;
}

/** Announcements actually sent, week by week — one row per reader per day. */
export async function sendsByWeek(weeks: number): Promise<Week[]> {
  const handle = await getDatabaseOrNull();
  const buckets = emptyWeeks(weeks);
  if (!handle) return buckets;
  try {
    const rows = await handle.db
      .selectFrom("day_notifications")
      .select(["sent_at"])
      // Bounded by the window the chart draws. Without it this reads every
      // announcement the instance has ever sent to answer a question about
      // twelve weeks.
      .where("sent_at", ">=", buckets[0].week)
      .execute();
    for (const row of rows) put(buckets, row.sent_at.slice(0, 10));
  } catch {
    return buckets;
  }
  return buckets;
}

/**
 * Every journal that used to be here — B996 (X4).
 *
 * `lib/tombstones.ts` reads one by name, because that is what a 410 needs.
 * This is the other question: what have I lost, and is a name still held. One
 * `readdir` of a directory that holds a handful of files on a busy instance.
 */
export function allTombstones(): Tombstone[] {
  const dir = path.join(contentRoot(), ".deleted");
  let names: string[];
  try {
    names = fs.readdirSync(dir).filter((name) => name.endsWith(".json"));
  } catch {
    return [];
  }
  const found: Tombstone[] = [];
  for (const name of names) {
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")) as Tombstone;
      if (typeof parsed?.kind === "string") found.push(parsed);
    } catch {
      // A tombstone nobody can parse is a line lost from a list, not a page
      // that fails to render.
    }
  }
  return found.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
}

/* ------------------------------------------------------------------ *
 * Is anything broken
 * ------------------------------------------------------------------ */

type Wrong = { title: string; detail: string };

export type Health = {
  commit: string | null;
  uptimeSeconds: number;
  /** Empty when the instance is fine, which is the ordinary state. */
  wrong: Wrong[];
  /** Capabilities the operator switched off. Not a fault, and shown as such. */
  offByChoice: string[];
  backupAgeHours: number | null;
  /**
   * The whole backup status, not just its age.
   *
   * B1085 stopped the nightly success mail, and this is what replaced it. The
   * `wrong` list above already shouts when a backup is stale, failing or never
   * recorded — but a mail every good night was also the operator's standing
   * proof that the thing still runs at all, and an empty `wrong` list cannot
   * distinguish "backed up four hours ago" from "nothing has been watching".
   * So the page states the good case too, positively, rather than only the
   * bad one by exception.
   */
  backup: BackupStatus;
};

/** The phrase `resolveCapabilities` uses for "the operator did not ask for
 *  this". Anything else is a capability that was asked for and refused. */
const OFF_BY_CHOICE = "not enabled on this server";

/**
 * What is wrong right now, and nothing else — B996 (decision 7B).
 *
 * `/api/health` has carried all of this since B234 and the operator has never
 * seen it: the deploy script reads it, a monitor reads it, the person who owns
 * the server reads a page that does not mention it. This is that data, filtered
 * to the entries that need somebody.
 *
 * **The filter is the whole design.** A strip of six green lines is read once
 * and then never again, and the day one of them turns red it is read no more
 * carefully than on the day before. A card that is empty when things are well
 * cannot be skimmed past when it is not.
 *
 * The distinction that makes it work: a capability reading *"not enabled on
 * this server"* was switched off by the operator and is listed as such, while
 * one that is off for a missing credential or a broken dependency was asked
 * for and did not come on — which is a fault, and is the exact shape of the
 * thing that goes unnoticed for a month.
 */
export async function health(): Promise<Health> {
  const wrong: Wrong[] = [];
  const offByChoice: string[] = [];

  const backup = readBackupStatus();
  if (backup.state === "failing") {
    wrong.push({
      title: "The backup is failing",
      detail: `Last success ${backup.lastSuccessAt?.slice(0, 16).replace("T", " ") ?? "never"}. ${backup.lastFailure ?? ""}`.trim(),
    });
  } else if (backup.state === "stale") {
    wrong.push({
      title: `The backup has not run in ${Math.round(backup.ageHours ?? 0)} hours`,
      detail: `Anything past ${backup.maxAgeHours} hours is stale. The timer may still look enabled.`,
    });
  } else if (backup.state === "unknown") {
    wrong.push({
      title: "No backup has ever been recorded",
      detail: backup.reason ?? "Nothing has written a backup status file on this server.",
    });
  }

  const content = contentRootProblem();
  if (content) wrong.push({ title: "The journal directory cannot be read", detail: content });

  const basemap = basemapProblem();
  if (basemap) wrong.push({ title: "The map data cannot be read", detail: basemap });

  for (const state of Object.values(resolveCapabilities())) {
    if (state.enabled) continue;
    if (state.reason === OFF_BY_CHOICE) {
      offByChoice.push(state.name);
      continue;
    }
    wrong.push({
      title: `${state.name} was asked for and is off`,
      detail: state.reason,
    });
  }

  return {
    commit: process.env.GIT_SHA ?? null,
    uptimeSeconds: Math.round(process.uptime()),
    wrong,
    offByChoice,
    backupAgeHours: backup.ageHours,
    backup,
  };
}

/* ------------------------------------------------------------------ *
 * Week arithmetic, in one place
 * ------------------------------------------------------------------ */

/** The Monday of the week a `YYYY-MM-DD` falls in, as `YYYY-MM-DD`. */
export function weekOf(date: string): string {
  const at = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(at.getTime())) return "";
  // getUTCDay: 0 is Sunday, so Sunday steps back six days rather than none.
  const back = (at.getUTCDay() + 6) % 7;
  at.setUTCDate(at.getUTCDate() - back);
  return at.toISOString().slice(0, 10);
}

/** The last `weeks` Mondays, oldest first, all at zero. */
function emptyWeeks(weeks: number): Week[] {
  const thisWeek = weekOf(new Date().toISOString().slice(0, 10));
  const start = new Date(`${thisWeek}T00:00:00Z`);
  return Array.from({ length: weeks }, (_, i) => ({
    week: new Date(start.getTime() - (weeks - 1 - i) * 7 * 86_400_000).toISOString().slice(0, 10),
    count: 0,
  }));
}

/** Add one to the bucket a date falls in, ignoring dates outside the window. */
function put(buckets: Week[], date: string): void {
  const week = weekOf(date);
  const found = buckets.find((bucket) => bucket.week === week);
  if (found) found.count += 1;
}
