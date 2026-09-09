import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import AdminGrant from "./AdminGrant";
import AdminRefund from "./AdminRefund";
import Console from "./Console";
import Journals from "./Journals";
import SpendChart from "./SpendChart";
import { BarChart, Breakdown, CountBars, Meter, type Week } from "./Charts";
import { isInstanceAdmin } from "@/lib/adminGate";
import { creditsEnabled } from "@/lib/credits";
import { formatCredits } from "@/lib/credits/format";
import { formatChf } from "@/lib/credits/pricing";
import {
  dailyCosts,
  dashboard,
  journalDaily,
  type CostLine,
  type DailySpend,
} from "@/lib/instanceCosts";
import {
  allTombstones,
  attention,
  daysByWeek,
  funnel,
  health,
  journalActivity,
  paymentsByOwner,
  sendsByWeek,
  signupDates,
  signupsByWeek,
  snapshot,
  spendByReasonAll,
  takingsBreakdown,
  troubles,
  STILL_WRITING_DAYS,
  type Activity,
  type Attend,
  type FunnelStep,
  type Health,
  type Takings,
  type Trouble,
} from "@/lib/adminConsole";
import { paymentsPaidSince, takings, type Payment } from "@/lib/payments";
import { serverSite } from "@/lib/site";
import { sessionStats, type SessionStats } from "@/lib/helper/sessions";
import { formatBytes } from "@/lib/storageQuota";
import { loadServerConfig } from "@/lib/config";
import { OPERATION_LABEL } from "@/lib/operations";
import type { JournalRow as StatusRow } from "@/lib/statusReport";

// Reads a session and the database on every request; nothing to prerender.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Operator",
  robots: { index: false, follow: false },
};

/** How far back the page looks. Thirty days rather than a calendar month
 *  because a bill is read on whatever day somebody wonders, and "the last
 *  thirty days" needs no explanation of what happens on the 31st. */
const WINDOW_DAYS = 30;

/** What the chart holds, so its 7 · 30 · 90 switch needs no round trip, and
 *  what the tiles compare against — thirty days beside the thirty before. */
const CHART_DAYS = 90;

/** How far back the weekly counts look. Twelve is a quarter, which is long
 *  enough for a trend and short enough to draw on a phone. */
const WEEKS = 12;

function ago(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

/**
 * The operator's console — B746, rebuilt by B996.
 *
 * **404 for everybody who is not the operator, including when there is no
 * operator.** `FERNSCOUT_ADMIN_EMAIL` unset means `isInstanceAdmin` is false
 * for every address, so an instance that has not set it behaves exactly as
 * though this page were not in the build — the same promise `lib/admin.ts`
 * makes. `notFound()` rather than a 403: a page that says "forbidden" has told
 * a stranger the operator dashboard is at this address.
 *
 * ## What changed, and why it is not just a rearrangement
 *
 * B746 answered one question — what did this cost — and answered it at length:
 * a total, three charts, and four lists that printed every priced line. An
 * operator opens this on a phone, standing somewhere else, and has three
 * questions rather than one: **is anybody waiting on me**, **what is this
 * costing me**, and **is anything broken**. The third was not on the page at
 * all; `/api/health` has known it since B234 and only the deploy script ever
 * read it.
 *
 * So: the queue stands above everything and outside the tabs, because it is
 * the only thing here that is a person rather than a number. The rest is three
 * tabs, each one screen. The four printed lists are folded behind the bars that
 * summarise them — nothing is lost and the page is a quarter of the length.
 *
 * ## Every number is still measured
 *
 * Unpriced usage says *not priced* rather than showing a zero, and the total
 * is a floor rather than an invoice. That rule is `lib/instanceCosts.ts`'s and
 * no chart here is worth breaking it for.
 *
 * ## Nothing here grants credits
 *
 * `lib/credits.ts`'s property 1 is unchanged: nothing a caller reaches over
 * HTTP raises a balance. The grant form in a journal's panel files a request
 * and causes a mail, and the single-use link in that mailbox is what credits.
 */
export default async function AdminPage() {
  if (!(await isInstanceAdmin())) notFound();

  const siteName = serverSite().name;
  const from = ago(WINDOW_DAYS);

  const [
    data,
    daily,
    series,
    { report, measuredAt },
    healthNow,
    troubleRows,
    paidTwoMonths,
    byReason,
    purchases,
    days,
    sends,
    signups,
    helper,
    arrivals,
  ] = await Promise.all([
    dashboard(from),
    dailyCosts(ago(CHART_DAYS), CHART_DAYS),
    journalDaily(from, WINDOW_DAYS),
    snapshot(),
    health(),
    troubles(from),
    paymentsPaidSince(ago(WINDOW_DAYS * 2)),
    spendByReasonAll(),
    paymentsByOwner(),
    Promise.resolve(daysByWeek(WEEKS)),
    sendsByWeek(WEEKS),
    signupsByWeek(WEEKS),
    sessionStats(from),
    signupDates(),
  ]);

  const metered = creditsEnabled();
  const money = takingsBreakdown(data.paid, data.awaiting);
  const stones = allTombstones();
  const byName = new Map(report.journals.map((row) => [row.username, row]));
  const ceiling = loadServerConfig().media.perUserBytes;

  // Who has written what, and when they last touched it — B1181. Outside the
  // five-minute snapshot deliberately: see `journalActivity`.
  const activity = journalActivity(from);
  const steps = funnel(
    arrivals,
    activity,
    Object.fromEntries(report.journals.map((row) => [row.username, row.days])),
    CHART_DAYS,
  );

  const needs = attention({
    awaiting: data.awaiting,
    health: healthNow,
    troubles: troubleRows,
    journals: report.journals,
    ceiling,
    balances: data.journals,
  });
  const alerts = healthNow.wrong.length + troubleRows.length;

  return (
    <main className="mx-auto max-w-4xl px-4 pb-24 pt-10 sm:pb-16 sm:pt-16">
      {/* The way back. `/admin` is reached from the landing page and is not in
          any navigation, so without this the only exit is the browser's own
          back button — and a page opened from a mailed link has no history to
          go back through. */}
      <Link href="/" className="text-sm font-semibold text-navy-700 underline">
        ← {siteName}
      </Link>
      <h1 className="mt-3 font-display text-3xl font-semibold text-navy-900 sm:text-4xl">
        Operator
      </h1>

      {/* First on the page, above the money and outside the tabs, because
          everything in it is somebody waiting rather than a number to read.
          B774 put the purchase queue here; B1181 put the other four kinds of
          waiting beside it, since a queue whose length you cannot see is the
          thing this position exists to fix. */}
      <NeedsYou items={needs} health={healthNow} />

      <Console
        tabs={[
          {
            id: "money",
            label: "Money",
            panel: (
              <>
                <Verdict data={data} daily={daily} paid={paidTwoMonths} />
                <SpendChart days={daily} />
                <p className="mt-2 text-sm text-navy-700">
                  The chart is the metered half. The other half is{" "}
                  <span className="font-mono text-navy-900">
                    {formatChf(Math.round(fixedRappen(data.fixed) / 30))} a day
                  </span>{" "}
                  fixed — the server, the domain, the mailbox — owed whether anybody writes a day
                  or not, and counted in the figures above. It is stated rather than drawn: it is
                  most of this bill and identical every day, so a chart holding it would divide
                  every real movement into a rounding error.
                </p>
                <Units
                  data={data}
                  activity={activity}
                  helper={helper}
                  journals={report.journals.length}
                />
                <section className="mt-8">
                  <h2 className="font-display text-lg font-semibold text-navy-900">
                    Where it goes
                  </h2>
                  <p className="mt-1 text-sm text-navy-700">
                    The last {WINDOW_DAYS} days. Open a bar for the lines behind it.
                  </p>
                  <Breakdown
                    groups={[
                      {
                        label: "Fixed",
                        lines: data.fixed,
                        note: "Owed whether anybody writes a day or not.",
                      },
                      {
                        label: "Models and speech",
                        lines: data.providers,
                        note: "Tokens and audio seconds as the providers measured them, priced from costs in site/config.json.",
                      },
                      {
                        label: "Print",
                        lines: data.print,
                        note: "What the printer actually charged, taken from the order itself rather than from a price list.",
                      },
                      {
                        label: "Sent to readers",
                        lines: data.sends,
                        note: "Counted, not priced. WhatsApp is billed by Meta per conversation and per country; email through the mailbox costs nothing per message, and push notifications cost nothing at all.",
                      },
                    ]}
                  />
                </section>
                <SpentOn operations={data.operations} />
                <TakingsPanel money={money} paid={data.paid} />
              </>
            ),
          },
          {
            // Renamed from `journals` by B1181, hash and all: the tab is no
            // longer a list of journals but the whole question of who is here
            // and whether they are getting anywhere. A bookmark to the old
            // hash lands on the first tab, which is where a bookmark to no
            // hash has always landed.
            id: "people",
            label: "People",
            panel: (
              <>
                <Funnel steps={steps} signups={signups} />
                <HelperSummary stats={helper} />
                <section className="mt-8">
                  <h2 className="font-display text-lg font-semibold text-navy-900">Journals</h2>
                  <p className="mt-1 text-sm text-navy-700">
                    When somebody last wrote, from the day file&rsquo;s own timestamp — the only
                    record of it there is. A restore from backup rewrites every file, so the
                    morning after a restore drill every journal reads as freshly written.
                  </p>
                  {!metered ? (
                    <p className="mt-1 text-sm text-navy-500">
                      Credits are switched off on this instance, so there are no balances to show.
                    </p>
                  ) : null}
                  {/* The rows, their search and their sort live in `Journals`;
                      what is behind one is rendered here, on the server, and
                      handed over as the panel that opens. Every query that
                      feeds those panels is instance-wide and made once — see
                      `spendByReasonAll` for why. */}
                  <Journals
                    rows={data.journals.map((journal) => ({
                      username: journal.username,
                      rappen: journal.rappen,
                      balance: journal.balance,
                      spent: journal.spent,
                      granted: journal.granted,
                      series: series[journal.username],
                      lastWroteAt: activity[journal.username]?.lastWroteAt ?? null,
                      disk: `${formatBytes(byName.get(journal.username)?.bytes ?? 0)}${
                        ceiling ? ` of ${formatBytes(ceiling)}` : ""
                      }`,
                      full: ceiling
                        ? (byName.get(journal.username)?.bytes ?? 0) / ceiling
                        : null,
                      panel: (
                        <JournalPanel
                          username={journal.username}
                          status={byName.get(journal.username)}
                          ceiling={ceiling}
                          reasons={byReason[journal.username] ?? []}
                          payments={purchases[journal.username] ?? []}
                          helper={helper.find((one) => one.owner === journal.username)}
                        />
                      ),
                    }))}
                  />
                  <p className="mt-3 text-xs text-navy-500">
                    {formatBytes(report.journals.reduce((sum, row) => sum + row.bytes, 0))} across{" "}
                    {report.journals.length}{" "}
                    {report.journals.length === 1 ? "journal" : "journals"} · measured{" "}
                    {new Date(measuredAt).toISOString().slice(11, 16)} UTC. Walking the whole of
                    content/ is the slowest thing this page can do, so it is held for five
                    minutes.
                  </p>
                </section>
              </>
            ),
          },
          {
            id: "instance",
            label: "Instance",
            badge: alerts,
            panel: (
              <>
                <HealthCard health={healthNow} troubles={troubleRows} />
                <WhatItDid days={days} sends={sends} print={data.print} />
                <Roster report={report} stones={stones.length} />
              </>
            ),
          },
        ]}
      />
    </main>
  );
}

/* ------------------------------------------------------------------ *
 * What wants a person
 * ------------------------------------------------------------------ */

/** The word beside each entry, so a kind is read before its sentence is. */
const KIND_LABEL: Record<Attend["kind"], string> = {
  approve: "Approve",
  fault: "Fault",
  backup: "Backup",
  disk: "Disk",
  credits: "Credits",
};

/**
 * Everything that wants a person, above the tabs — B1181, over B774.
 *
 * **It shows, and it cannot act.** The purchase half was true of B774's queue
 * and is true of all five kinds now: approval spends a single-use token that
 * was mailed to the operator, and `lib/credits.ts`'s property 1 is that
 * nothing reachable over HTTP raises a balance. Rendering that token here
 * would put a balance-raising credential into a browser tab, a screenshot and
 * a scrollback — exactly what B425 avoided by putting it in a mailbox — so it
 * is not selected by the query that feeds this, and there is no button.
 *
 * Empty is the ordinary state, says so, and carries the quiet facts. A band
 * that vanished when there was nothing in it would make *nothing needs you*
 * and *this page is broken* look alike, which is the same trap B1085 left
 * behind when the nightly backup mail stopped.
 *
 * This is the only red on the page. What is red behind a tab is red here too —
 * `HealthCard` still lists a fault on the Instance tab, deliberately, because
 * that card is the standing state of the instance and this is a list of jobs.
 */
function NeedsYou({ items, health }: { items: Attend[]; health: Health }) {
  if (items.length === 0) {
    return (
      <section className="mt-5 rounded-2xl border border-green-700 bg-green-100 p-4">
        <h2 className="font-display text-lg font-semibold text-green-700">Nothing needs you.</h2>
        <p className="mt-1 text-sm text-navy-700">
          Commit {health.commit ?? "unknown"} · up {Math.round(health.uptimeSeconds / 3600)}h
          {health.backupAgeHours !== null
            ? ` · backed up ${Math.round(health.backupAgeHours)}h ago`
            : ""}
          .
        </p>
      </section>
    );
  }
  return (
    <section className="mt-5 overflow-hidden rounded-2xl border border-coral-600 bg-white">
      <header className="flex items-center gap-2.5 border-b border-coral-100 bg-coral-50 px-4 py-3">
        <h2 className="font-display text-lg font-semibold text-coral-600">Needs you</h2>
        <span className="rounded-full bg-coral-600 px-2 py-0.5 font-mono text-xs font-semibold text-white">
          {items.length}
        </span>
      </header>
      <ul>
        {items.map((item) => (
          <li
            key={`${item.kind}-${item.title}`}
            className="flex flex-wrap items-start gap-x-3.5 gap-y-1 border-t border-navy-100 px-4 py-3 first:border-t-0"
          >
            <span className="mt-0.5 min-w-[5.5rem] rounded-md border border-navy-200 bg-navy-50 px-1.5 py-0.5 text-center font-mono text-[0.6875rem] font-semibold uppercase tracking-wide text-navy-600">
              {KIND_LABEL[item.kind]}
            </span>
            <span className="min-w-0 flex-1 basis-56">
              <strong className="break-words font-semibold text-navy-900">{item.title}</strong>
              <span className="mt-0.5 block text-sm text-navy-700">{item.detail}</span>
            </span>
            <span className="shrink-0 font-mono text-xs text-navy-500">{item.age}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Money
 * ------------------------------------------------------------------ */

/** The fixed monthly lines, summed — the floor stated beside the chart. */
function fixedRappen(fixed: CostLine[]): number {
  return fixed.reduce((sum, line) => sum + line.rappen, 0);
}

/**
 * The subtraction, done — B1181, over B996's four tiles.
 *
 * B996 put Out and In side by side and left the difference to the reader. The
 * page is opened to find out whether this is costing more than it takes, which
 * is one number and was on the page nowhere. The two halves stay beside it,
 * because a net figure with no sides to it cannot say which of them moved.
 *
 * The comparison under each half is **metered spend only** and says so: the
 * fixed monthly lines are nine tenths of this instance's bill and identical in
 * both windows, so including them would divide every real movement by ten and
 * report a tenth of it. The delta comes out of the ninety days the chart
 * already holds, which is why there is no second query for a previous period.
 *
 * The two tiles B996 had and this does not — *Waiting* and *Journals* — moved
 * rather than went: the queue is the band above the tabs, in full, and the
 * roster is the first line of the People tab.
 */
function Verdict({
  data,
  daily,
  paid,
}: {
  data: Awaited<ReturnType<typeof dashboard>>;
  daily: DailySpend[];
  paid: Payment[];
}) {
  const window = daily.slice(-WINDOW_DAYS);
  const before = daily.slice(-WINDOW_DAYS * 2, -WINDOW_DAYS);
  const now = window.reduce((sum, day) => sum + day.rappen, 0);
  const then = before.reduce((sum, day) => sum + day.rappen, 0);

  const cutoff = ago(WINDOW_DAYS).slice(0, 10);
  const takenBefore = takings(paid.filter((one) => (one.paidAt ?? "") < cutoff));

  const net = data.takenRappen - data.totalRappen;
  const perDay = Math.round(Math.abs(net) / WINDOW_DAYS);

  return (
    <section className="mt-6 flex flex-wrap items-end gap-x-10 gap-y-6">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-navy-600">
          Net, {WINDOW_DAYS} days
        </p>
        <p
          className={`font-display text-4xl font-semibold tabular-nums ${
            net < 0 ? "text-coral-600" : "text-green-700"
          }`}
        >
          {net < 0 ? `−${formatChf(-net)}` : formatChf(net)}
        </p>
        <p className="mt-1.5 text-sm text-navy-700">
          {net === 0
            ? "In and out came to the same."
            : `Running at ${net < 0 ? "a loss" : "a surplus"} of about `}
          {net === 0 ? null : (
            <>
              <span className="font-mono text-navy-900">{formatChf(perDay)}</span> a day.
            </>
          )}{" "}
          {/* A floor, never an invoice: an unpriced line contributes nothing
              to `totalRappen` and is flagged rather than guessed at. */}
          Out is a floor — anything the price list does not cover is counted and
          not priced.
        </p>
      </div>
      <div className="flex gap-7">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-navy-600">Taken in</p>
          <p className="font-mono text-lg font-semibold text-navy-900">
            {formatChf(data.takenRappen)}
          </p>
          <Delta now={data.takenRappen} then={takenBefore} what="takings" good />
        </div>
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-navy-600">Paid out</p>
          <p className="font-mono text-lg font-semibold text-navy-900">
            {formatChf(data.totalRappen)}
          </p>
          <Delta now={now} then={then} what="metered spend" />
        </div>
      </div>
    </section>
  );
}

/**
 * What one journal, one day and one conversation actually cost — B1181.
 *
 * A total says what last month cost. Whether a thirtieth journal is affordable
 * is this, and every figure is a division of something `dashboard()` already
 * returned — no query, no counter, no table.
 *
 * **Metered only, and per *active* journal rather than per journal.** Dividing
 * by the whole roster on an instance where half the names never wrote anything
 * reports a cost per person that no person has; the count beside it says which
 * denominator was used, because that is the part that makes the number mean
 * something.
 *
 * A denominator of zero prints an em dash rather than a division. "No days
 * were written" is a fact worth reading; `NaN` and `CHF 0.00` are both lies
 * about it.
 */
function Units({
  data,
  activity,
  helper,
  journals,
}: {
  data: Awaited<ReturnType<typeof dashboard>>;
  activity: Record<string, Activity>;
  helper: SessionStats[];
  journals: number;
}) {
  const metered = data.journals.reduce((sum, row) => sum + row.rappen, 0);
  const since = ago(WINDOW_DAYS);
  const active = Object.values(activity).filter(
    (one) => (one.lastWroteAt ?? "") >= since,
  ).length;
  const written = Object.values(activity).reduce((sum, one) => sum + one.recentDays, 0);
  const conversations = helper.reduce((sum, one) => sum + one.sessions, 0);
  const fixed = fixedRappen(data.fixed);

  const per = (total: number, count: number) =>
    count === 0 ? "—" : formatChf(Math.round(total / count));

  return (
    <section className="mt-8">
      <h2 className="font-display text-lg font-semibold text-navy-900">What a journal costs</h2>
      <p className="mt-1 text-sm text-navy-700">
        Metered spend over the same {WINDOW_DAYS} days, divided. These are the figures that say
        whether the next thirty journals are affordable.
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          label="Per active journal"
          value={per(metered, active)}
          note={
            <span className="text-xs text-navy-500">
              {active === 0 ? "nobody wrote this month" : `${active} wrote something`}
            </span>
          }
        />
        <Tile
          label="Per day written"
          value={per(metered, written)}
          note={
            <span className="text-xs text-navy-500">
              {written === 0 ? "no day is dated in the window" : `${written} days dated in it`}
            </span>
          }
        />
        <Tile
          label="Per conversation"
          value={per(metered, conversations)}
          note={
            <span className="text-xs text-navy-500">
              {conversations === 0 ? "no conversations" : `${conversations} with the helper`}
            </span>
          }
        />
        <Tile
          label="Fixed, per journal"
          value={per(fixed, journals)}
          note={<span className="text-xs text-navy-500">divided across all {journals}</span>}
        />
      </div>
    </section>
  );
}

function Tile({
  label,
  value,
  note,
  alert,
}: {
  label: string;
  value: string;
  note: React.ReactNode;
  alert?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border bg-white p-3 ${alert ? "border-coral-600" : "border-navy-200"}`}
    >
      <p
        className={`text-xs font-semibold uppercase tracking-wide ${alert ? "text-coral-600" : "text-navy-600"}`}
      >
        {label}
      </p>
      <p
        className={`font-display text-xl font-semibold ${alert ? "text-coral-600" : "text-navy-900"}`}
      >
        {value}
      </p>
      <div className="mt-0.5">{note}</div>
    </div>
  );
}

/**
 * The change against the window before, in words rather than an arrow alone.
 *
 * A percentage of nothing is not a percentage, so a previous window of zero
 * says "nothing before" instead of dividing by it — which is the ordinary case
 * on an instance where a feature has just been switched on.
 */
function Delta({
  now,
  then,
  what,
  good,
}: {
  now: number;
  then: number;
  what: string;
  good?: boolean;
}) {
  if (then === 0 && now === 0) {
    return <span className="text-xs text-navy-500">no {what} either month</span>;
  }
  if (then === 0) {
    return <span className="text-xs text-navy-500">no {what} the month before</span>;
  }
  const change = Math.round(((now - then) / then) * 100);
  const rising = change > 0;
  // Rising spend is bad news and rising takings are good news, so the caller
  // says which this is rather than the colour guessing from the sign.
  const tone = change === 0 ? "text-navy-500" : rising === Boolean(good) ? "text-green-700" : "text-coral-600";
  return (
    <span className={`text-xs font-semibold ${tone}`}>
      {change > 0 ? "▲" : change < 0 ? "▼" : "="} {Math.abs(change)}% {what}
    </span>
  );
}

/** What the model money bought, by feature — B996 (X1). */
function SpentOn({ operations }: { operations: { operation: string; rappen: number; calls: number }[] }) {
  return (
    <BarChart
      title="What the models were asked to do"
      bars={operations.map((row) => ({
        label: OPERATION_LABEL[row.operation] ?? row.operation,
        rappen: row.rappen,
        note: `${row.calls} ${row.calls === 1 ? "call" : "calls"}`,
      }))}
      empty="No metered calls in this period."
    />
  );
}

/** The other side of the ledger — B996 (X5). */
function TakingsPanel({ money, paid }: { money: Takings; paid: Payment[] }) {
  return (
    <section className="mt-8">
      <h2 className="font-display text-lg font-semibold text-navy-900">Taken</h2>
      <p className="mt-1 text-sm text-navy-700">
        Purchases settled in the last {WINDOW_DAYS} days, at what the buyer actually paid. A grant
        made from a journal&rsquo;s panel carries no price and is not takings.
      </p>
      <ul className="mt-3 divide-y divide-navy-200 border-t border-navy-200">
        {money.byMethod.map((row) => (
          <li key={row.method} className="flex items-baseline justify-between gap-3 py-2">
            <span className="text-sm text-navy-900">
              {row.method} · {row.count} {row.count === 1 ? "purchase" : "purchases"}
            </span>
            <span className="font-mono text-sm text-navy-900">{formatChf(row.rappen)}</span>
          </li>
        ))}
        <li className="flex items-baseline justify-between gap-3 py-2">
          <span className="text-sm text-navy-700">Waiting on you</span>
          <span className="font-mono text-sm text-navy-900">
            {formatChf(money.waitingRappen)}
            {money.waitingCount > 0 ? ` · ${money.waitingCount}` : ""}
          </span>
        </li>
        <li className="flex items-baseline justify-between gap-3 py-2">
          <span className="text-sm text-navy-700">Refunded</span>
          <span className="font-mono text-sm text-navy-900">{formatChf(money.refundedRappen)}</span>
        </li>
        <li className="flex items-baseline justify-between gap-3 py-2">
          <span className="text-sm text-navy-700">Given by hand</span>
          <span className="font-mono text-sm text-navy-900">
            {money.grantedCredits} credits
          </span>
        </li>
      </ul>
      {paid.length === 0 ? (
        <p className="mt-2 text-sm text-navy-500">Nothing was bought in this period.</p>
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Journals
 * ------------------------------------------------------------------ */

/**
 * One journal, behind its row — B996 (decision 6A).
 *
 * **The fifty ledger rows are gone.** They were the longest thing on the page
 * and answered a question — which exact transaction, on which day — that an
 * operator asks about once a quarter and that `credit_ledger` answers better
 * from a shell. What replaces them is the same money, rolled up: what it was
 * spent on, what was bought, what is left.
 *
 * Everything here was fetched once for the whole instance and handed in, so
 * thirty-five of these cost three queries rather than a hundred and five.
 */
function JournalPanel({
  username,
  status,
  ceiling,
  reasons,
  payments,
  helper,
}: {
  username: string;
  status: StatusRow | undefined;
  ceiling: number | null;
  reasons: { reason: string; credits: number }[];
  payments: Payment[];
  /** This journal's own conversations — B1181, moved down here from the
   *  instance-wide list it used to be a row of. Absent for a journal that has
   *  never used the helper, which is not the same as one that used it badly. */
  helper: SessionStats | undefined;
}) {
  const spent = reasons.reduce((sum, row) => sum + row.credits, 0);
  const settled = payments.filter((one) => one.status === "paid");
  const bought = settled.reduce((sum, one) => sum + one.amountRappen, 0);

  return (
    <div className="border-t border-navy-200">
      {status ? (
        <p className="px-4 pt-3 text-sm text-navy-700">
          {status.trips} {status.trips === 1 ? "trip" : "trips"} · {status.days}{" "}
          {status.days === 1 ? "day" : "days"}
          {status.drafts > 0 ? ` · ${status.drafts} draft` : ""}
          {status.drafts > 1 ? "s" : ""} · {status.contacts}{" "}
          {status.contacts === 1 ? "reader" : "readers"}
        </p>
      ) : null}

      {status && ceiling ? (
        <div className="px-4 pt-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-navy-600">
              Disk
            </span>
            <span className="font-mono text-sm text-navy-900">
              {formatBytes(status.bytes)} of {formatBytes(ceiling)}
            </span>
          </div>
          <Meter
            fraction={status.bytes / ceiling}
            tone={status.bytes / ceiling > 0.9 ? "alert" : "navy"}
          />
        </div>
      ) : null}

      {reasons.length > 0 ? (
        <div className="px-4 pt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-navy-600">
            Credits went on
          </p>
          <ul className="mt-1 space-y-1.5">
            {reasons.map((row) => (
              <li key={row.reason}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm text-navy-900">{REASON_LABEL[row.reason] ?? row.reason}</span>
                  <span className="font-mono text-sm text-navy-900">
                    {formatCredits(row.credits)}
                  </span>
                </div>
                <Meter fraction={row.credits / Math.max(spent, 1)} />
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {helper ? (
        <div className="px-4 pt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-navy-600">
            Conversations
          </p>
          <p className="mt-1 text-sm text-navy-900">
            <span className="font-mono">
              {helper.pressed}/{helper.proposed}
            </span>{" "}
            proposals pressed · {helper.turns} turns over {helper.sessions} conversation
            {helper.sessions === 1 ? "" : "s"}
            {helper.refused > 0 ? ` · ${helper.refused} refused` : ""}
          </p>
          {helper.guards.length > 0 ? (
            <p className="mt-0.5 font-mono text-xs text-coral-600">
              {helper.guards.map((one) => `${one.guard} ${one.count}`).join(" · ")}
            </p>
          ) : null}
          {/* No words, ever — B976. Whether they could be read at all is a
              separate permission, and saying which it is here is the whole of
              what this panel may say about them. */}
          <p className="mt-0.5 text-xs text-navy-500">
            {helper.readable
              ? "No words here. Reading them is a separate permission."
              : "Words not shared by this journal."}
          </p>
        </div>
      ) : null}

      <Purchases username={username} payments={payments} settled={settled.length} bought={bought} />
      <AdminGrant journal={username} />
    </div>
  );
}

/** The ledger's own vocabulary, in the operator's words. Unknown reasons fall
 *  through to their own name rather than disappearing. */
const REASON_LABEL: Record<string, string> = {
  day_mail: "Announcing a day by email",
  day_whatsapp: "Announcing a day on WhatsApp",
  digest: "A digest",
  postcard: "Printed postcards",
  photobook: "Photobooks",
  photobook_print: "Printing a photobook",
  storage: "Extra disk",
  helper: "The helper",
  transcription: "Transcribing speech",
  refunded: "Given back (failed calls)",
};

/**
 * One journal's purchases, and the only place a refund can be recorded — B878.
 *
 * Settled purchases carry a button; everything else is shown with its status
 * and nothing to press. A refunded row keeps its place in the list rather than
 * disappearing: the question this section answers is "what has this person
 * paid me", and a purchase that was given back is part of that answer.
 *
 * B996 capped it at the most recent handful and put a total above them — the
 * whole history of a journal that has bought fifteen times is a list nobody
 * reads, and the total is the part that was being looked for.
 */
function Purchases({
  username,
  payments,
  settled,
  bought,
}: {
  username: string;
  payments: Payment[];
  settled: number;
  bought: number;
}) {
  if (payments.length === 0) return null;
  return (
    <div className="px-4 pt-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-wide text-navy-600">
          Purchases
        </span>
        <span className="font-mono text-sm text-navy-900">
          {settled} paid · {formatChf(bought)}
        </span>
      </div>
      <ul className="mt-1 divide-y divide-navy-200">
        {payments.slice(0, 5).map((payment) => (
          <li key={payment.id} className="py-2">
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 break-words text-sm text-navy-900">
                {payment.credits} credits
              </span>
              <span className="shrink-0 font-mono text-sm text-navy-900">
                {payment.method === "admin" ? "by hand" : formatChf(payment.amountRappen)}
              </span>
            </div>
            <p className="mt-0.5 [overflow-wrap:anywhere] font-mono text-xs text-navy-500">
              {payment.status}
              {` · ${(payment.paidAt ?? payment.createdAt).slice(0, 10)}`}
            </p>
            {payment.status === "paid" ? (
              <AdminRefund
                username={username}
                payment={payment.id}
                amount={formatChf(payment.amountRappen)}
                credits={payment.credits}
              />
            ) : null}
          </li>
        ))}
      </ul>
      {payments.length > 5 ? (
        <p className="pb-1 text-xs text-navy-500">
          {payments.length - 5} older, not shown.
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * People
 * ------------------------------------------------------------------ */

/**
 * How far the people who arrived got — B1181.
 *
 * The drop-off is written between the steps rather than under them, because
 * that is where it happened and because a list of four counts is a list
 * somebody has to subtract. The last bar carries the brand's yellow: it is the
 * only step that is an outcome rather than a stage, and it is the number this
 * whole page is in aid of.
 *
 * `null` is not zero and does not render as a funnel: an instance with no
 * database cannot say who arrived when, and four zeroes would be a claim that
 * nobody did.
 */
function Funnel({ steps, signups }: { steps: FunnelStep[] | null; signups: Week[] }) {
  return (
    <section className="mt-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-lg font-semibold text-navy-900">
          Does anybody get through
        </h2>
        <span className="font-mono text-sm text-navy-500">last {CHART_DAYS} days</span>
      </div>
      <p className="mt-1 text-sm text-navy-700">
        Every journal started in the window, and how far each one got. Cohorted by when they
        arrived, so a bad first year does not follow the instance around for ever.
      </p>
      {steps === null ? (
        <p className="mt-3 text-sm text-navy-500">
          There is no database on this instance, so there is no record of who arrived when. The
          journals themselves are below.
        </p>
      ) : steps[0].count === 0 ? (
        <p className="mt-3 text-sm text-navy-500">
          Nobody has started a journal in the last {CHART_DAYS} days.
        </p>
      ) : (
        <div className="mt-3 rounded-2xl border border-navy-200 bg-white p-4">
          {steps.map((step, at) => (
            <div key={step.label}>
              {at > 0 && step.lost.startsWith("0 ") ? null : at > 0 ? (
                <p className="py-1 font-mono text-xs text-coral-600">▼ {step.lost}</p>
              ) : null}
              <div className="flex items-center gap-3">
                <span className="w-28 shrink-0 text-xs font-semibold uppercase tracking-wide text-navy-600 sm:w-36">
                  {step.label}
                </span>
                {/* One measure, one hue — `Charts.tsx`'s rule, and these four
                    bars are four lengths of one thing. The last step is the
                    outcome and it was drawn in the brand's yellow for a
                    while; that is a waymark rather than a measure, and the
                    same note in `Charts.tsx` says so. */}
                <span className="h-7 flex-1 overflow-hidden rounded-md bg-navy-100">
                  <span
                    className="block h-full bg-navy-700"
                    style={{ width: `${Math.round((step.count / steps[0].count) * 100)}%` }}
                  />
                </span>
                <span className="w-10 shrink-0 text-right font-mono text-sm font-semibold text-navy-900">
                  {step.count}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
      <CountBars
        title="Journals started"
        weeks={signups}
        unit="journals"
        empty="Nobody has signed up in this quarter."
      />
    </section>
  );
}

/**
 * What the helper did, at instance scale — B1181, over B976.
 *
 * **`pressed` against `proposed` is the clearest failure signal this product
 * has**, and it was the last list on the third tab, one row per owner, with no
 * instance figure and no direction. A proposal made and never pressed is
 * somebody who described their day to a machine and did not get a day out of
 * it.
 *
 * The per-owner rows are not gone — they moved into the journal's own panel,
 * where they are about a person rather than a column. **No words, ever**:
 * those are the owner's, and reading them is a separate permission.
 */
function HelperSummary({ stats }: { stats: SessionStats[] }) {
  if (stats.length === 0) return null;
  const proposed = stats.reduce((sum, one) => sum + one.proposed, 0);
  const pressed = stats.reduce((sum, one) => sum + one.pressed, 0);
  const refused = stats.reduce((sum, one) => sum + one.refused, 0);
  const sessions = stats.reduce((sum, one) => sum + one.sessions, 0);
  const guards = new Map<string, number>();
  for (const stat of stats) {
    for (const one of stat.guards) guards.set(one.guard, (guards.get(one.guard) ?? 0) + one.count);
  }
  const fires = [...guards].sort((a, b) => b[1] - a[1]);
  const total = fires.reduce((sum, [, count]) => sum + count, 0);

  return (
    <section className="mt-8">
      <h2 className="font-display text-lg font-semibold text-navy-900">The helper</h2>
      <p className="mt-1 text-sm text-navy-700">
        The last {WINDOW_DAYS} days. A proposal that was never pressed is somebody who described
        their day and did not get one.
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          label="Proposals pressed"
          value={proposed === 0 ? "—" : `${Math.round((pressed / proposed) * 100)}%`}
          note={
            <span className="text-xs text-navy-500">
              {proposed === 0 ? "nothing was proposed" : `${pressed} of ${proposed}`}
            </span>
          }
        />
        <Tile
          label="Conversations"
          value={String(sessions)}
          note={
            <span className="text-xs text-navy-500">
              across {stats.length} {stats.length === 1 ? "journal" : "journals"}
            </span>
          }
        />
        <Tile
          label="Guard fires"
          value={String(total)}
          alert={total > 0}
          note={
            <span className="font-mono text-xs text-navy-500">
              {fires.length === 0
                ? "nothing was caught"
                : fires
                    .slice(0, 2)
                    .map(([guard, count]) => `${guard} ${count}`)
                    .join(" · ")}
            </span>
          }
        />
        <Tile
          label="Refused outright"
          value={String(refused)}
          note={<span className="text-xs text-navy-500">a write the server would not make</span>}
        />
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Instance
 * ------------------------------------------------------------------ */

/**
 * What is wrong, and nothing else — B996 (decision 7B).
 *
 * A strip of six green lines is read once and then skimmed past for ever,
 * including on the day one of them turns red. This card is a single green line
 * when the instance is well and grows entries when it is not, so there is
 * nothing to skim on an ordinary day and nothing to miss on a bad one.
 *
 * Capabilities the operator switched off are named on the quiet line rather
 * than listed as faults: *off because nobody asked for it* and *off although
 * somebody did* are opposite facts, and `lib/adminConsole.ts` is where the
 * difference is drawn.
 */
function HealthCard({ health, troubles }: { health: Health; troubles: Trouble[] }) {
  const clear = health.wrong.length === 0 && troubles.length === 0;
  return (
    <section className="mt-6">
      <h2 className="font-display text-lg font-semibold text-navy-900">This instance</h2>
      {clear ? (
        <div className="mt-2 rounded-2xl border border-green-700 bg-green-100 p-4">
          <p className="font-display font-semibold text-green-700">Nothing is wrong.</p>
          <p className="mt-1 text-sm text-navy-700">
            Commit {health.commit ?? "unknown"} · up{" "}
            {Math.round(health.uptimeSeconds / 3600)}h
            {health.backupAgeHours !== null
              ? ` · backed up ${Math.round(health.backupAgeHours)}h ago`
              : ""}
            {offSummary(health.offByChoice)}.
          </p>
        </div>
      ) : (
        <ul className="mt-2 space-y-2">
          {health.wrong.map((one) => (
            <li
              key={one.title}
              className="rounded-2xl border border-coral-600 bg-white p-3 [overflow-wrap:anywhere]"
            >
              <p className="font-semibold text-coral-600">{one.title}</p>
              <p className="mt-0.5 text-sm text-navy-700">{one.detail}</p>
            </li>
          ))}
          {troubles.map((one) => (
            <li key={`${one.what}-${one.owner}-${one.when}`} className="rounded-2xl border border-navy-200 bg-white p-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-semibold text-navy-900">{one.what}</span>
                <span className="shrink-0 font-mono text-xs text-navy-500">{one.when}</span>
              </div>
              <p className="mt-0.5 text-sm text-navy-700">
                {one.owner ? `${one.owner} · ` : ""}
                {one.detail}
              </p>
            </li>
          ))}
          <li className="text-xs text-navy-500">
            Commit {health.commit ?? "unknown"} · up {Math.round(health.uptimeSeconds / 3600)}h
            {offSummary(health.offByChoice)}
          </li>
        </ul>
      )}
      <BackupPanel backup={health.backup} />
    </section>
  );
}

/**
 * When the backup last worked, said positively.
 *
 * B1085 stopped the nightly "it worked" mail on the operator's request. The
 * card above already shouts when a backup is stale, failing or has never been
 * recorded — those are `wrong` entries and they are red. What went away with
 * the mail is the *other* half: the standing evidence that the thing runs at
 * all. An empty fault list is silence, and silence is exactly what a broken
 * alarm also sounds like — this deployment has already spent two days that way
 * (B138), which is why B458 added the success mail in the first place.
 *
 * So this states the good case out loud, with a date on it. It is deliberately
 * always rendered, including when everything is fine: a panel that appears
 * only on trouble is one more thing whose absence means two different things.
 *
 * The state word carries the colour, so it reads at a glance rather than being
 * arithmetic the operator does on a timestamp at 2am.
 */
function BackupPanel({ backup }: { backup: Health["backup"] }) {
  const tone = stateTone(backup.state);
  const when = backup.lastSuccessAt
    ? `${backup.lastSuccessAt.slice(0, 16).replace("T", " ")} UTC`
    : "never";
  const offsite = backup.secondary;
  const offsiteWhen = offsite.lastSuccessAt
    ? `${offsite.lastSuccessAt.slice(0, 16).replace("T", " ")} UTC`
    : "never";
  return (
    <div className="mt-3 rounded-2xl border border-navy-200 bg-white p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-display font-semibold text-navy-900">Backups</h3>
        <span
          className={`rounded-full border px-2.5 py-0.5 font-mono text-xs font-semibold ${tone}`}
        >
          {backup.state}
        </span>
      </div>
      <p className="mt-1 text-sm text-navy-700">
        Last success {when}
        {backup.ageHours !== null ? ` · ${Math.round(backup.ageHours)}h ago` : ""} · stale past{" "}
        {backup.maxAgeHours}h
      </p>
      {backup.lastFailure && (
        <p className="mt-1 text-sm text-coral-600 [overflow-wrap:anywhere]">
          Last failure {backup.lastFailureAt?.slice(0, 16).replace("T", " ") ?? "unknown"} ·{" "}
          {backup.lastFailure}
        </p>
      )}
      <div className="mt-3 border-t border-navy-100 pt-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h4 className="font-display font-semibold text-navy-900">Off-site copy</h4>
          <span
            className={`rounded-full border px-2.5 py-0.5 font-mono text-xs font-semibold ${stateTone(offsite.state)}`}
          >
            {offsite.state}
          </span>
        </div>
        <p className="mt-1 text-sm text-navy-700">
          Last success {offsiteWhen}
          {offsite.ageHours !== null ? ` · ${Math.round(offsite.ageHours)}h ago` : ""} · stale past{" "}
          {offsite.maxAgeHours}h
        </p>
        {offsite.reason && (
          <p className="mt-1 text-sm text-navy-500 [overflow-wrap:anywhere]">{offsite.reason}</p>
        )}
      </div>
      <p className="mt-2 text-xs text-navy-500">
        A run that works no longer sends mail; this is where it says so. A run that fails still
        mails.
      </p>
    </div>
  );
}

/**
 * One state word, one colour, for both halves of the backup panel — B1174.
 *
 * The off-site copy used to be a line of the faintest type on the card with no
 * colour at all, so `stale` and `ok` were the same grey and told apart only by
 * reading a timestamp. It is a sibling fact, not a footnote: since B1159 it is
 * the copy with the seven-day floor, and it is the only one that survives
 * losing the machine.
 *
 * `unknown` is navy rather than coral on purpose. On the secondary it means
 * both "never configured" — a legitimate choice — and "configured and never
 * once succeeded", and nothing on disk separates them. Red for a deliberate
 * configuration is an alarm that gets ignored; see the note in
 * `lib/adminConsole.ts`.
 */
function stateTone(state: "ok" | "stale" | "failing" | "unknown"): string {
  if (state === "ok") return "border-green-700 text-green-700";
  if (state === "unknown") return "border-navy-300 text-navy-700";
  return "border-coral-600 text-coral-600";
}

/**
 * The capabilities the operator switched off, without four lines of them.
 *
 * A development instance has almost everything off and the full list wrapped
 * across the whole card, which buried the fault above it. Naming a few and
 * counting the rest keeps the sentence one line at 390px: knowing *that*
 * eleven are off is the operator's own decision recalled, not news.
 */
function offSummary(off: string[]): string {
  if (off.length === 0) return "";
  const named = off.slice(0, 3).join(", ");
  const rest = off.length - 3;
  return ` · ${named}${rest > 0 ? ` and ${rest} more` : ""} off by choice`;
}

/**
 * What the instance did for people — B996 (X3).
 *
 * The only panel here that is not about money, and the reason the rest of it
 * matters: a bill with nothing on the other side of it is just a bill. Days
 * are dated by the day they describe rather than the moment they were typed,
 * which is the date the filename carries and the one a journal is about.
 *
 * Named for what it says rather than for what it is, since B1181: `Activity`
 * is now a type in `lib/adminConsole.ts` about one journal, and two things
 * called that in one file is how somebody imports the wrong one.
 */
function WhatItDid({
  days,
  sends,
  print,
}: {
  days: Week[];
  sends: Week[];
  print: { calls: number }[];
}) {
  const printed = print.reduce((sum, line) => sum + line.calls, 0);
  return (
    <section className="mt-8">
      <h2 className="font-display text-lg font-semibold text-navy-900">What it did</h2>
      <p className="mt-1 text-sm text-navy-700">
        The last {WEEKS} weeks. Days are counted by the day they describe, which is the date the
        file is named for.
      </p>
      <CountBars
        title="Days written"
        weeks={days}
        unit="days"
        empty="No day in this quarter is dated in it."
      />
      <CountBars
        title="Announcements sent"
        weeks={sends}
        unit="sent"
        empty="Nothing has been announced to a reader."
      />
      <p className="mt-3 text-sm text-navy-700">
        {printed === 0
          ? "Nothing has been printed in the costing window."
          : `${printed} ${printed === 1 ? "thing" : "things"} printed in the last ${WINDOW_DAYS} days.`}
      </p>
    </section>
  );
}

/**
 * What is on this instance, in three lines — B996 (X4), narrowed by B1181.
 *
 * A journal that has never written a day is not a failure and not a fault; it
 * is a fact worth knowing before reading any per-journal average, and on an
 * instance whose names include half a dozen tests it is most of the roster.
 *
 * The signup bars this used to carry are on the People tab now, beside the
 * funnel they are the first step of. What is left is the standing shape of the
 * instance, which is what the Instance tab is.
 */
function Roster({ report, stones }: { report: { journals: StatusRow[] }; stones: number }) {
  const empty = report.journals.filter((row) => row.days === 0).length;
  return (
    <section className="mt-8">
      <h2 className="font-display text-lg font-semibold text-navy-900">Roster</h2>
      <ul className="mt-3 divide-y divide-navy-200 border-t border-navy-200">
        <li className="flex items-baseline justify-between gap-3 py-2">
          <span className="text-sm text-navy-700">Journals</span>
          <span className="font-mono text-sm text-navy-900">{report.journals.length}</span>
        </li>
        <li className="flex items-baseline justify-between gap-3 py-2">
          <span className="text-sm text-navy-700">Never wrote a day</span>
          <span className="font-mono text-sm text-navy-900">{empty}</span>
        </li>
        <li className="flex items-baseline justify-between gap-3 py-2">
          <span className="text-sm text-navy-700">Deleted, name still held</span>
          <span className="font-mono text-sm text-navy-900">{stones}</span>
        </li>
      </ul>
    </section>
  );
}
