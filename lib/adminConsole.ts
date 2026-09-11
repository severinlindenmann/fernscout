import "server-only";
import fs from "node:fs";
import path from "node:path";

import { readBackupStatus, type BackupStatus } from "./backupStatus";
import { basemapProblem } from "./basemap";
import { resolveCapabilities } from "./capabilities";
import { contentRoot } from "./contentRoot";
import { creditsFromUnits } from "./credits/format";
import { MIN_CREDITS } from "./credits/pricing";
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
  /**
   * The row this trouble came from — a print order id or a payment id.
   *
   * `attention()` builds its id from this, not from `owner` and `what`: two
   * failed photobooks for the same journal have the same `what` and the same
   * `owner`, so composing an id out of that prose collided them into one
   * attention-band entry — acknowledging one silently hid the others (B1223).
   * The producer already selects the row id for `detail`; this is the same
   * value, named so a consumer never has to compose one again.
   */
  ref: string;
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
        ref: row.id,
      });
    }

    // B1165. A photobook refusal returns the row to `built` — B1348's
    // conditional claim needs it retryable, not stuck — so the `WHERE status
    // = 'failed'` above never sees it. `markPrintFailed` records what
    // happened in `payload.print`, so a second pass over recent `built`
    // rows, filtered in application code (this column is JSON-as-text, not
    // something either dialect can query into portably), is what surfaces
    // one to the operator at all.
    const printedRecently = await handle.db
      .selectFrom("print_orders")
      .select(["owner_id", "kind", "provider", "created_at", "id", "payload"])
      .where("status", "=", "built")
      .where("kind", "=", "photobook")
      .where("created_at", ">=", since)
      .orderBy("created_at", "desc")
      .limit(20)
      .execute();
    for (const row of printedRecently) {
      let print: { failure?: string; providerMessage?: string } | undefined;
      try {
        print = (JSON.parse(row.payload) as { print?: typeof print }).print;
      } catch {
        continue;
      }
      if (!print?.failure) continue;
      found.push({
        what: "A photobook never printed",
        owner: row.owner_id,
        when: row.created_at.slice(0, 10),
        // The provider's own words, for the operator only — an owner's order
        // page never reads this field.
        detail: `${row.provider} refused it (${print.failure})${
          print.providerMessage ? ` — "${print.providerMessage}"` : ""
        } · order ${row.id}`,
        ref: row.id,
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
        ref: row.id,
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
  const buckets = emptyWeeks(weeks);
  // The dates themselves, since B1181, because the funnel needs them per
  // journal and this needs only how many fell in each week. One query
  // answering both rather than two of the same shape.
  const dates = await signupDates();
  for (const at of Object.values(dates ?? {})) put(buckets, at);
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
 * Every journal and every trip that used to be here — B996 (X4), extended by
 * B1073.
 *
 * `lib/tombstones.ts` reads one by name, because that is what a 410 needs.
 * This is the other question: what have I lost, and is a name still held. Two
 * `readdir`s of directories that hold a handful of entries on a busy instance
 * — `.deleted/` itself for a whole journal's record (`<user>.json`), and one
 * level down, per username, for a single trip of a journal that still exists
 * (`.deleted/<user>/<trip>.json`). The two shapes read alike from disk and
 * mean opposite things — B1073's whole reason for existing is that they were
 * once told apart wrongly from an `ls`, so `kind` on the parsed record is what
 * every caller here switches on rather than which directory it came from.
 */
export function allTombstones(): Tombstone[] {
  const dir = path.join(contentRoot(), ".deleted");
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const found: Tombstone[] = [];
  const read = (file: string) => {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Tombstone;
      if (typeof parsed?.kind === "string") found.push(parsed);
    } catch {
      // A tombstone nobody can parse is a line lost from a list, not a page
      // that fails to render.
    }
  };
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(".json")) {
      read(path.join(dir, entry.name));
    } else if (entry.isDirectory()) {
      // A username's own subdirectory holds that journal's deleted trips.
      let tripFiles: string[];
      try {
        tripFiles = fs.readdirSync(path.join(dir, entry.name)).filter((n) => n.endsWith(".json"));
      } catch {
        continue;
      }
      for (const file of tripFiles) read(path.join(dir, entry.name, file));
    }
  }
  return found.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
}

/* ------------------------------------------------------------------ *
 * Is anything broken
 * ------------------------------------------------------------------ */

type Wrong = {
  /**
   * A stable name for this fault, carrying no number — B1203.
   *
   * The titles here say how many hours, and an acknowledgement keyed on a
   * title that changes hourly is one that never holds. Set by whoever raised
   * the fault, for the same reason `backup` below is: the producer says what
   * it produced, and a consumer matching text is a list that is always missing
   * its next entry.
   */
  id: string;
  title: string;
  detail: string;
  /** True on the ones `backupWrongs` raised — B1181.
   *
   *  The band above the tabs files an entry by kind, and the alternative was
   *  matching this title against `/backup/i`: a list of phrases that is always
   *  missing its next entry, and that missed "The off-site copy is 226 hours
   *  old" the first time it was tried. The producer says what it produced. */
  backup?: true;
};

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
 * What the backup status is worth waking somebody for.
 *
 * Pulled out of `health()` so it can be checked (B1174): `health()` reaches
 * the database, the config and three directories, which is why the rules that
 * matter most here had no test at all until an off-site copy stopped arriving
 * and the page went on saying "Nothing is wrong."
 *
 * The primary alarms on every state but `ok` — including `unknown`, which on
 * the primary means no backup has ever run on this machine and is never a
 * legitimate steady state.
 *
 * The secondary alarms on `stale` and on nothing else. `stale` is
 * unambiguous: copies were arriving at this destination and have stopped, and
 * losing the machine now loses everything written since — the primary, being
 * on that machine, is no help by definition. This is also the one failure the
 * nightly run cannot report, because the primary alone decides whether a night
 * succeeded (B651): the unit exits zero, the OnFailure= mail never fires, and
 * this page is the only place it shows.
 *
 * `unknown` on the secondary is deliberately silent. It means both "no second
 * destination was ever configured" — a legitimate choice, and the shipped
 * default — and "one is configured and has never once succeeded", and nothing
 * on disk separates them; `readSecondaryStatus` says so. An alarm permanently
 * red on every instance that chose a single destination is an alarm nobody
 * reads, which is B651's lesson one level up. The panel states the word
 * plainly instead.
 */
export function backupWrongs(backup: BackupStatus): Wrong[] {
  const wrong: Wrong[] = [];
  if (backup.state === "failing") {
    wrong.push({
      backup: true,
      id: "backup:primary",
      title: "The backup is failing",
      detail: `Last success ${backup.lastSuccessAt?.slice(0, 16).replace("T", " ") ?? "never"}. ${backup.lastFailure ?? ""}`.trim(),
    });
  } else if (backup.state === "stale") {
    wrong.push({
      backup: true,
      id: "backup:primary",
      title: `The backup has not run in ${Math.round(backup.ageHours ?? 0)} hours`,
      detail: `Anything past ${backup.maxAgeHours} hours is stale. The timer may still look enabled.`,
    });
  } else if (backup.state === "unknown") {
    wrong.push({
      backup: true,
      id: "backup:primary",
      title: "No backup has ever been recorded",
      detail: backup.reason ?? "Nothing has written a backup status file on this server.",
    });
  }

  if (backup.secondary.state === "stale") {
    wrong.push({
      backup: true,
      id: "backup:secondary",
      title: `The off-site copy has not arrived in ${Math.round(backup.secondary.ageHours ?? 0)} hours`,
      detail:
        `Anything past ${backup.secondary.maxAgeHours} hours is stale. The nightly run keeps ` +
        `succeeding while this fails — the primary alone decides whether a night worked, so the ` +
        `unit exits zero and no failure mail is sent. Read the copy step in ` +
        `journalctl -u fernscout-backup.`,
    });
  }
  return wrong;
}

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
  wrong.push(...backupWrongs(backup));

  const content = contentRootProblem();
  if (content) wrong.push({ id: "content-root", title: "The journal directory cannot be read", detail: content });

  const basemap = basemapProblem();
  if (basemap) wrong.push({ id: "basemap", title: "The map data cannot be read", detail: basemap });

  for (const state of Object.values(resolveCapabilities())) {
    if (state.enabled) continue;
    if (state.reason === OFF_BY_CHOICE) {
      offByChoice.push(state.name);
      continue;
    }
    wrong.push({
      id: `capability:${state.name}`,
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

/* ------------------------------------------------------------------ *
 * Is anybody still writing
 * ------------------------------------------------------------------ */

/** What one journal's `entries/` folders say about it — B1181. */
export type Activity = {
  /** Day files on disk, drafts included. Filenames, never parsed content. */
  days: number;
  /** Of those, the ones dated on or after the caller's `since` — the day
   *  *described*, the convention `daysByWeek` sets and for its reasons. */
  recentDays: number;
  /** The latest day *described*, `YYYY-MM-DD`. The filename's own date. */
  lastDay: string | null;
  /**
   * When a day file was last touched, ISO.
   *
   * **The only available answer to "is this person still writing", and an
   * imperfect one.** Nothing records when a day was typed: `daysByWeek` counts
   * the day being written *about*, which puts a trip written up a fortnight
   * late on the fortnight it happened, and a whole journal caught up on in one
   * evening reads as three months of activity. The file's own mtime is the
   * moment somebody last changed something, which is the question being asked.
   *
   * What it cannot survive is a restore: the files are written anew, so the
   * morning after a restore drill every journal looks like it was written to
   * at once. The page says so beside the column rather than hiding it.
   */
  lastWroteAt: string | null;
};

/**
 * Every journal's `entries/`, walked once — B1181.
 *
 * A sibling of `daysByWeek` and deliberately not part of it: that answers a
 * question about the instance and this one about each journal, and merging
 * them would leave the weekly chart carrying a per-journal map it never reads.
 * Both are one `readdir` per trip; this adds a `stat` per file, against an
 * inode the `readdir` has already brought into cache.
 *
 * Not folded into `collectStatus`, even though that walk is the expensive one
 * and is already cached. Five minutes of staleness is right for a byte count
 * and wrong for *did somebody write something*: the operator reloads the page
 * precisely because they think somebody has.
 */
export function journalActivity(since: string): Record<string, Activity> {
  const from = since.slice(0, 10);
  const found: Record<string, Activity> = {};
  for (const username of getUsernames()) {
    const row: Activity = { days: 0, recentDays: 0, lastDay: null, lastWroteAt: null };
    found[username] = row;
    const trips = path.join(contentRoot(), username, "trips");
    let ids: string[];
    try {
      ids = fs
        .readdirSync(trips, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    } catch {
      continue;
    }
    for (const id of ids) {
      const dir = path.join(trips, id, "entries");
      let files: string[];
      try {
        files = fs.readdirSync(dir);
      } catch {
        continue;
      }
      for (const file of files) {
        if (!file.endsWith(".md")) continue;
        row.days += 1;
        const day = file.slice(0, 10);
        if (day >= from) row.recentDays += 1;
        if (!row.lastDay || day > row.lastDay) row.lastDay = day;
        try {
          const at = fs.statSync(path.join(dir, file)).mtime.toISOString();
          if (!row.lastWroteAt || at > row.lastWroteAt) row.lastWroteAt = at;
        } catch {
          // A file that vanished between the readdir and the stat is one day
          // missing from one timestamp, not a journal that fails to render.
        }
      }
    }
  }
  return found;
}

/* ------------------------------------------------------------------ *
 * Does anybody get through
 * ------------------------------------------------------------------ */

/**
 * When each journal's first person signed in, `YYYY-MM-DD` by owner — B1181.
 *
 * Null when there is no database to ask, which is a different answer from an
 * empty map: see `funnel`. The same `min(created_at)` per owner that
 * `signupsByWeek` counts, kept separate because one needs the dates and the
 * other needs only how many fell in each week.
 */
export async function signupDates(): Promise<Record<string, string> | null> {
  const handle = await getDatabaseOrNull();
  if (!handle) return null;
  try {
    const rows = await handle.db
      .selectFrom("users")
      .select(({ fn }) => ["owner_id", fn.min<string>("created_at").as("first")])
      .groupBy("owner_id")
      .execute();
    const found: Record<string, string> = {};
    for (const row of rows) {
      const at = String(row.first ?? "").slice(0, 10);
      if (at) found[row.owner_id] = at;
    }
    return found;
  } catch {
    return null;
  }
}

/** How long after its last day a journal stops counting as still being
 *  written. A fortnight: a week is a holiday, and a month is long enough that
 *  a journal nobody has touched since the spring still reads as alive.
 *
 *  Not exported: `funnel` writes it into the step's own label, so nothing
 *  outside this file needs the number. `app/admin/Journals.tsx` keeps its own
 *  `QUIET_DAYS` at the same fortnight and deliberately does not import this —
 *  a client component importing from here pulls the database into the browser
 *  bundle, which the build says at length. */
const STILL_WRITING_DAYS = 14;

export type FunnelStep = {
  /** What this step is, in the operator's words. */
  label: string;
  /** Journals that got this far. */
  count: number;
  /** Why the ones between the previous step and this one stopped. Empty on the
   *  first step, which nobody dropped out of. */
  lost: string;
};

/**
 * Everybody who arrived in the window, and how far each one got — B1181.
 *
 * **The only thing on the console that says whether the software works.** Its
 * parts were already on the page, in two places and on two tabs: `Growth`
 * counted arrivals and counted one failure, the journal rows listed spend, and
 * the drop-off between them was arithmetic the operator did in their head.
 *
 * Cohorted by arrival rather than measured across everybody, because the
 * question is about the software as it is now. An instance three years old
 * whose first year went badly would otherwise report that first year for ever.
 *
 * `published` is `collectStatus`'s own count, which excludes drafts; `wrote` is
 * the filenames on disk, which do not. The gap between those two steps is
 * exactly the journals holding a draft nobody published — the one failure the
 * helper exists to make impossible, and the one nothing counted.
 *
 * Null when there is no database. `users` is where an arrival is recorded, and
 * an instance without one cannot say who arrived when; zero would be a claim
 * that nobody did.
 */
export function funnel(
  signups: Record<string, string> | null,
  activity: Record<string, Activity>,
  published: Record<string, number>,
  windowDays: number,
  now = new Date(),
): FunnelStep[] | null {
  if (!signups) return null;
  const from = new Date(now.getTime() - windowDays * 86_400_000).toISOString().slice(0, 10);
  const cohort = Object.entries(signups)
    .filter(([, at]) => at >= from)
    .map(([username]) => username);

  const wrote = cohort.filter((name) => (activity[name]?.days ?? 0) > 0);
  const put = wrote.filter((name) => (published[name] ?? 0) > 0);
  const since = new Date(now.getTime() - STILL_WRITING_DAYS * 86_400_000).toISOString();
  const still = put.filter((name) => (activity[name]?.lastWroteAt ?? "") >= since);

  // One journal is the ordinary case on a small instance, and "1 have gone
  // quiet" is the sentence somebody reads on the day it matters most.
  const lost = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

  return [
    { label: "Signed up", count: cohort.length, lost: "" },
    {
      label: "Wrote a day",
      count: wrote.length,
      lost: lost(cohort.length - wrote.length, "never wrote anything", "never wrote anything"),
    },
    {
      label: "Published one",
      count: put.length,
      lost: lost(
        wrote.length - put.length,
        "has a draft and never published",
        "have a draft and never published",
      ),
    },
    {
      label: `Wrote in ${STILL_WRITING_DAYS} days`,
      count: still.length,
      lost: lost(put.length - still.length, "has gone quiet since", "have gone quiet since"),
    },
  ];
}

/* ------------------------------------------------------------------ *
 * What wants a person
 * ------------------------------------------------------------------ */

/** One thing that will not resolve itself — B1181. */
export type Attend = {
  /**
   * This entry's stable identity — B1203, and the reason it is not the title.
   *
   * The titles carry numbers that move: *"The off-site copy has not arrived in
   * 226 hours"* is a different string every hour, and an acknowledgement keyed
   * on it would last exactly until the next one. An id names the *thing*
   * (`backup:secondary`, `disk:eva`) and never its size.
   */
  id: string;
  /** The kind, which is also the order these are shown in. */
  kind: "approve" | "fault" | "backup" | "disk" | "credits";
  title: string;
  detail: string;
  /** The right-hand stamp: how long it has been like this. */
  age: string;
  /**
   * How bad this is, in whatever unit this entry counts in — days stale,
   * percent full, journals under the floor, the newest purchase's timestamp.
   * Comparable **within one id and never across ids**.
   *
   * It exists so an acknowledgement can lapse when the thing gets worse
   * (`lib/adminAcks.ts`), which is the difference between answering an alarm
   * and muzzling it. An entry with nothing to measure carries 0 and is
   * therefore hidden for as long as it is continuously present — which is
   * right for a fault, whose only two sizes are happening and not.
   */
  level: number;
};

/** Where a journal's disk use stops being headroom and starts being a refused
 *  upload. Nine tenths: the last tenth is a photograph or two, which is one
 *  afternoon's worth. */
const DISK_FULL = 0.9;

const ORDER: Attend["kind"][] = ["approve", "fault", "backup", "disk", "credits"];

/** Whole days between then and now, for a stamp rather than a duration. */
function daysSince(when: string | null, now: Date): number | null {
  if (!when) return null;
  const at = Date.parse(when);
  if (Number.isNaN(at)) return null;
  return Math.max(0, Math.floor((now.getTime() - at) / 86_400_000));
}

/**
 * Everything that wants a person, in one list — B1181.
 *
 * **This is the change B1181 was written for.** Five different things needed
 * the operator and the page had a list for one of them: the purchase queue
 * stood at the top, a health fault was a badge on the third tab, a stale
 * off-site copy was a line inside a card behind that badge, a journal at its
 * quota ceiling was a meter nobody scrolled to, and a journal that had spent
 * everything it was given was on no list at all. Four of those five were
 * learned about from somebody complaining.
 *
 * Pure, over what the page already fetched, so it costs no query and is
 * checkable without a database or a browser. It **shows and never acts**:
 * `lib/credits.ts`'s property 1 stands, and the token that approves a purchase
 * sits in a mailbox precisely so that it is not in a browser tab.
 *
 * Ordered by kind rather than by age. A purchase is somebody's money today and
 * a stale backup is only ever bad news later; sorting by how long each had
 * waited would put a fortnight-old disk warning above a person who paid this
 * morning.
 */
export function attention(input: {
  awaiting: Payment[];
  health: Health;
  troubles: Trouble[];
  journals: StatusReport["journals"];
  ceiling: number | null;
  balances: { username: string; balance: number | null; granted: number }[];
  now?: Date;
}): Attend[] {
  const now = input.now ?? new Date();
  const found: Attend[] = [];

  if (input.awaiting.length > 0) {
    const asked = input.awaiting.map((one) => one.requestedAt ?? one.createdAt).sort();
    const oldest = asked[0];
    const days = daysSince(oldest, now);
    found.push({
      id: "approve",
      // The *newest* request, as a number. Acknowledging the queue says "I
      // have seen these"; a purchase filed after that moment is a higher
      // level and shows through, which is the only reading of this entry that
      // does not lose somebody's money in a suppression.
      level: Date.parse(asked[asked.length - 1] ?? "") || 0,
      kind: "approve",
      title: `${input.awaiting.length} ${input.awaiting.length === 1 ? "purchase is" : "purchases are"} waiting`,
      detail:
        "The single-use approval link is in your mailbox. This page cannot grant, and that is deliberate.",
      age: days === null ? "unknown" : `oldest ${days}d`,
    });
  }

  // A backup's own faults arrive inside `health.wrong` carrying their own
  // `backup` mark, so a stale copy is one entry here rather than one under
  // `fault` and a second under `backup`. Marked at the source rather than
  // matched by title: see the note on `Wrong`.
  for (const wrong of input.health.wrong) {
    const days = daysSince(input.health.backup.lastSuccessAt, now);
    found.push({
      id: wrong.id,
      // Whole days stale for a backup, so an acknowledgement holds for a day
      // and lapses on the next one — a copy that is still not arriving a week
      // later is a different fact from the one that was answered.
      // A fault has no size: it is happening or it is not, and `sweepAcks`
      // is what makes it news again when it recurs.
      level: wrong.backup ? (days ?? 0) : 0,
      kind: wrong.backup ? "backup" : "fault",
      title: wrong.title,
      detail: wrong.detail,
      age: wrong.backup ? (days === null ? "never" : `${days}d`) : "now",
    });
  }

  for (const trouble of input.troubles) {
    found.push({
      // The row itself, not the person and the thing (B1223): two failed
      // photobooks for one journal share both `owner` and `what`, so
      // composing an id from that prose collided them into one entry and
      // acknowledging one silently hid the other. `ref` is the producer's
      // own row id, which is unique by construction.
      id: `trouble:${trouble.ref}`,
      level: 0,
      kind: "fault",
      title: trouble.what,
      detail: `${trouble.owner ? `${trouble.owner} · ` : ""}${trouble.detail}`,
      age: trouble.when,
    });
  }

  if (input.ceiling) {
    for (const journal of input.journals) {
      const full = journal.bytes / input.ceiling;
      if (full < DISK_FULL) continue;
      found.push({
        id: `disk:${journal.username}`,
        // Whole percent. Acknowledging at 96% holds until 97%, which on a
        // ceiling somebody is filling a photograph at a time is the right
        // amount of nagging: often enough to matter, rarely enough to answer.
        level: Math.round(full * 100),
        kind: "disk",
        title: `${journal.username} is at ${Math.round(full * 100)}% of their storage`,
        detail:
          full >= 1
            ? "The next upload is refused. Buying past it is 5 GB at a time, from their own page."
            : "The next few uploads are all that is left. Buying past it is 5 GB at a time.",
        age: "measured",
      });
    }
  }

  // Granted-and-nearly-spent rather than merely low: a journal that was never
  // given anything has not run out of anything, and saying it had would be an
  // alarm about somebody who has done nothing.
  const empty = input.balances.filter(
    (row) => row.balance !== null && row.granted > 0 && row.balance < MIN_CREDITS,
  );
  if (empty.length > 0) {
    const named = empty.slice(0, 4).map((row) => row.username).join(", ");
    found.push({
      id: "credits",
      // How many are under the floor. One more journal running out is a new
      // person who cannot send, and shows through an acknowledgement of the
      // ones before them.
      level: empty.length,
      kind: "credits",
      title: `${empty.length} ${empty.length === 1 ? "journal has" : "journals have"} less than one purchase's worth left`,
      detail: `${named}${empty.length > 4 ? ` and ${empty.length - 4} more` : ""} · under ${MIN_CREDITS} credits, which is the smallest amount anybody can buy.`,
      age: "now",
    });
  }

  return found.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
}
