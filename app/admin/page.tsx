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
import { dailyCosts, dashboard, journalDaily, type DailySpend } from "@/lib/instanceCosts";
import {
  allTombstones,
  daysByWeek,
  health,
  paymentsByOwner,
  sendsByWeek,
  signupsByWeek,
  snapshot,
  spendByReasonAll,
  takingsBreakdown,
  troubles,
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
  ]);

  const metered = creditsEnabled();
  const money = takingsBreakdown(data.paid, data.awaiting);
  const stones = allTombstones();
  const byName = new Map(report.journals.map((row) => [row.username, row]));
  const ceiling = loadServerConfig().media.perUserBytes;

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

      {/* First on the page, above the money and outside the tabs, because it is
          the only thing here that is a person waiting rather than a number to
          read. Until B774 the sole signal that a purchase needed approving was
          a mail — which is a queue whose length you cannot see. */}
      <Awaiting payments={data.awaiting} />

      <Console
        tabs={[
          {
            id: "money",
            label: "Money",
            panel: (
              <>
                <Tiles
                  data={data}
                  daily={daily}
                  paid={paidTwoMonths}
                  journals={report.journals.length}
                  signups={signups}
                />
                <SpendChart days={daily} />
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
            id: "journals",
            label: "Journals",
            panel: (
              <>
                <section className="mt-6">
                  <h2 className="font-display text-lg font-semibold text-navy-900">Journals</h2>
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
                      panel: (
                        <JournalPanel
                          username={journal.username}
                          status={byName.get(journal.username)}
                          ceiling={ceiling}
                          reasons={byReason[journal.username] ?? []}
                          payments={purchases[journal.username] ?? []}
                        />
                      ),
                    }))}
                  />
                </section>
                <Storage journals={report.journals} ceiling={ceiling} measuredAt={measuredAt} />
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
                <Activity days={days} sends={sends} print={data.print} />
                <Growth signups={signups} report={report} stones={stones.length} />
                <Helper stats={helper} />
              </>
            ),
          },
        ]}
      />
    </main>
  );
}

/* ------------------------------------------------------------------ *
 * The queue
 * ------------------------------------------------------------------ */

/**
 * The approval queue — B774.
 *
 * **It shows, and it cannot approve.** Approval spends a single-use token that
 * was mailed to the operator, and `lib/credits.ts`'s property 1 is that
 * nothing reachable over HTTP raises a balance. Rendering the token here would
 * put a balance-raising credential into a browser tab, a screenshot and a
 * scrollback — exactly what B425 avoided by putting it in a mailbox — so it is
 * not selected by the query that feeds this, and there is no button.
 *
 * Empty is the ordinary state and says so. A section that vanished when there
 * was nothing in it would make "no queue" and "no such feature" look alike.
 */
function Awaiting({ payments }: { payments: Payment[] }) {
  if (payments.length === 0) {
    return (
      <p className="mt-5 rounded-2xl border border-navy-200 bg-white p-4 text-sm text-navy-500">
        Nothing is waiting for your approval.
      </p>
    );
  }
  return (
    <section className="mt-5 rounded-2xl border border-navy-200 border-l-8 border-l-yellow-400 bg-white p-4">
      <h2 className="font-display text-lg font-semibold text-navy-900">
        Waiting for you ({payments.length})
      </h2>
      <p className="mt-1 text-sm text-navy-700">
        Each of these was mailed to you with a link that approves it. That link is what adds the
        credits — this page only shows that somebody is waiting.
      </p>
      <ul className="mt-3 divide-y divide-navy-200 border-t border-navy-200">
        {payments.map((payment) => (
          <li key={payment.id} className="py-2">
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 break-words text-sm text-navy-900">
                {payment.owner} · {payment.credits} credits
              </span>
              <span className="shrink-0 font-mono text-sm text-navy-900">
                {/* An admin grant has no price, and "CHF 0.00" would read as a
                    purchase somebody got for nothing. */}
                {payment.method === "admin" ? "by hand" : formatChf(payment.amountRappen)}
              </span>
            </div>
            <p className="mt-0.5 [overflow-wrap:anywhere] font-mono text-xs text-navy-500">
              asked {(payment.requestedAt ?? payment.createdAt).slice(0, 16).replace("T", " ")}
              {payment.method && payment.method !== "admin" ? ` · ${payment.method}` : ""}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Money
 * ------------------------------------------------------------------ */

/**
 * The four numbers, and which way each is moving — B996 (decision 2B).
 *
 * A figure on its own is read; a figure with a direction is acted on. The
 * comparison is **metered spend only** and says so: the fixed monthly lines
 * are nine tenths of this instance's bill and identical in both windows, so
 * including them would divide every real movement by ten and report a tenth of
 * it.
 *
 * The delta comes out of the ninety days the chart already holds, which is why
 * there is no second query for a previous period.
 */
function Tiles({
  data,
  daily,
  paid,
  journals,
  signups,
}: {
  data: Awaited<ReturnType<typeof dashboard>>;
  daily: DailySpend[];
  paid: Payment[];
  journals: number;
  signups: Week[];
}) {
  const window = daily.slice(-WINDOW_DAYS);
  const before = daily.slice(-WINDOW_DAYS * 2, -WINDOW_DAYS);
  const now = window.reduce((sum, day) => sum + day.rappen, 0);
  const then = before.reduce((sum, day) => sum + day.rappen, 0);

  const cutoff = ago(WINDOW_DAYS).slice(0, 10);
  const takenBefore = takings(paid.filter((one) => (one.paidAt ?? "") < cutoff));

  const oldest = data.awaiting[0];
  const recent = signups.slice(-4).reduce((sum, week) => sum + week.count, 0);

  return (
    <div className="mt-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
      <Tile
        label="Out"
        value={formatChf(data.totalRappen)}
        note={<Delta now={now} then={then} what="metered spend" />}
      />
      <Tile
        label="In"
        value={formatChf(data.takenRappen)}
        note={<Delta now={data.takenRappen} then={takenBefore} what="takings" good />}
      />
      <Tile
        label="Waiting"
        value={String(data.awaiting.length)}
        alert={data.awaiting.length > 0}
        note={
          oldest ? (
            <span className="text-xs text-navy-500">
              oldest {(oldest.requestedAt ?? oldest.createdAt).slice(0, 10)}
            </span>
          ) : (
            <span className="text-xs text-navy-500">nothing to approve</span>
          )
        }
      />
      <Tile
        label="Journals"
        value={String(journals)}
        note={
          <span className="text-xs text-navy-500">
            {recent === 0 ? "none new in a month" : `+${recent} in a month`}
          </span>
        }
      />
    </div>
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
}: {
  username: string;
  status: StatusRow | undefined;
  ceiling: number | null;
  reasons: { reason: string; credits: number }[];
  payments: Payment[];
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

/**
 * Disk, per journal — B996 (X2).
 *
 * The one cost that grows on its own and the one nobody notices until an
 * upload is refused. The figures come from the cached instance snapshot rather
 * than from a walk per request: `collectStatus()` reads every day file and
 * every directory under `content/`, which is the most expensive call in this
 * codebase and is not a thing to do on a page load. The page says when it was
 * measured, because a number whose age is hidden is a number you cannot trust.
 */
function Storage({
  journals,
  ceiling,
  measuredAt,
}: {
  journals: StatusRow[];
  ceiling: number | null;
  measuredAt: number;
}) {
  const total = journals.reduce((sum, row) => sum + row.bytes, 0);
  const biggest = [...journals].sort((a, b) => b.bytes - a.bytes).slice(0, 8);

  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-lg font-semibold text-navy-900">Disk</h2>
        <span className="font-mono text-sm text-navy-900">
          {formatBytes(total)} across {journals.length}
        </span>
      </div>
      <p className="mt-1 text-xs text-navy-500">
        Measured {new Date(measuredAt).toISOString().slice(11, 16)} UTC. Walking the whole of
        content/ is the slowest thing this page can do, so it is held for five minutes.
      </p>
      <ul className="mt-3 space-y-2">
        {biggest.map((row) => (
          <li key={row.username}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 break-words text-sm text-navy-700">{row.username}</span>
              <span className="shrink-0 font-mono text-sm text-navy-900">
                {formatBytes(row.bytes)}
                {ceiling ? ` of ${formatBytes(ceiling)}` : ""}
              </span>
            </div>
            {ceiling ? (
              <Meter
                fraction={row.bytes / ceiling}
                tone={row.bytes / ceiling > 0.9 ? "alert" : "navy"}
              />
            ) : null}
          </li>
        ))}
      </ul>
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
 */
function Activity({
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
 * Who arrived, and who never started — B996 (X4).
 *
 * A journal that has never written a day is not a failure and not a fault; it
 * is a fact worth knowing before reading any per-journal average, and on an
 * instance whose names include half a dozen tests it is most of the roster.
 */
function Growth({
  signups,
  report,
  stones,
}: {
  signups: Week[];
  report: { journals: StatusRow[] };
  stones: number;
}) {
  const empty = report.journals.filter((row) => row.days === 0).length;
  return (
    <section className="mt-8">
      <h2 className="font-display text-lg font-semibold text-navy-900">Who is here</h2>
      <CountBars
        title="Journals started"
        weeks={signups}
        unit="journals"
        empty="Nobody has signed up in this quarter."
      />
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

/**
 * What the conversations did — B976, and the reason any of this is kept.
 *
 * **No words here, ever.** `proposed` against `pressed` is the number this was
 * built for: a proposal made and never pressed is the clearest failure signal
 * this product has, and until B976 nothing counted it. The guards beside it
 * were three process-global integers that reset on every restart, so "is that
 * fix working" was a question only a person driving the live site could
 * answer.
 */
function Helper({ stats }: { stats: SessionStats[] }) {
  if (stats.length === 0) return null;
  return (
    <section className="mt-8">
      <h2 className="font-display text-lg font-semibold text-navy-900">Conversations</h2>
      <p className="mt-1 text-sm text-navy-700">
        What the helper was asked and what came of it. No words — those are the owner&rsquo;s, and
        reading them is a separate permission.
      </p>
      <ul className="mt-2 divide-y divide-navy-200 border-t border-navy-200">
        {stats.map((stat) => (
          <li key={stat.owner} className="py-2">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-display font-semibold text-navy-900">{stat.owner}</span>
              <span className="font-mono text-sm tabular-nums text-navy-700">
                {stat.pressed}/{stat.proposed} pressed
              </span>
            </div>
            <p className="mt-0.5 text-sm text-navy-600">
              {stat.turns} turns over {stat.sessions} conversation
              {stat.sessions === 1 ? "" : "s"}
              {stat.refused > 0 ? ` · ${stat.refused} refused` : ""}
              {stat.readable ? "" : " · words not shared"}
            </p>
            {stat.guards.length > 0 && (
              <p className="mt-0.5 font-mono text-xs text-coral-600">
                {stat.guards.map((one) => `${one.guard} ${one.count}`).join(" · ")}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
