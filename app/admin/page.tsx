import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AckButton, SnoozeButton, UnhideButton } from "./Acks";
import AppWaitlist from "./AppWaitlist";
import Invites from "./Invites";
import AdminGrant from "@paid/credits/routes/admin/AdminGrant";
import AdminRefund from "@paid/credits/routes/admin/AdminRefund";
import Journals from "./Journals";
import MessageOwner from "./MessageOwner";
import ReleaseName from "./ReleaseName";
import Shell, { type Section } from "./Shell";
import SmsThreads from "./SmsThreads";
import SpendChart from "./SpendChart";
import { BarChart, Breakdown, CountBars, Meter, Sparkline, type Week } from "./Charts";
import { activityFeed, type FeedEntry } from "@/lib/adminActivity";
import { applyAcks, listAcks, sweepAcks, type Ack } from "@/lib/adminAcks";
import { inviteOnly, listInvites } from "@/lib/inviteList";
import { listAppWaitlist } from "@/lib/appWaitlist";
import { isInstanceAdmin } from "@/lib/adminGate";
import { readBackupHistory, readBackupRuns, type BackupNight, type NightOutcome } from "@/lib/backupStatus";
import { isEnabled } from "@/lib/capabilities";
import { listSms } from "@/lib/sms/store";
import { creditsEnabled } from "@/lib/credits";
import { formatCredits } from "@/lib/creditsFormat";
import { formatChf } from "@/lib/creditsFormat";
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
  type Activity,
  type Attend,
  type FunnelStep,
  type Health,
  type Takings,
  type Trouble,
} from "@/lib/adminConsole";
import { paymentsPaidSince, takings, type Payment } from "@paid/credits/lib/payments";
import { serverSite } from "@/lib/site";
import type { Tombstone } from "@/lib/tombstones";
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

/** The periods the header offers, and the one a bare `/admin` shows. Thirty
 *  days rather than a calendar month because a bill is read on whatever day
 *  somebody wonders, and "the last thirty days" needs no explanation of what
 *  happens on the 31st. Anything else in `?days=` is the default, not an
 *  error: it is a bookmark, not an API. */
const PERIODS = [7, 30, 90];
const DEFAULT_DAYS = 30;

/** How far back the weekly counts look. Twelve is a quarter, which is long
 *  enough for a trend and short enough to draw on a phone. */
const WEEKS = 12;

/** How far back the funnel cohorts. A quarter, whatever period is showing:
 *  a week is too short for anybody to have got through. */
const COHORT_DAYS = 90;

/** How many nights of backups the Instance section draws. */
const NIGHTS = 14;

/** One card's frame, so every section's cards are the same object. */
const CARD = "rounded-3xl border border-line-quiet bg-surface-raised p-5";

function ago(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

/**
 * The operator's console — B746, rebuilt by B996, reframed as a sidebar of
 * seven sections.
 *
 * **404 for everybody who is not the operator, including when there is no
 * operator.** `FERNSCOUT_ADMIN_EMAIL` unset means `isInstanceAdmin` is false
 * for every address, so an instance that has not set it behaves exactly as
 * though this page were not in the build — the same promise `lib/admin.ts`
 * makes. `notFound()` rather than a 403: a page that says "forbidden" has told
 * a stranger the operator dashboard is at this address.
 *
 * ## The shape
 *
 * An operator opens this with three questions — **is anybody waiting on me**,
 * **what is this costing me**, and **is anything broken** — and B996's three
 * tabs answered them one each. The page has since grown a fourth and fifth
 * (who is here, what did the SMS number receive) and a sixth (what happened
 * lately), so it is a sidebar now (`Shell`), with **Overview** first: the
 * queue of people waiting, the health of the instance and the money, each at a
 * glance, and each linking to the section that holds the rest.
 *
 * The period (`?days=7|30|90`) is the page's, not a chart's: every figure is
 * computed for it on the server, and the chart draws the same window.
 *
 * ## Every number is still measured
 *
 * Unpriced usage says *not priced* rather than showing a zero, and the total
 * is a floor rather than an invoice. That rule is `lib/instanceCosts.ts`'s and
 * no chart here is worth breaking it for. The activity feed is read back out
 * of records other things already keep (`lib/adminActivity.ts`) and invents
 * no event of its own.
 *
 * ## Nothing here grants credits
 *
 * `lib/credits.ts`'s property 1 is unchanged: nothing a caller reaches over
 * HTTP raises a balance. The grant form in a journal's panel files a request
 * and causes a mail, and the single-use link in that mailbox is what credits.
 */
export default async function AdminPage({ searchParams }: PageProps<"/admin">) {
  if (!(await isInstanceAdmin())) notFound();

  const asked = Number((await searchParams).days);
  const days = PERIODS.includes(asked) ? asked : DEFAULT_DAYS;
  // The chart holds twice the period (at least a quarter), so the tiles can
  // compare this period with the one before it without a second query.
  const chartDays = Math.max(COHORT_DAYS, days * 2);

  const site = serverSite();
  const from = ago(days);

  const [
    data,
    daily,
    series,
    { report, measuredAt },
    healthNow,
    troubleRows,
    paidTwice,
    byReason,
    purchases,
    weeksOfDays,
    sends,
    signups,
    helper,
    arrivals,
    invites,
    appWaitlist,
  ] = await Promise.all([
    dashboard(from),
    dailyCosts(ago(chartDays), chartDays),
    journalDaily(from, days),
    snapshot(),
    health(),
    troubles(from),
    paymentsPaidSince(ago(days * 2)),
    spendByReasonAll(),
    paymentsByOwner(),
    Promise.resolve(daysByWeek(WEEKS)),
    sendsByWeek(WEEKS),
    signupsByWeek(WEEKS),
    sessionStats(from),
    signupDates(),
    listInvites(),
    listAppWaitlist(),
  ]);

  const metered = creditsEnabled();
  const costs = loadServerConfig().costs;
  // B1316 — the SMS section's own reads. `listSms` is empty with no database,
  // so a checkout with neither capability shows an explained-empty panel.
  const smsOn = isEnabled("sms");
  const smsInboundOn = isEnabled("smsInbound");
  const smsMessages = smsOn || smsInboundOn ? await listSms() : [];
  const money = takingsBreakdown(data.paid, data.awaiting);
  const stones = allTombstones();
  const byName = new Map(report.journals.map((row) => [row.username, row]));
  const ceiling = loadServerConfig().media.perUserBytes;
  const nights = readBackupHistory(NIGHTS);

  // Who has written what, and when they last touched it — B1181. Outside the
  // five-minute snapshot deliberately: see `journalActivity`.
  const activity = journalActivity(from);
  const steps = funnel(
    arrivals,
    activity,
    Object.fromEntries(report.journals.map((row) => [row.username, row.days])),
    COHORT_DAYS,
  );

  const raised = attention({
    awaiting: data.awaiting,
    health: healthNow,
    troubles: troubleRows,
    journals: report.journals,
    ceiling,
    balances: data.journals,
  });

  // What the operator has already answered — B1203. The sweep runs against the
  // band *before* anything is hidden, so an entry that is merely suppressed is
  // never mistaken for one that was fixed, and it runs before the read so the
  // history shows this load's closures rather than the previous one's.
  await sweepAcks(raised, await listAcks());
  const acks = await listAcks();
  const { shown: needs, hidden } = applyAcks(raised, acks);
  // The Instance badge counts what is wrong with the instance — the faults and
  // the backups still standing, not the whole band.
  const alerts = needs.filter((one) => one.kind === "fault" || one.kind === "backup").length;

  const feed = activityFeed(
    {
      // Only journals that exist: the identity table also holds rows that
      // belong to no journal (the operator's own sign-in among them).
      signups: arrivals
        ? Object.fromEntries(Object.entries(arrivals).filter(([name]) => byName.has(name)))
        : null,
      payments: Object.values(purchases).flat(),
      wrote: Object.fromEntries(Object.entries(activity).map(([name, one]) => [name, one.lastWroteAt])),
      backups: readBackupRuns() ?? [],
      acks,
      troubles: troubleRows,
      sms: smsMessages,
      tombstones: stones,
    },
    from,
  );

  const deployed = `${healthNow.commit?.slice(0, 7) ?? "unknown"} · up ${Math.round(healthNow.uptimeSeconds / 3600)}h`;
  const smsIn = smsMessages.filter((one) => one.direction === "in" && one.createdAt >= from).length;

  const sections: Section[] = [
    {
      id: "overview",
      label: "Overview",
      icon: "overview",
      lede: `Who is waiting, whether anything is wrong, and what the last ${days} days cost.`,
      badge: needs.length,
      badgeTone: "alert",
      primary: true,
      panel: (
        <>
          <div className="mt-6 grid gap-5 lg:grid-cols-3">
            {/* First on the page, above the money, because everything in it
                is somebody waiting rather than a number to read. B774 put the
                purchase queue here; B1181 put the other four kinds of waiting
                beside it. */}
            <div className="lg:col-span-2">
              <NeedsYou items={needs} hidden={hidden} acks={acks} health={healthNow} />
            </div>
            <HealthSummary health={healthNow} troubles={troubleRows} />
          </div>
          <Verdict data={data} daily={daily} paid={paidTwice} days={days} activity={activity} journals={report.journals.length} helper={helper} />
          <div className="mt-5 grid gap-5 lg:grid-cols-3">
            <div className={`${CARD} lg:col-span-2`}>
              <SpendChart days={daily} span={days} alertRappen={costs.alertDailyRappen} />
              <p className="mt-3 text-sm text-ink-body">
                The chart is the metered half. The other half is{" "}
                <span className="font-mono text-ink-strong">
                  {formatChf(Math.round(fixedRappen(data.fixed) / 30))} a day
                </span>{" "}
                fixed — owed whether anybody writes a day or not, counted in the figures above and
                stated rather than drawn, since drawn it would flatten every real movement.
                {costs.alertDailyRappen > 0
                  ? " The dashed line is costs.alertDailyRappen: a day above it is mailed to you the next night."
                  : " Set costs.alertDailyRappen to draw an alert line and be mailed about a day over it."}
              </p>
            </div>
            <WhereItGoes data={data} />
          </div>
          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <Units data={data} activity={activity} helper={helper} journals={report.journals.length} days={days} />
            <Feed entries={feed.slice(0, 8)} more={feed.length > 8} />
          </div>
        </>
      ),
    },
    {
      id: "money",
      label: "Money",
      icon: "money",
      lede: `Where the last ${days} days went, and what came in.`,
      primary: true,
      panel: (
        <div className="mt-6 grid gap-5 lg:grid-cols-2">
          <section className={CARD}>
            <h2 className="font-display text-lg font-semibold text-ink-strong">Where it goes</h2>
            <p className="mt-1 text-sm text-ink-body">
              The last {days} days. Open a bar for the lines behind it.
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
          <div className="space-y-5">
            <div className={CARD}>
              <SpentOn operations={data.operations} />
            </div>
            <div className={CARD}>
              <TakingsPanel money={money} paid={data.paid} days={days} />
            </div>
          </div>
        </div>
      ),
    },
    {
      id: "journals",
      label: "Journals",
      icon: "journals",
      lede: "Who is writing, who has gone quiet, and what each journal holds.",
      badge: report.journals.length,
      badgeTone: "count",
      primary: true,
      panel: (
        <>
          {!metered ? (
            <p className="mt-4 text-sm text-ink-body">
              Credits are switched off on this instance, so there are no balances to show.
            </p>
          ) : null}
          {/* The rows, their search, filters and sort live in `Journals`;
              what is behind one is rendered here, on the server, and handed
              over as the panel that opens. Every query that feeds those
              panels is instance-wide and made once — see `spendByReasonAll`. */}
          <Journals
            days={days}
            rows={data.journals.map((journal) => {
              const status = byName.get(journal.username);
              return {
                username: journal.username,
                rappen: journal.rappen,
                balance: journal.balance,
                spent: journal.spent,
                granted: journal.granted,
                series: series[journal.username],
                lastWroteAt: activity[journal.username]?.lastWroteAt ?? null,
                disk: `${formatBytes(status?.bytes ?? 0)}${ceiling ? ` of ${formatBytes(ceiling)}` : ""}`,
                full: ceiling ? (status?.bytes ?? 0) / ceiling : null,
                trips: status?.trips,
                days: status?.days,
                drafts: status?.drafts,
                readers: status?.contacts,
                panel: (
                  <JournalPanel
                    username={journal.username}
                    status={status}
                    ceiling={ceiling}
                    reasons={byReason[journal.username] ?? []}
                    payments={purchases[journal.username] ?? []}
                    helper={helper.find((one) => one.owner === journal.username)}
                  />
                ),
              };
            })}
          />
          <p className="mt-3 text-sm text-ink-body">
            {formatBytes(report.journals.reduce((sum, row) => sum + row.bytes, 0))} across{" "}
            {report.journals.length} {report.journals.length === 1 ? "journal" : "journals"} · measured{" "}
            {new Date(measuredAt).toISOString().slice(11, 16)} UTC. Walking the whole of content/ is the
            slowest thing this page can do, so it is held for five minutes.
          </p>
        </>
      ),
    },
    {
      // Renamed from `journals` by B1181 and split again: invites, the funnel
      // and the helper are the question of who arrives and whether they get
      // anywhere; the list of journals is its own section now.
      id: "people",
      label: "People",
      icon: "people",
      lede: "Who may sign up, how far the people who arrive get, and how the helper is doing.",
      panel: (
        <div className="mt-6 grid gap-5 lg:grid-cols-2">
          <div className={CARD}>
            <Invites inviteOnly={inviteOnly()} initial={invites} />
          </div>
          <div className={CARD}>
            <Funnel steps={steps} signups={signups} />
          </div>
          <div className={CARD}>
            <AppWaitlist entries={appWaitlist} />
          </div>
          <div className={`${CARD} lg:col-span-2`}>
            <HelperSummary stats={helper} days={days} />
          </div>
        </div>
      ),
    },
    {
      // B1316 — the instance's own SMS number, as conversations now. The
      // send posts to /api/admin/sms.
      id: "messages",
      label: "Messages",
      icon: "messages",
      lede: "What arrived at the instance's SMS number, and what was sent from it.",
      badge: smsIn,
      badgeTone: "count",
      panel: (
        <div className="mt-6">
          {!smsInboundOn ? (
            <p className="mb-3 text-sm text-ink-body">
              Receiving is switched off (features.smsInbound) — /api/health says what it needs.
              Nothing arriving at the number lands here until it is on and the Twilio webhook points
              at /api/webhooks/twilio.
            </p>
          ) : null}
          <SmsThreads
            rows={smsMessages.map((sms) => ({
              id: sms.id,
              direction: sms.direction,
              from: sms.from,
              to: sms.to,
              body: sms.body,
              dryRun: sms.direction === "out" && !sms.providerSid,
              createdAt: sms.createdAt,
            }))}
            canSend={smsOn}
            sendNote="Sending is switched off (features.sms) — /api/health says what it needs."
          />
        </div>
      ),
    },
    {
      id: "instance",
      label: "Instance",
      icon: "instance",
      lede: "Backups, faults, what is switched on, and what the instance did.",
      badge: alerts,
      badgeTone: "alert",
      primary: true,
      panel: (
        <>
          <div className="mt-6 grid gap-5 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <BackupPanel backup={healthNow.backup} nights={nights} />
            </div>
            <Faults health={healthNow} troubles={troubleRows} />
          </div>
          <Capabilities health={healthNow} />
          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <div className={CARD}>
              <WhatItDid days={weeksOfDays} sends={sends} print={data.print} window={days} />
            </div>
            <div className={CARD}>
              <Roster report={report} stones={stones} />
            </div>
          </div>
        </>
      ),
    },
    {
      id: "activity",
      label: "Activity",
      icon: "activity",
      lede: `What happened in the last ${days} days, newest first, read back from the records themselves.`,
      panel: (
        <div className="mt-6">
          <Feed entries={feed} full />
        </div>
      ),
    },
  ];

  return (
    <Shell
      sections={sections}
      days={days}
      siteName={site.name}
      deployed={deployed}
      journals={report.journals.map((row) => row.username)}
    />
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
 * Where an entry's fix lives on this page, when it lives here at all. An
 * approval has none on purpose: see `NeedsYou`.
 */
function whereFixed(item: Attend): { href: string; label: string } | null {
  if (item.kind === "approve") return null;
  if (item.kind === "disk") {
    const name = item.id.slice("disk:".length);
    return { href: `#journals/${encodeURIComponent(name)}`, label: "Open journal" };
  }
  if (item.kind === "credits") return { href: "#journals", label: "See journals" };
  return { href: "#instance", label: item.kind === "backup" ? "See backups" : "See instance" };
}

/**
 * Everything that wants a person, first on Overview — B1181, over B774.
 *
 * **It shows, and it cannot approve.** Approval spends a single-use token that
 * was mailed to the operator, and `lib/credits.ts`'s property 1 is that
 * nothing reachable over HTTP raises a balance. Rendering that token here
 * would put a balance-raising credential into a browser tab, a screenshot and
 * a scrollback — exactly what B425 avoided by putting it in a mailbox — so it
 * is not selected by the query that feeds this, and the entry says where the
 * link is instead of carrying a button. Every other kind links to the section
 * where its fix is.
 *
 * **Acknowledge and snooze both hide, and neither fixes anything.** An
 * acknowledgement holds until the entry gets worse or goes away; a snooze is
 * the same for a day (`lib/adminAcks.ts`). The history under the card is the
 * undo, which is why neither asks for confirmation.
 *
 * Empty is the ordinary state, says so, and carries the quiet facts. A card
 * that vanished when there was nothing in it would make *nothing needs you*
 * and *this page is broken* look alike, which is the same trap B1085 left
 * behind when the nightly backup mail stopped.
 */
function NeedsYou({
  items,
  hidden,
  acks,
  health,
}: {
  items: Attend[];
  /** Raised, and answered — so the empty state can say how many. */
  hidden: Attend[];
  acks: Ack[];
  health: Health;
}) {
  const body =
    items.length === 0 ? (
      <section className="flex items-center gap-4 rounded-3xl border border-green-700 bg-green-100 p-5">
        <span aria-hidden className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-green-700 text-xl text-on-deep">
          ✓
        </span>
        <div>
          <h2 className="font-display text-lg font-semibold text-green-700">
            {hidden.length === 0 ? "Nothing needs you." : "Nothing new needs you."}
          </h2>
          <p className="mt-1 text-sm text-ink-body">
            {/* An empty band with three things acknowledged behind it is
                exactly the ambiguity B1203 is about: silence and a broken
                alarm sound alike. So the count is on the quiet line, always. */}
            {hidden.length > 0 ? `${hidden.length} acknowledged or snoozed and still true. ` : ""}
            Commit {health.commit ?? "unknown"} · up {Math.round(health.uptimeSeconds / 3600)}h
            {health.backupAgeHours !== null ? ` · backed up ${Math.round(health.backupAgeHours)}h ago` : ""}.
          </p>
        </div>
      </section>
    ) : (
      <section className="overflow-hidden rounded-3xl border border-coral-600 bg-surface-raised">
        <header className="flex flex-wrap items-center gap-2.5 border-b border-coral-100 bg-coral-50 px-5 py-3.5">
          <h2 className="font-display text-lg font-semibold text-coral-600">Needs you</h2>
          <span className="rounded-full bg-coral-600 px-2 py-0.5 font-mono text-xs font-semibold text-on-deep">
            {items.length}
          </span>
          <span className="ml-auto text-sm text-ink-body">Nothing here can raise a balance.</span>
        </header>
        <ul>
          {items.map((item) => {
            const fix = whereFixed(item);
            return (
              <li
                key={item.id}
                className="flex flex-wrap items-start gap-x-4 gap-y-3 border-t border-line-faint px-5 py-4 first:border-t-0"
              >
                <span className="min-w-0 flex-1 basis-64">
                  <span className="flex items-baseline gap-2.5">
                    <span className="font-mono text-[11px] font-semibold uppercase tracking-wide text-ink-secondary">
                      {KIND_LABEL[item.kind]}
                    </span>
                    <span className="font-mono text-xs text-ink-secondary">{item.age}</span>
                  </span>
                  <strong className="mt-0.5 block break-words font-semibold text-ink-strong">{item.title}</strong>
                  <span className="mt-0.5 block text-sm text-ink-body">{item.detail}</span>
                </span>
                <span className="flex w-full flex-wrap items-start gap-2 sm:w-auto sm:shrink-0">
                  {fix ? (
                    <a
                      href={fix.href}
                      className="flex min-h-10 items-center rounded-xl bg-action-strong px-3.5 text-sm font-semibold text-on-action"
                    >
                      {fix.label}
                    </a>
                  ) : (
                    <span className="flex min-h-10 items-center rounded-xl bg-surface-neutral px-3 text-sm font-semibold text-ink-secondary">
                      The link is in your mailbox
                    </span>
                  )}
                  <SnoozeButton id={item.id} />
                  {/* It hides and it fixes nothing, which is why the word is
                      "acknowledge" and not "dismiss" or "done". */}
                  <AckButton id={item.id} label="Acknowledge" />
                </span>
              </li>
            );
          })}
        </ul>
      </section>
    );

  return (
    <>
      {body}
      <AckHistory acks={acks} />
    </>
  );
}

/**
 * The standing state of the instance in six lines — beside the queue on
 * Overview, so "is anything broken" is answered without leaving the page. The
 * Instance section is where each line is in full.
 */
function HealthSummary({ health, troubles }: { health: Health; troubles: Trouble[] }) {
  const on = health.capabilities.filter((one) => one.state === "on").length;
  const off = health.capabilities.filter((one) => one.state === "off").length;
  const faults = health.capabilities.filter((one) => one.state === "fault").length;
  const lines: { label: string; detail: string; tone: "ok" | "bad" | "quiet" }[] = [
    {
      label: "Deployed",
      detail: `${health.commit?.slice(0, 7) ?? "unknown"} · up ${Math.round(health.uptimeSeconds / 3600)}h`,
      tone: "ok",
    },
    {
      label: "Backup",
      detail: `${health.backup.state}${health.backup.ageHours !== null ? ` · ${Math.round(health.backup.ageHours)}h ago` : ""}`,
      tone: health.backup.state === "ok" ? "ok" : health.backup.state === "unknown" ? "quiet" : "bad",
    },
    {
      label: "Off-site copy",
      detail: `${health.backup.secondary.state}${
        health.backup.secondary.ageHours !== null ? ` · ${Math.round(health.backup.secondary.ageHours)}h ago` : ""
      }`,
      tone:
        health.backup.secondary.state === "ok" ? "ok" : health.backup.secondary.state === "unknown" ? "quiet" : "bad",
    },
    {
      label: "Faults",
      detail: String(health.wrong.length + troubles.length),
      tone: health.wrong.length + troubles.length === 0 ? "ok" : "bad",
    },
    {
      label: "Capabilities",
      detail: `${on} on · ${off} off by choice${faults ? ` · ${faults} refused` : ""}`,
      tone: faults ? "bad" : "quiet",
    },
  ];
  const dot = { ok: "bg-green-700", bad: "bg-coral-600", quiet: "border border-line-prominent bg-surface-raised" };
  return (
    <section className={CARD}>
      <h2 className="font-display text-lg font-semibold text-ink-strong">Health</h2>
      <ul className="mt-2">
        {lines.map((line) => (
          <li key={line.label} className="flex min-h-11 items-center gap-3 border-t border-line-faint">
            <span aria-hidden className={`h-2.5 w-2.5 shrink-0 rounded-full ${dot[line.tone]}`} />
            <span className="flex-1 text-sm font-semibold text-ink-strong">{line.label}</span>
            <span className={`text-right font-mono text-xs ${line.tone === "bad" ? "text-coral-600" : "text-ink-body"}`}>
              {line.detail}
            </span>
          </li>
        ))}
      </ul>
      <a href="#instance" className="mt-3 inline-block text-sm font-semibold text-ink-strong underline">
        Open instance
      </a>
    </section>
  );
}

/**
 * The four groups of the bill as bars, for Overview. The lines behind each
 * one are on Money, where `Breakdown` opens them.
 */
function WhereItGoes({ data }: { data: Awaited<ReturnType<typeof dashboard>> }) {
  const sum = (lines: CostLine[]) => lines.reduce((total, line) => total + line.rappen, 0);
  const groups = [
    { label: "Fixed", rappen: sum(data.fixed), note: "server, domain, mailbox" },
    { label: "Models and speech", rappen: sum(data.providers), note: "as the providers measured them" },
    { label: "Print", rappen: sum(data.print), note: "what the printer charged" },
  ];
  const max = Math.max(...groups.map((one) => one.rappen), 1);
  const sent = data.sends.reduce((total, line) => total + line.calls, 0);
  return (
    <section className={CARD}>
      <h2 className="font-display text-lg font-semibold text-ink-strong">Where it goes</h2>
      <ul className="mt-3 space-y-3.5">
        {groups.map((group) => (
          <li key={group.label}>
            <div className="flex items-baseline justify-between gap-3">
              <span className="text-sm font-semibold text-ink-strong">{group.label}</span>
              <span className="font-mono text-sm text-ink-strong">{formatChf(group.rappen)}</span>
            </div>
            <Meter fraction={group.rappen / max} />
            <p className="mt-1 text-xs text-ink-body">{group.note}</p>
          </li>
        ))}
        <li>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-sm font-semibold text-ink-strong">Sent to readers</span>
            <span className="font-mono text-sm text-ink-strong">{sent} sent</span>
          </div>
          <p className="mt-1 text-xs text-ink-body">counted, not priced</p>
        </li>
      </ul>
      <a href="#money" className="mt-4 inline-block text-sm font-semibold text-ink-strong underline">
        Every line
      </a>
    </section>
  );
}

/** The dot beside a feed line: bad news in coral, the rest by what it is. */
const FEED_DOT: Record<FeedEntry["kind"], string> = {
  signup: "bg-action-strong",
  purchase: "bg-green-700",
  wrote: "bg-sky-500",
  backup: "bg-green-700",
  ack: "border border-line-prominent bg-surface-raised",
  trouble: "bg-coral-600",
  sms: "bg-sky-500",
  deleted: "bg-yellow-600",
};

/**
 * The activity feed — eight lines on Overview, the whole window on Activity.
 * Grouped by day on the full view, because a column of timestamps is a thing
 * to decode and "Tuesday" is not.
 */
function Feed({ entries, more, full }: { entries: FeedEntry[]; more?: boolean; full?: boolean }) {
  const days = new Map<string, FeedEntry[]>();
  for (const one of entries) {
    const day = one.at.slice(0, 10);
    days.set(day, [...(days.get(day) ?? []), one]);
  }
  return (
    <section className={CARD}>
      {!full ? (
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-display text-lg font-semibold text-ink-strong">Activity</h2>
          {more ? (
            <a href="#activity" className="text-sm font-semibold text-ink-strong underline">
              Everything
            </a>
          ) : null}
        </div>
      ) : null}
      {entries.length === 0 ? (
        <p className="mt-2 text-sm text-ink-body">Nothing recorded in this period.</p>
      ) : (
        <div className={full ? "" : "mt-2"}>
          {[...days].map(([day, lines]) => (
            <div key={day}>
              {full ? (
                <h3 className="mt-4 font-mono text-xs font-semibold uppercase tracking-wide text-ink-secondary first:mt-0">
                  {day}
                </h3>
              ) : null}
              <ol>
                {lines.map((one, at) => (
                  <li
                    key={`${one.at}-${one.kind}-${at}`}
                    className="flex items-start gap-3 border-t border-line-faint py-2"
                  >
                    <span className="w-12 shrink-0 font-mono text-xs text-ink-secondary">
                      {full ? (one.at.length > 10 ? one.at.slice(11, 16) : "") : one.at.slice(5, 10)}
                    </span>
                    <span aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${FEED_DOT[one.kind]}`} />
                    <span className={`text-sm ${one.alert ? "text-coral-600" : "text-ink-strong"}`}>{one.text}</span>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      )}
      {full ? (
        <p className="mt-4 text-sm text-ink-body">
          Read back from the records themselves — signups, payments, day files, the backup history,
          your own acknowledgements, SMS and tombstones. A day file&rsquo;s timestamp says a journal
          was written to, not what was written. Times are UTC.
        </p>
      ) : null}
    </section>
  );
}

/** The words for why an acknowledgement stopped holding. */
const ENDED_WHY: Record<string, string> = {
  fixed: "no longer raised",
  unhidden: "brought back",
  superseded: "acknowledged again",
  woke: "snooze ran out",
};

/**
 * What has been acknowledged, under the band — B1203.
 *
 * Closed by default and counted on its own summary, so the ordinary page is
 * the band and nothing else, and the answer to *what did I silence* is one
 * press away rather than a thing to remember.
 *
 * **Every row says whether it is still holding**, because those are the two
 * different facts a person comes here for: what am I currently not being told,
 * and what did I answer that has since gone away. An entry still holding
 * carries an Unhide, which is the whole undo — there is no confirmation on
 * acknowledging precisely because this is directly beneath it.
 */
function AckHistory({ acks }: { acks: Ack[] }) {
  if (acks.length === 0) return null;
  const holding = acks.filter((one) => one.endedAt === null).length;
  return (
    <details className="mt-2 rounded-3xl border border-line-quiet bg-surface-raised px-5">
      <summary className="cursor-pointer list-none py-3 text-sm font-semibold text-ink-body">
        Show history · {holding} still hidden of {acks.length} acknowledged or snoozed
      </summary>
      <ul className="divide-y divide-line-faint border-t border-line-faint pb-2">
        {acks.map((one) => (
          <li key={one.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5">
            <span className="min-w-0 flex-1 basis-48">
              <span className="break-words font-mono text-sm text-ink-strong">{one.entryId}</span>
              <span className="mt-0.5 block text-xs text-ink-body">
                {one.until ? "snoozed" : "acknowledged"} {one.ackedAt.slice(0, 16).replace("T", " ")} UTC
                {one.until && one.endedAt === null ? ` until ${one.until.slice(0, 16).replace("T", " ")}` : ""}
                {one.endedAt
                  ? ` · ended ${one.endedAt.slice(0, 10)}, ${ENDED_WHY[one.endedWhy] ?? one.endedWhy}`
                  : " · still hidden"}
              </span>
            </span>
            {one.endedAt === null ? <UnhideButton id={one.entryId} /> : null}
          </li>
        ))}
      </ul>
    </details>
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
 * The subtraction, done, and the four figures beside it — B1181, over B996's
 * tiles, laid out as one row on Overview.
 *
 * The page is opened to find out whether this is costing more than it takes,
 * which is one number, so it leads, on the dark tile. The two halves stay
 * beside it, because a net figure with no sides to it cannot say which of them
 * moved; then how many journals were written in, and how many of the helper's
 * proposals were pressed, because a bill with nobody on the other side of it
 * is just a bill.
 *
 * The comparison under Paid out is **metered spend only** and says so: the
 * fixed monthly lines are most of this instance's bill and identical in both
 * periods, so including them would divide every real movement by ten and
 * report a tenth of it. The delta comes out of the days the chart already
 * holds, which is why there is no second query for a previous period.
 */
function Verdict({
  data,
  daily,
  paid,
  days,
  activity,
  journals,
  helper,
}: {
  data: Awaited<ReturnType<typeof dashboard>>;
  daily: DailySpend[];
  paid: Payment[];
  days: number;
  activity: Record<string, Activity>;
  journals: number;
  helper: SessionStats[];
}) {
  const recent = daily.slice(-days);
  const before = daily.slice(-days * 2, -days);
  const now = recent.reduce((sum, day) => sum + day.rappen, 0);
  const then = before.reduce((sum, day) => sum + day.rappen, 0);

  const cutoff = ago(days).slice(0, 10);
  const takenBefore = takings(paid.filter((one) => (one.paidAt ?? "") < cutoff));

  const net = data.takenRappen - data.totalRappen;
  const perDay = Math.round(Math.abs(net) / days);

  const since = ago(days);
  const active = Object.values(activity).filter((one) => (one.lastWroteAt ?? "") >= since).length;
  const proposed = helper.reduce((sum, one) => sum + one.proposed, 0);
  const pressed = helper.reduce((sum, one) => sum + one.pressed, 0);

  return (
    <section className="mt-5 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
      <div className="col-span-2 rounded-3xl border border-surface-muted bg-surface-subtle p-5 lg:col-span-1">
        <p className="font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-secondary">
          Net · {days} days
        </p>
        <p
          className={`mt-1.5 font-display text-3xl font-semibold tabular-nums ${
            net < 0 ? "text-coral-600" : "text-green-700"
          }`}
        >
          {net < 0 ? `−${formatChf(-net)}` : formatChf(net)}
        </p>
        <p className="mt-1.5 text-sm text-ink-body">
          {net === 0
            ? "In and out came to the same."
            : `${net < 0 ? "A loss" : "A surplus"} of about ${formatChf(perDay)} a day.`}{" "}
          {/* A floor, never an invoice: an unpriced line contributes nothing
              to `totalRappen` and is flagged rather than guessed at. */}
          Out is a floor.
        </p>
      </div>
      <Tile
        label="Taken in"
        value={formatChf(data.takenRappen)}
        note={<Delta now={data.takenRappen} then={takenBefore} what="takings" good />}
      />
      <Tile
        label="Paid out"
        value={formatChf(data.totalRappen)}
        note={<Delta now={now} then={then} what="metered spend" />}
        spark={recent.map((day) => day.rappen)}
      />
      <Tile
        label="Journals written in"
        value={String(active)}
        note={<span className="text-xs text-ink-body">of {journals} on this instance</span>}
      />
      <Tile
        label="Proposals pressed"
        value={proposed === 0 ? "—" : `${Math.round((pressed / proposed) * 100)}%`}
        note={
          <span className="text-xs text-ink-body">
            {proposed === 0 ? "nothing was proposed" : `${pressed} of ${proposed} from the helper`}
          </span>
        }
      />
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
  days,
}: {
  data: Awaited<ReturnType<typeof dashboard>>;
  activity: Record<string, Activity>;
  helper: SessionStats[];
  journals: number;
  days: number;
}) {
  const metered = data.journals.reduce((sum, row) => sum + row.rappen, 0);
  const since = ago(days);
  const active = Object.values(activity).filter(
    (one) => (one.lastWroteAt ?? "") >= since,
  ).length;
  const written = Object.values(activity).reduce((sum, one) => sum + one.recentDays, 0);
  const conversations = helper.reduce((sum, one) => sum + one.sessions, 0);
  const fixed = fixedRappen(data.fixed);

  const per = (total: number, count: number) =>
    count === 0 ? "—" : formatChf(Math.round(total / count));

  const units = [
    {
      label: "Per active journal",
      value: per(metered, active),
      note: active === 0 ? "nobody wrote in this period" : `${active} wrote something`,
    },
    {
      label: "Per day written",
      value: per(metered, written),
      note: written === 0 ? "no day is dated in the period" : `${written} days dated in it`,
    },
    {
      label: "Per conversation",
      value: per(metered, conversations),
      note: conversations === 0 ? "no conversations" : `${conversations} with the helper`,
    },
    { label: "Fixed, per journal", value: per(fixed, journals), note: `a month, across all ${journals}` },
  ];

  return (
    <section className={CARD}>
      <h2 className="font-display text-lg font-semibold text-ink-strong">What a journal costs</h2>
      <p className="mt-1 text-sm text-ink-body">
        Metered spend over the same {days} days, divided — the figures that say whether the next
        thirty journals are affordable.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2.5">
        {units.map((unit) => (
          <div key={unit.label} className="rounded-2xl bg-surface-neutral p-3.5">
            <p className="text-xs font-semibold text-ink-secondary">{unit.label}</p>
            <p className="mt-0.5 font-display text-xl font-semibold text-ink-strong">{unit.value}</p>
            <p className="mt-0.5 text-xs text-ink-body">{unit.note}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Tile({
  label,
  value,
  note,
  alert,
  spark,
}: {
  label: string;
  value: string;
  note: React.ReactNode;
  alert?: boolean;
  /** A line under the figure, when the figure has a shape worth drawing. */
  spark?: number[];
}) {
  return (
    <div
      className={`flex min-w-0 flex-col rounded-3xl border bg-surface-raised p-4 sm:p-5 ${alert ? "border-coral-600" : "border-line-quiet"}`}
    >
      <p
        className={`font-mono text-[11px] font-semibold uppercase tracking-[0.08em] ${alert ? "text-coral-600" : "text-ink-secondary"}`}
      >
        {label}
      </p>
      <p className={`mt-1.5 font-display text-2xl font-semibold ${alert ? "text-coral-600" : "text-ink-strong"}`}>
        {value}
      </p>
      <div className="mt-auto flex items-end justify-between gap-2 pt-1.5">
        <div>{note}</div>
        {spark && spark.some((point) => point > 0) ? <Sparkline points={spark} label={`${label}, day by day`} /> : null}
      </div>
    </div>
  );
}

/**
 * The change against the period before, in words rather than an arrow alone.
 *
 * A percentage of nothing is not a percentage, so a previous period of zero
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
    return <span className="text-xs text-ink-body">no {what} either period</span>;
  }
  if (then === 0) {
    return <span className="text-xs text-ink-body">no {what} the period before</span>;
  }
  const change = Math.round(((now - then) / then) * 100);
  const rising = change > 0;
  // Rising spend is bad news and rising takings are good news, so the caller
  // says which this is rather than the colour guessing from the sign.
  const tone = change === 0 ? "text-ink-body" : rising === Boolean(good) ? "text-green-700" : "text-coral-600";
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
function TakingsPanel({ money, paid, days }: { money: Takings; paid: Payment[]; days: number }) {
  return (
    <section>
      <h2 className="font-display text-lg font-semibold text-ink-strong">Taken</h2>
      <p className="mt-1 text-sm text-ink-body">
        Purchases settled in the last {days} days, at what the buyer actually paid. A grant
        made from a journal&rsquo;s panel carries no price and is not takings.
      </p>
      <ul className="mt-3 divide-y divide-line-quiet border-t border-line-quiet">
        {money.byMethod.map((row) => (
          <li key={row.method} className="flex items-baseline justify-between gap-3 py-2">
            <span className="text-sm text-ink-strong">
              {row.method} · {row.count} {row.count === 1 ? "purchase" : "purchases"}
            </span>
            <span className="font-mono text-sm text-ink-strong">{formatChf(row.rappen)}</span>
          </li>
        ))}
        <li className="flex items-baseline justify-between gap-3 py-2">
          <span className="text-sm text-ink-body">Waiting on you</span>
          <span className="font-mono text-sm text-ink-strong">
            {formatChf(money.waitingRappen)}
            {money.waitingCount > 0 ? ` · ${money.waitingCount}` : ""}
          </span>
        </li>
        <li className="flex items-baseline justify-between gap-3 py-2">
          <span className="text-sm text-ink-body">Refunded</span>
          <span className="font-mono text-sm text-ink-strong">{formatChf(money.refundedRappen)}</span>
        </li>
        <li className="flex items-baseline justify-between gap-3 py-2">
          <span className="text-sm text-ink-body">Given by hand</span>
          <span className="font-mono text-sm text-ink-strong">
            {money.grantedCredits} credits
          </span>
        </li>
      </ul>
      {paid.length === 0 ? (
        <p className="mt-2 text-sm text-ink-body">Nothing was bought in this period.</p>
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
    <div>
      {status && ceiling ? (
        <div className="px-4 pt-3">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">
              Disk
            </span>
            <span className="font-mono text-sm text-ink-strong">
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
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">
            Credits went on
          </p>
          <ul className="mt-1 space-y-1.5">
            {reasons.map((row) => (
              <li key={row.reason}>
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm text-ink-strong">{REASON_LABEL[row.reason] ?? row.reason}</span>
                  <span className="font-mono text-sm text-ink-strong">
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
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">
            Conversations
          </p>
          <p className="mt-1 text-sm text-ink-strong">
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
          <p className="mt-0.5 text-xs text-ink-body">
            {helper.readable
              ? "No words here. Reading them is a separate permission."
              : "Words not shared by this journal."}
          </p>
        </div>
      ) : null}

      <Purchases username={username} payments={payments} settled={settled.length} bought={bought} />
      <AdminGrant journal={username} />
      <MessageOwner username={username} />
    </div>
  );
}

/** The ledger's own vocabulary, in the operator's words. Unknown reasons fall
 *  through to their own name rather than disappearing. */
const REASON_LABEL: Record<string, string> = {
  day_mail: "Announcing a day by email",
  day_whatsapp: "Announcing a day on WhatsApp",
  day_sms: "Announcing a day by SMS",
  invite: "Welcome messages (WhatsApp / SMS)",
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
        <span className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">
          Purchases
        </span>
        <span className="font-mono text-sm text-ink-strong">
          {settled} paid · {formatChf(bought)}
        </span>
      </div>
      <ul className="mt-1 divide-y divide-line-quiet">
        {payments.slice(0, 5).map((payment) => (
          <li key={payment.id} className="py-2">
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 break-words text-sm text-ink-strong">
                {payment.credits} credits
              </span>
              <span className="shrink-0 font-mono text-sm text-ink-strong">
                {payment.method === "admin" ? "by hand" : formatChf(payment.amountRappen)}
              </span>
            </div>
            <p className="mt-0.5 [overflow-wrap:anywhere] font-mono text-xs text-ink-body">
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
        <p className="pb-1 text-xs text-ink-body">
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
    <section>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-lg font-semibold text-ink-strong">
          Does anybody get through
        </h2>
        <span className="font-mono text-sm text-ink-body">last {COHORT_DAYS} days</span>
      </div>
      <p className="mt-1 text-sm text-ink-body">
        Every journal started in the window, and how far each one got. Cohorted by when they
        arrived, so a bad first year does not follow the instance around for ever.
      </p>
      {steps === null ? (
        <p className="mt-3 text-sm text-ink-body">
          There is no database on this instance, so there is no record of who arrived when. The
          journals themselves are below.
        </p>
      ) : steps[0].count === 0 ? (
        <p className="mt-3 text-sm text-ink-body">
          Nobody has started a journal in the last {COHORT_DAYS} days.
        </p>
      ) : (
        <div className="mt-3">
          {steps.map((step, at) => (
            <div key={step.label}>
              {at > 0 && step.lost.startsWith("0 ") ? null : at > 0 ? (
                <p className="py-1 font-mono text-xs text-coral-600">▼ {step.lost}</p>
              ) : null}
              <div className="flex items-center gap-3">
                <span className="w-28 shrink-0 text-xs font-semibold uppercase tracking-wide text-ink-secondary sm:w-36">
                  {step.label}
                </span>
                {/* One measure, one hue — `Charts.tsx`'s rule, and these four
                    bars are four lengths of one thing. The last step is the
                    outcome and it was drawn in the brand's yellow for a
                    while; that is a waymark rather than a measure, and the
                    same note in `Charts.tsx` says so. */}
                <span className="h-7 flex-1 overflow-hidden rounded-md bg-surface-neutral-strong">
                  <span
                    className="block h-full bg-action-strong"
                    style={{ width: `${Math.round((step.count / steps[0].count) * 100)}%` }}
                  />
                </span>
                <span className="w-10 shrink-0 text-right font-mono text-sm font-semibold text-ink-strong">
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
function HelperSummary({ stats, days }: { stats: SessionStats[]; days: number }) {
  if (stats.length === 0) {
    return (
      <section>
        <h2 className="font-display text-lg font-semibold text-ink-strong">The helper</h2>
        <p className="mt-1 text-sm text-ink-body">Nobody talked to the helper in the last {days} days.</p>
      </section>
    );
  }
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
    <section>
      <h2 className="font-display text-lg font-semibold text-ink-strong">The helper</h2>
      <p className="mt-1 text-sm text-ink-body">
        The last {days} days. A proposal that was never pressed is somebody who described
        their day and did not get one.
      </p>
      <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          label="Proposals pressed"
          value={proposed === 0 ? "—" : `${Math.round((pressed / proposed) * 100)}%`}
          note={
            <span className="text-xs text-ink-body">
              {proposed === 0 ? "nothing was proposed" : `${pressed} of ${proposed}`}
            </span>
          }
        />
        <Tile
          label="Conversations"
          value={String(sessions)}
          note={
            <span className="text-xs text-ink-body">
              across {stats.length} {stats.length === 1 ? "journal" : "journals"}
            </span>
          }
        />
        <Tile
          label="Guard fires"
          value={String(total)}
          alert={total > 0}
          note={
            <span className="font-mono text-xs text-ink-body">
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
          note={<span className="text-xs text-ink-body">a write the server would not make</span>}
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
 * Capabilities the operator switched off are not here: *off because nobody
 * asked for it* and *off although somebody did* are opposite facts, and the
 * grid below is where the first kind is listed.
 */
function Faults({ health, troubles }: { health: Health; troubles: Trouble[] }) {
  const clear = health.wrong.length === 0 && troubles.length === 0;
  return (
    <section className={CARD}>
      <h2 className="font-display text-lg font-semibold text-ink-strong">Faults</h2>
      {clear ? (
        <div className="mt-3 rounded-2xl bg-green-100 p-4">
          <p className="font-display font-semibold text-green-700">Nothing is wrong.</p>
          <p className="mt-1 text-sm text-ink-body">
            Commit {health.commit ?? "unknown"} · up {Math.round(health.uptimeSeconds / 3600)}h
            {offSummary(health.offByChoice)}.
          </p>
        </div>
      ) : (
        <ul className="mt-3 space-y-2">
          {health.wrong.map((one) => (
            <li key={one.title} className="rounded-2xl bg-coral-50 p-3.5 [overflow-wrap:anywhere]">
              <p className="font-semibold text-coral-600">{one.title}</p>
              <p className="mt-0.5 text-sm text-ink-body">{one.detail}</p>
            </li>
          ))}
          {troubles.map((one) => (
            <li
              key={`${one.what}-${one.owner}-${one.when}-${one.ref}`}
              className="rounded-2xl border border-line-quiet p-3.5"
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="font-semibold text-ink-strong">{one.what}</span>
                <span className="shrink-0 font-mono text-xs text-ink-secondary">{one.when}</span>
              </div>
              <p className="mt-0.5 text-sm text-ink-body">
                {one.owner ? `${one.owner} · ` : ""}
                {one.detail}
              </p>
            </li>
          ))}
          <li className="text-xs text-ink-body">
            Commit {health.commit ?? "unknown"} · up {Math.round(health.uptimeSeconds / 3600)}h
          </li>
        </ul>
      )}
    </section>
  );
}

/**
 * Every capability, as `/api/health` would say it — on, off by choice, or
 * asked for and refused, each with the reason `resolveCapabilities` gives.
 *
 * A grid rather than a list because what is read here is the pattern: which
 * few are on, and whether any tile is coral. A refused one is also a fault in
 * the card above; here it is in its place among the rest.
 */
function Capabilities({ health }: { health: Health }) {
  const tone = {
    on: { card: "bg-green-100", dot: "bg-green-700", word: "on" },
    off: { card: "bg-surface-neutral", dot: "border border-line-prominent bg-surface-raised", word: "off by choice" },
    fault: { card: "bg-coral-50 border border-coral-600", dot: "bg-coral-600", word: "refused" },
  } as const;
  const on = health.capabilities.filter((one) => one.state === "on").length;
  return (
    <section className={`${CARD} mt-5`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-display text-lg font-semibold text-ink-strong">Capabilities</h2>
        <span className="text-sm text-ink-body">
          {on} of {health.capabilities.length} on · off by choice is not a fault
        </span>
      </div>
      <ul className="mt-3 grid items-start gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
        {health.capabilities.map((one) => (
          <li key={one.name} className={`rounded-2xl p-3 ${tone[one.state].card}`}>
            <p className="flex items-center gap-2">
              <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${tone[one.state].dot}`} />
              <span className="font-mono text-sm font-semibold text-ink-strong">{one.name}</span>
              <span className="sr-only">{tone[one.state].word}</span>
            </p>
            {one.reason && one.state !== "off" ? (
              <p className="mt-1 text-xs text-ink-body [overflow-wrap:anywhere]">{one.reason}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * When the backup last worked, said positively — and, since the redesign, the
 * last fortnight of nights beside it.
 *
 * B1085 stopped the nightly "it worked" mail on the operator's request. The
 * faults card already shouts when a backup is stale, failing or has never been
 * recorded. What went away with the mail is the *other* half: the standing
 * evidence that the thing runs at all. An empty fault list is silence, and
 * silence is exactly what a broken alarm also sounds like — this deployment
 * has already spent two days that way (B138).
 *
 * So this states the good case out loud, with a date on it, and always
 * renders. The row of squares is `.backup-history`, which the backup and alert
 * scripts append to; before it exists the card says so rather than drawing
 * fourteen empty nights that would read as fourteen nights nothing ran.
 */
function BackupPanel({ backup, nights }: { backup: Health["backup"]; nights: BackupNight[] | null }) {
  const when = (at: string | null) => (at ? `${at.slice(0, 16).replace("T", " ")} UTC` : "never");
  const offsite = backup.secondary;
  return (
    <section className={CARD}>
      <h2 className="font-display text-lg font-semibold text-ink-strong">Backups</h2>
      <p className="mt-1 text-sm text-ink-body">
        A run that works sends no mail; this is where it says so. A run that fails still mails.
      </p>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl border border-line-quiet p-4">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-semibold text-ink-strong">Local</h3>
            <span className={`rounded-full border px-2.5 py-0.5 font-mono text-xs font-semibold ${stateTone(backup.state)}`}>
              {backup.state}
            </span>
          </div>
          <Nights nights={nights} which="primary" />
          <p className="mt-2 text-sm text-ink-body">
            Last success {when(backup.lastSuccessAt)}
            {backup.ageHours !== null ? ` · ${Math.round(backup.ageHours)}h ago` : ""} · stale past{" "}
            {backup.maxAgeHours}h
          </p>
          {backup.lastFailure && (
            <p className="mt-1 text-sm text-coral-600 [overflow-wrap:anywhere]">
              Last failure {backup.lastFailureAt?.slice(0, 16).replace("T", " ") ?? "unknown"} ·{" "}
              {backup.lastFailure}
            </p>
          )}
        </div>
        <div
          className={`rounded-2xl border p-4 ${offsite.state === "stale" ? "border-coral-600" : "border-line-quiet"}`}
        >
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-semibold text-ink-strong">Off-site copy</h3>
            <span className={`rounded-full border px-2.5 py-0.5 font-mono text-xs font-semibold ${stateTone(offsite.state)}`}>
              {offsite.state}
            </span>
          </div>
          <Nights nights={nights} which="secondary" />
          <p className="mt-2 text-sm text-ink-body">
            Last success {when(offsite.lastSuccessAt)}
            {offsite.ageHours !== null ? ` · ${Math.round(offsite.ageHours)}h ago` : ""} · stale past{" "}
            {offsite.maxAgeHours}h
          </p>
          {offsite.reason && (
            <p className="mt-1 text-sm text-ink-body [overflow-wrap:anywhere]">{offsite.reason}</p>
          )}
        </div>
      </div>
      {nights ? (
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-body">
          <li className="flex items-center gap-1.5">
            <span aria-hidden className={`h-3 w-3 rounded ${NIGHT.ok}`} />
            worked
          </li>
          <li className="flex items-center gap-1.5">
            <span aria-hidden className={`h-3 w-3 rounded ${NIGHT.failed}`} />
            failed
          </li>
          <li className="flex items-center gap-1.5">
            <span aria-hidden className={`h-3 w-3 rounded ${NIGHT.none}`} />
            nothing recorded
          </li>
        </ul>
      ) : null}
    </section>
  );
}

const NIGHT: Record<NightOutcome, string> = {
  ok: "bg-green-700",
  failed: "bg-coral-600",
  none: "border border-line-strong bg-surface-raised",
};

/** One destination's fortnight, oldest on the left. */
function Nights({ nights, which }: { nights: BackupNight[] | null; which: "primary" | "secondary" }) {
  if (!nights) {
    return (
      <p className="mt-3 text-sm text-ink-body">
        No nightly history recorded yet — the first run after this update starts it.
      </p>
    );
  }
  return (
    <div className="mt-3">
      <ol className="flex gap-1" aria-label={`The last ${nights.length} nights`}>
        {nights.map((night) => (
          <li
            key={night.date}
            title={`${night.date} — ${night[which] === "none" ? "nothing recorded" : night[which]}`}
            className={`h-7 flex-1 rounded ${NIGHT[night[which]]}`}
          >
            <span className="sr-only">
              {night.date}: {night[which] === "none" ? "nothing recorded" : night[which]}
            </span>
          </li>
        ))}
      </ol>
      <div className="mt-1 flex justify-between font-mono text-[11px] text-ink-secondary">
        <span>{nights[0]?.date.slice(5)}</span>
        <span>{nights[nights.length - 1]?.date.slice(5)}</span>
      </div>
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
  if (state === "unknown") return "border-line-strong text-ink-body";
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
  window,
}: {
  days: Week[];
  sends: Week[];
  print: { calls: number }[];
  /** The page's period, for the printing line. */
  window: number;
}) {
  const printed = print.reduce((sum, line) => sum + line.calls, 0);
  return (
    <section>
      <h2 className="font-display text-lg font-semibold text-ink-strong">What it did</h2>
      <p className="mt-1 text-sm text-ink-body">
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
      <p className="mt-3 text-sm text-ink-body">
        {printed === 0
          ? `Nothing has been printed in the last ${window} days.`
          : `${printed} ${printed === 1 ? "thing" : "things"} printed in the last ${window} days.`}
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
 *
 * The held names are listed rather than counted — B1354. A count answers "is
 * anything held" and the operator's actual question is "is *that* name held,
 * and may I have it back": freeing one was `rm` on the server, which is a
 * shell nobody but the operator has and nobody should need for this.
 *
 * **Two shapes, and they must not read alike** — B1073. `.deleted/<user>.json`
 * is a whole journal, gone, its name held so nobody else can take it.
 * `.deleted/<user>/<trip>.json` is one trip of a journal that is still here —
 * the journal itself was never touched, and no name is held at all; the file
 * only makes the trip's old URLs answer 410 instead of quietly becoming
 * somebody else's pages. Reading a directory listing of both shapes side by
 * side is exactly how this got misread once already (see B1073): so the two
 * are in separate lists here, under separate headings, each saying in words
 * what freeing it would and would not do. Trip tombstones have no Release
 * button — `clearTombstone` only ever touches a journal's file, and building
 * one for a trip is deliberately left for later.
 */
function Roster({ report, stones }: { report: { journals: StatusRow[] }; stones: Tombstone[] }) {
  const empty = report.journals.filter((row) => row.days === 0).length;
  const journalStones = stones.filter((stone) => stone.kind === "journal");
  const tripStones = stones.filter((stone) => stone.kind === "trip");
  return (
    <section>
      <h2 className="font-display text-lg font-semibold text-ink-strong">Roster</h2>
      <ul className="mt-3 divide-y divide-line-quiet border-t border-line-quiet">
        <li className="flex items-baseline justify-between gap-3 py-2">
          <span className="text-sm text-ink-body">Journals</span>
          <span className="font-mono text-sm text-ink-strong">{report.journals.length}</span>
        </li>
        <li className="flex items-baseline justify-between gap-3 py-2">
          <span className="text-sm text-ink-body">Never wrote a day</span>
          <span className="font-mono text-sm text-ink-strong">{empty}</span>
        </li>
        <li className="flex items-baseline justify-between gap-3 py-2">
          <span className="text-sm text-ink-body">Deleted journals, name still held</span>
          <span className="font-mono text-sm text-ink-strong">{journalStones.length}</span>
        </li>
        <li className="flex items-baseline justify-between gap-3 py-2">
          <span className="text-sm text-ink-body">Deleted trips, of journals still here</span>
          <span className="font-mono text-sm text-ink-strong">{tripStones.length}</span>
        </li>
      </ul>
      {journalStones.length > 0 && (
        <div className="mt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">
            Whole journals deleted — the name is held
          </h3>
          <p className="mt-1 text-xs text-ink-body">
            Nobody may sign up as this name until it is released. Releasing does not restore
            anything; it only lets the next person to type the name take it, and its old URLs stop
            answering &ldquo;gone&rdquo; and start answering &ldquo;not found&rdquo;.
          </p>
          <ul className="mt-2 space-y-2">
            {journalStones.map((stone) => (
              <li
                key={stone.username}
                className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 rounded-xl border border-line-quiet bg-surface-base p-3"
              >
                <div>
                  <p className="font-mono text-sm text-ink-strong">/{stone.username}</p>
                  <p className="text-xs text-ink-body">
                    “{stone.title}” · deleted {stone.deletedAt.slice(0, 10)}
                  </p>
                </div>
                <ReleaseName username={stone.username} title={stone.title} />
              </li>
            ))}
          </ul>
        </div>
      )}
      {tripStones.length > 0 && (
        <div className="mt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">
            One trip deleted — the journal is still here
          </h3>
          <p className="mt-1 text-xs text-ink-body">
            The journal itself was never touched and holds no name back. The record only keeps the
            trip&rsquo;s own old links answering &ldquo;gone&rdquo; rather than becoming a new trip
            of the same id; freeing it is{" "}
            <span className="font-mono">
              rm content/.deleted/&lt;user&gt;/&lt;trip&gt;.json
            </span>{" "}
            on the server, which nothing here does yet.
          </p>
          <ul className="mt-2 space-y-2">
            {tripStones.map((stone) => (
              <li
                key={`${stone.username}/${stone.tripId}`}
                className="rounded-xl border border-line-quiet bg-surface-base p-3"
              >
                <p className="font-mono text-sm text-ink-strong">
                  {stone.username}/{stone.tripId}
                </p>
                <p className="text-xs text-ink-body">
                  “{stone.title}” · deleted {stone.deletedAt.slice(0, 10)}
                </p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
