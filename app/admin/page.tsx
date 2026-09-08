import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import AdminGrant from "./AdminGrant";
import Journals from "./Journals";
import AdminRefund from "./AdminRefund";
import { isInstanceAdmin } from "@/lib/adminGate";
import { creditsEnabled, ledgerFor } from "@/lib/credits";
import { formatChf } from "@/lib/credits/pricing";
import { BarChart, DailyChart } from "./Charts";
import { dailyCosts, dashboard, type CostLine } from "@/lib/instanceCosts";
import { listPayments, type Payment } from "@/lib/payments";
import { serverSite } from "@/lib/site";
import { sessionStats, type SessionStats } from "@/lib/helper/sessions";

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

function since(): string {
  return new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

/** What a group of lines comes to. The charts and the total read the same
 *  numbers the rows do, so nothing on this page can disagree with itself. */
function sum(lines: CostLine[]): number {
  return lines.reduce((total, line) => total + line.rappen, 0);
}

/**
 * One group of cost lines — B763, replacing the table B746 shipped.
 *
 * A `<table>` of four columns needs about 36rem before the last one stops
 * wrapping, so on a phone it became a side-scrolling pane whose right-hand
 * edge held the cost — the one number anybody opened this page for. These are
 * the same fields stacked: the name and the money on one line, because that is
 * the pair being read, and the smaller facts under them.
 *
 * `<ul>` rather than `<table>` because it stopped being a table the moment it
 * stopped being a grid; a table whose rows reflow into blocks is a table only
 * to a screen reader, and a misleading one.
 */
function Lines({ title, lines, note }: { title: string; lines: CostLine[]; note?: string }) {
  return (
    <section className="mt-8">
      <h2 className="font-display text-lg font-semibold text-navy-900">{title}</h2>
      {note ? <p className="mt-1 text-sm text-navy-700">{note}</p> : null}
      {lines.length === 0 ? (
        <p className="mt-2 text-sm text-navy-500">Nothing in this period.</p>
      ) : (
        <ul className="mt-2 divide-y divide-navy-200 border-t border-navy-200">
          {lines.map((line) => (
            <li key={`${line.label}-${line.detail}`} className="py-2">
              <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 break-words text-sm text-navy-900">{line.label}</span>
                <span className="shrink-0 font-mono text-sm text-navy-900">
                  {/* An unpriced line says so rather than showing a zero that
                      would read as "this was free". */}
                  {line.unpriced ? (
                    <span className="text-navy-500">not priced</span>
                  ) : (
                    formatChf(line.rappen)
                  )}
                </span>
              </div>
              <p className="mt-0.5 [overflow-wrap:anywhere] font-mono text-xs text-navy-500">
                {line.detail}
                {line.calls > 0 ? ` · ${line.calls} ${line.calls === 1 ? "call" : "calls"}` : ""}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * What this instance costs to run — B746.
 *
 * **404 for everybody who is not the operator, including when there is no
 * operator.** `FERNSCOUT_ADMIN_EMAIL` unset means `isInstanceAdmin` is false
 * for every address, so an instance that has not set it behaves exactly as
 * though this page were not in the build — the same promise `lib/admin.ts`
 * makes. `notFound()` rather than a 403: a page that says "forbidden" has
 * told a stranger the operator dashboard is at this address.
 *
 * Every number here is measured. Where a price is missing the line says so
 * rather than showing a zero, and the two groups that cannot honestly be
 * priced at all — WhatsApp, which Meta bills per conversation and per country,
 * and mail, which costs nothing per message — are shown as volumes with the
 * reason beside them. A total that quietly included a guess would be worse
 * than a total that is explicitly a floor.
 */
/**
 * One line per journal: how much talking, how much of it landed, and what the
 * honesty net caught — B976.
 *
 * `read` says whether that journal's owner has let their words be read. It is
 * shown rather than acted on here: this page holds no prose either way, and
 * the flag is what a later screen would have to obey.
 */
function Helper({ stats }: { stats: SessionStats[] }) {
  if (stats.length === 0) return null;
  return (
    <section className="mt-10 border-t border-navy-200 pt-6">
      <h2 className="font-display text-lg font-semibold text-navy-900">Conversations</h2>
      <p className="mt-1 text-sm text-navy-700">
        What the helper was asked and what came of it. No words — those are the
        owner&rsquo;s, and reading them is a separate permission.
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
              <p className="mt-0.5 font-mono text-xs text-coral-700">
                {stat.guards.map((one) => `${one.guard} ${one.count}`).join(" · ")}
              </p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

export default async function AdminPage() {
  if (!(await isInstanceAdmin())) notFound();

  const siteName = serverSite().name;
  const from = since();
  const [data, daily] = await Promise.all([dashboard(from), dailyCosts(from, WINDOW_DAYS)]);
  const metered = creditsEnabled();

  return (
    <main className="mx-auto max-w-4xl px-4 py-10 sm:py-16">
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
      <p className="mt-3 text-navy-700">
        What this instance has cost over the last {WINDOW_DAYS} days, and what each journal holds.
      </p>

      {/* First on the page, above the money, because it is the only thing here
          that is a person waiting rather than a number to read. Until B774 the
          sole signal that a purchase needed approving was a mail — which is a
          queue whose length you cannot see. */}
      <Awaiting payments={data.awaiting} />

      <p className="mt-6 rounded-2xl border border-navy-200 bg-cream-100 p-4 text-navy-900">
        <span className="font-display text-2xl font-semibold">{formatChf(data.totalRappen)}</span>
        <span className="ml-2 font-mono text-sm text-navy-700">
          out · {formatChf(data.takenRappen)} in
        </span>
        <span className="mt-1 block text-sm text-navy-700">
          Everything priced below, including the fixed monthly lines. Lines marked{" "}
          <em>not priced</em> are real usage this instance has no price for, so treat this as a
          floor rather than an invoice.
        </span>
      </p>

      {/* The three questions an operator opens this page with, in the order
          they ask them: what does it cost (the hero above), where does it go,
          who is spending it, and is it growing. The rows below are the detail
          behind these, and every number in a chart is the same number a row
          repeats. */}
      <BarChart
        title="Where it goes"
        bars={[
          { label: "Models and speech", rappen: sum(data.providers) },
          { label: "Print", rappen: sum(data.print) },
          { label: "Sent to readers", rappen: sum(data.sends), note: "counted, not priced" },
          { label: "Fixed", rappen: sum(data.fixed) },
        ]}
        empty="Nothing has cost anything in this period."
      />

      <BarChart
        title="By journal"
        bars={data.journals.map((journal) => ({ label: journal.username, rappen: journal.rappen }))}
        empty="No journal has made a metered call in this period."
      />

      <DailyChart
        title="Models and speech, by day"
        days={daily}
        empty="No metered calls in this period yet — metering began when B746 was deployed, so this fills in from here."
      />

      <Lines
        title="Models and speech"
        lines={data.providers}
        note="Tokens and audio seconds as the providers measured them, priced from costs in site/config.json."
      />
      <Lines
        title="Print"
        lines={data.print}
        note="What the printer actually charged, taken from the order itself rather than from a price list."
      />
      <Lines
        title="Sent to readers"
        lines={data.sends}
        note="Counted, not priced. WhatsApp is billed by Meta per conversation and per country; email through the mailbox costs nothing per message, and push notifications cost nothing at all."
      />
      <Lines title="Fixed" lines={data.fixed} note="Owed whether anybody writes a day or not." />

      <Lines
        title="Bought"
        note="Credit purchases approved in this period, at what the buyer actually paid. A grant made from this page carries no price and is not takings."
        lines={data.paid.map((payment) => ({
          label: `${payment.owner} · ${payment.credits} credits`,
          detail: `${payment.method ?? "unknown"} · ${(payment.paidAt ?? "").slice(0, 10)}`,
          calls: 0,
          rappen: payment.amountRappen,
          unpriced: false,
        }))}
      />

      {/*
        What the conversations did — B976, and the reason any of this is kept.
        Above the journals because it is the only thing on this page that says
        what to *fix*; everything else says what was spent.

        **No words here, ever.** `proposed` against `pressed` is the number
        this was built for: a proposal made and never pressed is the clearest
        failure signal this product has, and until now nothing counted it. The
        guards beside it were three process-global integers that reset on every
        restart, so "is that fix working" was a question only a person driving
        the live site could answer.
      */}
      <Helper stats={await sessionStats(from)} />

      <section className="mt-10 border-t border-navy-200 pt-6">
        <h2 className="font-display text-lg font-semibold text-navy-900">Journals</h2>
        {!metered ? (
          <p className="mt-1 text-sm text-navy-500">
            Credits are switched off on this instance, so there are no balances to show.
          </p>
        ) : null}
        {/* The rows, their search and their sort live in `Journals`; the
            purchases and the ledger are still rendered here, on the server,
            and handed over as the opened panel. */}
        <Journals
          rows={data.journals.map((journal) => ({
            username: journal.username,
            rappen: journal.rappen,
            balance: journal.balance,
            spent: journal.spent,
            granted: journal.granted,
            panel: (
              <>
                <Purchases username={journal.username} />
                <Ledger username={journal.username} />
              </>
            ),
          }))}
        />
      </section>

      <section className="mt-10 border-t border-navy-200 pt-6">
        <h2 className="font-display text-lg font-semibold text-navy-900">Add credits</h2>
        <p className="mt-1 text-sm text-navy-700">
          This files a request and mails the operator a single-use link. Nothing is added to a
          balance until that link is opened — no request, including this one, can raise a balance
          by itself.
        </p>
        <AdminGrant journals={data.journals.map((journal) => journal.username)} />
      </section>
    </main>
  );
}

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
      <p className="mt-6 rounded-2xl border border-navy-200 bg-white p-4 text-sm text-navy-500">
        Nothing is waiting for your approval.
      </p>
    );
  }
  return (
    <section className="mt-6 rounded-2xl border border-navy-200 border-l-8 border-l-yellow-400 bg-white p-4">
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

/**
 * One journal's purchases, and the only place a refund can be recorded — B878.
 *
 * Settled purchases carry a button; everything else is shown with its status
 * and nothing to press. A refunded row keeps its place in the list rather than
 * disappearing: the question this section answers is "what has this person
 * paid me", and a purchase that was given back is part of that answer.
 */
async function Purchases({ username }: { username: string }) {
  const payments = await listPayments(username, 20);
  if (payments.length === 0) return null;
  return (
    <div className="border-t border-navy-200 px-4 pt-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-navy-600">Purchases</p>
      <ul className="mt-1 divide-y divide-navy-200">
        {payments.map((payment) => (
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
              {` · ${(payment.paidAt ?? payment.createdAt).slice(0, 10)} · ${payment.id}`}
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
    </div>
  );
}

/**
 * One journal's transactions, newest first — B763 took this out of a table
 * for the same reason as the cost lines, and one more: it sits inside a
 * `<details>` that is already indented, so it had the least width on the page
 * and the widest `min-w`.
 */
async function Ledger({ username }: { username: string }) {
  const rows = await ledgerFor(username, 50);
  if (rows.length === 0) {
    return <p className="px-4 pb-4 text-sm text-navy-500">No transactions.</p>;
  }
  return (
    <ul className="divide-y divide-navy-200 border-t border-navy-200 px-4 pb-4">
      {rows.map((row) => (
        <li key={row.id} className="py-2">
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 break-words text-sm text-navy-900">{row.reason}</span>
            <span className="shrink-0 font-mono text-sm text-navy-900">
              {row.delta > 0 ? `+${row.delta}` : row.delta}
            </span>
          </div>
          <p className="mt-0.5 [overflow-wrap:anywhere] font-mono text-xs text-navy-500">
            {row.createdAt.slice(0, 16).replace("T", " ")}
            {row.ref || row.note ? ` · ${row.ref ?? row.note}` : ""}
          </p>
        </li>
      ))}
    </ul>
  );
}
