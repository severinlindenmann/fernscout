"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  CalendarPlus,
  Compass,
  Download,
  Images,
  Mailbox,
  MapPinned,
  Mic,
  Search,
  Send,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import DeleteAccount from "@/components/DeleteAccount";
import { useShareInboxAutoConnect } from "@/components/studio/ShareInboxConnect";
import ScheduleRouteNotices from "@/components/studio/ScheduleRouteNotices";
import WaitingDays from "@/components/studio/WaitingDays";
import ExportAccount from "@/components/ExportAccount";
import { useI18n } from "@/components/LocaleProvider";
import { useStudioBar } from "@/components/studio/StudioBar";
import StudioPage from "@/components/studio/StudioPage";
import { formatStagedBytes } from "@/lib/validate/media";
import { GROUP_HUE, type StudioGroup } from "@/lib/studio/groups";
import { bringInFirstRows, buildHubGroups, filterHubGroups, journalRows, type Row } from "@/lib/studio/hubGroups";
import type { ResumableImportSummary, StudioHubModel } from "@/lib/studio/hub";
import type { TranslationKey } from "@/lib/i18n";
import { daysUntil, readerTodayISO } from "@/lib/tripTime";
import { unfinishedIcon, unfinishedTitle } from "@paid/printOrder/components/studio/UnfinishedPrint";
import type { OrderRow, UnfinishedPrint } from "@paid/printOrder/lib/orders";
import { addDayExpiresOn, readAddDaySnapshot, type AddDaySnapshot } from "@/lib/studio/addDayResume";

type T = (key: TranslationKey, vars?: Record<string, string>) => string;

type HeroModel = {
  href: string;
  Icon: LucideIcon;
  title: string;
  description: string;
  cta: string;
  /** B2304 — the small link beside the hero that switches mode ("write
   *  instead" / "speak instead") or offers the exception to the state's own
   *  rule ("tell about a day anyway" between trips). Absent when there is
   *  no second path worth naming. */
  altLink?: { href: string; label: string };
};

/**
 * The one hero, chosen by state (B2304, spec §"Only the top of the page
 * changes"). Replaces the old always-both TellToday-card-plus-Hero-card
 * stack: on a phone the owner is either mid-trip (write or speak about
 * today, or told already), a day from departure (plan), or between trips
 * (start one) — never more than one of those is true, so only one card is
 * ever the right one to lead with.
 */
function heroFor(model: StudioHubModel, speak: boolean, username: string, t: T): HeroModel {
  if (model.kind === "empty") {
    return {
      href: `/${username}/studio/trip/new`,
      Icon: Compass,
      title: t("studio.hub.empty.cta"),
      description: t("studio.hub.empty.ctaHint"),
      cta: t("studio.hub.newTrip.cta"),
    };
  }

  if (model.addDayTrip?.current) {
    const trip = model.addDayTrip;
    if (model.toldToday) {
      return {
        href: `/${username}/studio/day/new?from=hub`,
        Icon: CalendarPlus,
        title: t("studio.hub.addDay.toldToday.title"),
        description: t("studio.hub.addDay.toldToday.subtitle", { trip: trip.title }),
        cta: t("studio.hub.addDay.toldToday.cta"),
        altLink: { href: `/${username}/studio/day/edit`, label: t("studio.hub.addDay.change") },
      };
    }
    if (speak) {
      return {
        href: `/${username}/studio/day/new?mode=speak&from=hub`,
        Icon: Mic,
        title: t("studio.hub.speak.title"),
        description: t("studio.hub.speak.subtitle"),
        cta: t("studio.hub.speak.cta"),
        altLink: { href: `/${username}/studio/day/new?from=hub`, label: t("studio.hub.hero.writeInstead") },
      };
    }
    return {
      href: `/${username}/studio/day/new?from=hub`,
      Icon: CalendarPlus,
      title: t("studio.hub.addDay.title"),
      description: t("studio.hub.addDay.subtitle", { trip: trip.title }),
      cta: t("studio.hub.addDay.cta"),
    };
  }

  // A trip starting tomorrow (or today, not yet declared current) gets the
  // plan hero instead of the generic "start a trip" one — nothing to start,
  // it already exists; what is missing is a plan.
  if (model.planTrip && model.facts.planStartsInDays !== null && model.facts.planStartsInDays <= 1) {
    return {
      href: `/${username}/studio/plan/${model.planTrip.id}`,
      Icon: MapPinned,
      title: t("studio.hub.plan.hero.title", { trip: model.planTrip.title }),
      description: t("studio.hub.plan.hero.subtitle"),
      cta: t("studio.hub.plan.hero.cta"),
    };
  }

  // Between trips — no current trip, and nothing imminent enough to plan
  // for yet. An ended trip is still reachable, honestly labelled, from the
  // Write group below (unchanged).
  return {
    href: `/${username}/studio/trip/new`,
    Icon: Compass,
    title: t("studio.hub.betweenTrips.title"),
    description: t("studio.hub.item.newTrip.description"),
    cta: t("studio.hub.newTrip.cta"),
    altLink: speak ? { href: `/${username}/studio/day/new?mode=speak&from=hub`, label: t("studio.hub.hero.tellAnyway") } : undefined,
  };
}

/**
 * `/[user]/studio` — the Desk (B2066, after B1829's hub; calmed by B2304).
 *
 * One hero for the thing most likely next, then the six groups as cards in a
 * fixed order, each row one distinct icon, a title and one line saying what it
 * does. A row whose flow cannot run right now stays in the list, greyed, with
 * its reason — never hidden. `buildStudioHubModel` (`lib/studio/hub.ts`) does
 * every read server-side; this component only renders.
 */
export default function StudioHub({
  username,
  model,
  speak = false,
}: {
  username: string;
  model: StudioHubModel;
  /** B2194 — the owner chose to tell days by voice, and transcription is on:
   *  the hero becomes the mic, during a trip, until today is told. */
  speak?: boolean;
}) {
  // The iPhone connects itself for Photos → Share the first time the studio
  // opens; the status lives on /me — B2206.
  useShareInboxAutoConnect(username);
  const { t, tn, locale } = useI18n();
  const [query, setQuery] = useState("");

  // B2304 — no floating pill on the hub any more: it repeated the hero and
  // two of the group grid's own rows, one more "door" on a page about
  // having fewer of them. `replace: true` keeps the provider's own default
  // back-to-studio link off the hub too — the hub *is* the studio, so that
  // link would point at itself (B2001, unchanged). Deeper studio pages keep
  // their own bar.
  useStudioBar(null, { replace: true });

  const hero = heroFor(model, speak, username, t);

  const halfDone = (
    <HalfDone username={username} runs={model.resumableImports} postcard={model.postcardSuggestion} unfinished={model.print.unfinished} />
  );

  // Hooks run unconditionally, before the empty-state's own early return —
  // `buildHubGroups` only accepts the "full" model, so the empty branch is
  // handed an empty array it never renders.
  const allGroups = useMemo(
    () => (model.kind === "full" ? buildHubGroups(model, username, t, tn, locale) : []),
    [model, username, t, tn, locale],
  );
  const groups = useMemo(() => filterHubGroups(allGroups, query), [allGroups, query]);

  if (model.kind === "empty")
    return (
      <StudioPage username={username} back={false} width="wide" title={t("studio.hub.empty.title")} lede={t("studio.hub.empty.body")}>
        <Hero {...hero} />
        <WaitingDays username={username} model={model.waitingDays} canWrite={false} />
        {halfDone}
        <div className="mt-3 grid grid-cols-1 items-start gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <GroupCard group="bringIn" rows={bringInFirstRows(username, t)} />
          <JournalCard username={username} rows={journalRows(username, t, tn, locale, model.analyticsEnabled, model.account)} />
        </div>
      </StudioPage>
    );

  const duringTrip = Boolean(model.addDayTrip?.current);
  const waitingThisTrip = duringTrip
    ? (model.waitingDays?.cards.find((c) => c.trip?.id === model.addDayTrip!.id) ?? null)
    : null;
  const waitingThisTripCount = duringTrip ? (model.waitingDays?.cards.filter((c) => c.trip?.id === model.addDayTrip!.id).length ?? 0) : 0;

  return (
    <StudioPage username={username} back={false} width="wide" title={t("studio.hub.title")}>
      <Hero {...hero} />
      {hero.altLink && (
        <Link
          href={hero.altLink.href}
          data-hero-alt
          className="mt-2 inline-flex min-h-11 items-center px-1 text-sm font-semibold text-ink-strong underline underline-offset-2"
        >
          {hero.altLink.label}
        </Link>
      )}
      {duringTrip ? (
        // B2304 — during a trip, at most three one-tap rows replace the
        // full "Waiting for your words" card list and the plan notice:
        // the owner's own complaint was everything showing at once.
        <DuringTripRows
          username={username}
          waitingCount={waitingThisTripCount}
          waitingFirstDate={waitingThisTrip?.date ?? null}
          drafts={model.facts.drafts}
          showPostcard={!model.cannotRun.postcard}
        />
      ) : (
        <>
          <WaitingDays username={username} model={model.waitingDays} canWrite />
          {/* B2197 — one notice for each future trip not yet armed or declined. */}
          <ScheduleRouteNotices username={username} trips={model.routeRecordingTrips} />
        </>
      )}
      {halfDone}
      <label className="relative mt-3 block">
        <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-secondary" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t("studio.hub.filter.placeholder")}
          aria-label={t("studio.hub.filter.placeholder")}
          data-hub-filter
          className="min-h-11 w-full rounded-full border border-line-faint bg-surface-raised py-2 pl-9 pr-4 text-sm text-ink-strong
                     placeholder:text-ink-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
        />
      </label>
      <div className="mt-3 grid grid-cols-1 items-start gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {groups.map(({ group, rows }) => (
          <GroupCard
            key={group}
            group={group}
            rows={rows}
            foot={group === "print" ? <RecentOrders username={username} orders={model.print.recentOrders} /> : undefined}
          />
        ))}
        <JournalCard username={username} rows={journalRows(username, t, tn, locale, model.analyticsEnabled, model.account)} />
      </div>
    </StudioPage>
  );
}

/** B2304 — the during-trip hero's at-most-three rows: photos waiting for
 *  words on this trip, sharing a day, and a postcard when printing is on.
 *  A row is left out rather than shown disabled — each is only ever a real
 *  next step, never a door onto something switched off. */
function DuringTripRows({
  username,
  waitingCount,
  waitingFirstDate,
  drafts,
  showPostcard,
}: {
  username: string;
  waitingCount: number;
  waitingFirstDate: string | null;
  drafts: number;
  showPostcard: boolean;
}) {
  const { t, tn } = useI18n();
  const rows: { key: string; href: string; Icon: LucideIcon; title: string; detail: string; fact?: string }[] = [
    ...(waitingCount > 0 && waitingFirstDate
      ? [
          {
            key: "waiting",
            href: `/${username}/studio/day/new?photos=${waitingFirstDate}&from=hub`,
            Icon: Images,
            title: t("studio.hub.duringTrip.waiting.title"),
            detail: tn("studio.hub.duringTrip.waiting.detail", waitingCount, { count: String(waitingCount) }),
          },
        ]
      : []),
    {
      key: "share",
      href: `/${username}/studio/day/publish`,
      Icon: Send,
      title: t("studio.hub.item.publishDay.title"),
      detail: t("studio.hub.item.publishDay.description"),
      fact: drafts > 0 ? tn("studio.hub.fact.drafts", drafts, { count: String(drafts) }) : undefined,
    },
    ...(showPostcard
      ? [
          {
            key: "postcard",
            href: `/${username}/studio/postcard`,
            Icon: Mailbox,
            title: t("studio.hub.item.postcard.title"),
            detail: t("studio.hub.item.postcard.description"),
          },
        ]
      : []),
  ];
  return (
    <ul data-during-trip-rows className="mt-3 divide-y divide-line-faint rounded-2xl border border-line-faint bg-surface-raised px-2.5">
      {rows.map((row) => (
        <li key={row.key}>
          <Link
            href={row.href}
            className="flex min-h-11 items-center gap-3 rounded-[10px] px-1.5 py-2 transition-colors hover:bg-surface-neutral
                       focus-visible:bg-surface-neutral focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
          >
            <row.Icon className="h-5 w-5 flex-none text-ink-body" aria-hidden strokeWidth={2} />
            <span className="min-w-0 flex-1">
              <span className="block text-[15px] font-semibold leading-tight text-ink-strong">{row.title}</span>
              <span className="mt-0.5 block text-[12.5px] leading-snug text-ink-secondary">{row.detail}</span>
            </span>
            {row.fact && <Chip fact>{row.fact}</Chip>}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Hero({ href, Icon, title, description, cta }: { href: string; Icon: LucideIcon; title: string; description: string; cta: string }) {
  return (
    <Link
      href={href}
      data-hero
      className="mt-4 flex flex-wrap items-start gap-3 rounded-[20px] border-[1.5px] border-yellow-600 bg-yellow-50 p-4
                 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 sm:items-center sm:px-5 sm:py-5"
    >
      <span
        aria-hidden="true"
        className="grid size-10 flex-none place-items-center rounded-[11px] border border-line-faint bg-surface-raised text-ink-strong"
      >
        <Icon size={20} />
      </span>
      <span className="min-w-[200px] flex-1">
        <span className="block font-display text-[23px] font-semibold leading-tight text-ink-strong">{title}</span>
        <span className="mt-1 block text-sm text-ink-secondary">{description}</span>
      </span>
      <span className="inline-flex min-h-11 items-center rounded-full bg-action-strong px-5 text-[15px] font-semibold text-on-action">
        {cta}
      </span>
    </Link>
  );
}

/** A group's card header: its tinted square (the hue is only a fill) and its
 *  name. No row count — B2134: it said nothing a glance at the card does not. */
function CardHeader({ group, mix = 22 }: { group: StudioGroup; mix?: number }) {
  const { t } = useI18n();
  const { hue, icon: Icon, labelKey } = GROUP_HUE[group];
  return (
    <h2 id={`h-${group}`} className="mb-1.5 flex items-center gap-2.5 border-b border-line-faint px-1 pb-2.5">
      <span
        aria-hidden="true"
        className="grid size-10 flex-none place-items-center rounded-[11px] border border-line-faint text-ink-strong"
        style={{ background: `color-mix(in srgb, ${hue} ${mix}%, var(--surface-raised))` }}
      >
        <Icon size={20} />
      </span>
      <span className="font-display text-[19px] font-semibold text-ink-strong">{t(labelKey)}</span>
    </h2>
  );
}

function GroupCard({ group, rows, foot }: { group: StudioGroup; rows: Row[]; foot?: React.ReactNode }) {
  return (
    <section
      id={group}
      data-group={group}
      aria-labelledby={`h-${group}`}
      className="scroll-mt-20 rounded-2xl border border-line-faint bg-surface-raised px-2.5 pb-1.5 pt-3"
    >
      <CardHeader group={group} />
      <ul className="divide-y divide-line-faint">
        {rows.map((row) => (
          <li key={row.href}>
            <HubRow row={row} />
          </li>
        ))}
      </ul>
      {foot}
    </section>
  );
}

function HubRow({ row, compact = false }: { row: Row; compact?: boolean }) {
  const { t } = useI18n();
  const off = Boolean(row.reason);
  const line = row.reason ?? row.description;
  return (
    <Link
      href={row.href}
      data-row
      className={`flex flex-wrap items-center gap-x-3 rounded-[10px] px-1.5 py-[7px] transition-colors hover:bg-surface-neutral
                  focus-visible:bg-surface-neutral focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 ${
                    compact && !line ? "min-h-11" : "min-h-[52px]"
                  }`}
    >
      <row.Icon className={`h-5 w-5 flex-none ${off ? "text-ink-faint" : "text-ink-body"}`} aria-hidden strokeWidth={2} />
      <span className="min-w-0 flex-1 basis-0">
        {/* The chip stays on the title's line (B2134): a long title wraps
            inside its own box instead of pushing the chip onto a line alone. */}
        <span className="flex items-start gap-x-2">
          <span className={`min-w-0 flex-1 break-words hyphens-auto font-semibold leading-tight text-ink-strong ${compact ? "text-sm" : "text-[15px]"}`}>
            {row.title}
          </span>
          {off ? <Chip>{t("studio.hub.chip.off")}</Chip> : row.fact ? <Chip fact>{row.fact}</Chip> : null}
        </span>
        {line && (
          <span data-desc className={`mt-0.5 block text-[12.5px] leading-snug text-ink-secondary ${off ? "italic" : ""}`}>
            {line}
          </span>
        )}
      </span>
      {/* B2156 — the chip line takes the whole row, under the icon column too,
          so three chips fit in a desktop column; the icon stays on the title. */}
      {row.factLine && !off && (
        <span className="mt-1.5 flex basis-full flex-wrap gap-1 [&>*]:ml-0">
          {row.factLine.map((f) => (
            <Chip key={f.text} fact amber={f.amber}>
              {f.text}
            </Chip>
          ))}
        </span>
      )}
    </Link>
  );
}

function Chip({ children, fact = false, amber = false }: { children: React.ReactNode; fact?: boolean; amber?: boolean }) {
  // Amber is a fill and a border only; the words stay ink (test/contrast.test.ts).
  const tone = amber ? "border-yellow-600 bg-yellow-100 text-ink-strong" : "border-line-faint bg-surface-neutral text-ink-secondary";
  return (
    <span
      data-fact={fact || undefined}
      data-amber={amber || undefined}
      className={`ml-auto flex-none whitespace-nowrap rounded-full border px-1.5 py-[5px] font-mono text-[11px] font-medium leading-none ${tone}`}
    >
      {children}
    </span>
  );
}

/**
 * The quiet Journal card: titles only, one column (B2155: two columns wrapped
 * every German title at tablet width), and the Export and Delete
 * tiles inside it — B1295/B1346 moved from `/[user]/me` by B2017, tiles since
 * B2023. Pressing a tile opens that component with its question already
 * showing, so nothing is sent on the first press; Cancel folds it away.
 */
function JournalCard({ username, rows }: { username: string; rows: Row[] }) {
  const { t } = useI18n();
  const [open, setOpen] = useState<"export" | "delete" | null>(null);
  const tile =
    "flex min-h-[52px] w-full items-center gap-3 rounded-[10px] border px-2.5 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500";
  return (
    <section
      id="journal"
      data-group="journal"
      aria-labelledby="h-journal"
      className="scroll-mt-20 rounded-2xl border border-line-faint bg-surface-neutral px-2.5 pb-2.5 pt-3"
    >
      <CardHeader group="journal" mix={40} />
      <ul>
        {rows.map((row) => (
          <li key={row.href} className="min-w-0">
            <HubRow row={row} compact />
          </li>
        ))}
      </ul>
      <div className="mt-2 grid grid-cols-1 gap-2 border-t border-line-faint pt-2.5">
        <button
          type="button"
          aria-expanded={open === "export"}
          onClick={() => setOpen(open === "export" ? null : "export")}
          className={`${tile} border-line-faint bg-surface-raised hover:bg-surface-subtle`}
        >
          <Download className="h-5 w-5 flex-none text-ink-body" aria-hidden strokeWidth={2} />
          <span className="min-w-0">
            <span className="block text-sm font-semibold leading-tight text-ink-strong">{t("me.exportTitle")}</span>
            <span className="mt-0.5 block text-[12.5px] leading-snug text-ink-secondary">
              {t("studio.hub.item.export.description")}
            </span>
          </span>
        </button>
        <button
          type="button"
          aria-expanded={open === "delete"}
          onClick={() => setOpen(open === "delete" ? null : "delete")}
          className={`${tile} border-coral-100 bg-coral-50 hover:bg-coral-100`}
        >
          <Trash2 className="h-5 w-5 flex-none text-coral-600" aria-hidden strokeWidth={2} />
          <span className="min-w-0">
            <span className="block text-sm font-semibold leading-tight text-ink-strong">{t("me.deleteTitle")}</span>
            <span className="mt-0.5 block text-[12.5px] leading-snug text-ink-secondary">
              {t("studio.hub.item.delete.description")}
            </span>
          </span>
        </button>
      </div>
      {open === "export" ? <ExportAccount key="export" username={username} open onClose={() => setOpen(null)} /> : null}
      {open === "delete" ? <DeleteAccount key="delete" username={username} open onClose={() => setOpen(null)} /> : null}
    </section>
  );
}

type CarryRow = { key: string; href: string; Icon: LucideIcon; title: string; detail: string; chip: string };

/**
 * Half done — B2067, slimmed to one line by B2304. Everything started and
 * not finished: the add-day draft (client-side, in `sessionStorage`, so read
 * once after mount — server and client agree on the first paint), each
 * resumable photographs import, and the postcard worth sending. Absent when
 * there is nothing, never an empty box.
 *
 * Only the first item shows, plus "+N more" — the owner's own complaint was
 * everything on the page at once, and a half-done list can otherwise grow to
 * several rows of its own. The one exception: a photographs import that
 * expires within 3 days is promoted to that first slot regardless of when it
 * was started, since it is the one item here with a real deadline. "+N more"
 * expands the rest inline; nothing is ever hidden for good.
 */
function HalfDone({
  username,
  runs,
  postcard,
  unfinished,
}: {
  username: string;
  runs: ResumableImportSummary[];
  postcard: { dayTitle: string; dayHref: string } | null;
  /** B2135 — postcards not sent and photobook setups not ordered. */
  unfinished: UnfinishedPrint[];
}) {
  const { t, tn, locale, formatLongDate, formatShortDate } = useI18n();
  const [snapshot, setSnapshot] = useState<AddDaySnapshot | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- see the doc comment above.
    setSnapshot(readAddDaySnapshot(username));
  }, [username]);

  const carryOn = t("studio.hub.resume.import.cta");
  const rows: CarryRow[] = [
    ...(snapshot
      ? [
          {
            key: "add-day",
            href: `/${username}/studio/day/new`,
            Icon: CalendarPlus,
            title: t("studio.hub.resume.addDay.title"),
            detail: t("studio.hub.resume.addDay.detail", { date: formatLongDate(addDayExpiresOn(snapshot.savedAt)) }),
            chip: carryOn,
          },
        ]
      : []),
    ...runs.map((run) => ({
      key: run.runId,
      href: `/${username}/studio/photos`,
      Icon: Images,
      title: tn("studio.hub.resume.import.title", run.livePhotoCount, { count: String(run.livePhotoCount) }),
      detail: tn("studio.hub.resume.import.detail", run.daysLeftToTell, {
        daysLeft: String(run.daysLeftToTell),
        size: formatStagedBytes(run.stagedBytes, locale),
      }),
      chip: carryOn,
    })),
    ...unfinished.map((item) => ({
      key: item.kind === "postcard" ? `postcard-${item.id}` : `photobook-${item.trip}`,
      href: item.href,
      Icon: unfinishedIcon(item),
      title: unfinishedTitle(item, t, locale),
      detail: t("studio.unfinished.detail", { date: formatShortDate(item.updatedAt.slice(0, 10)) }),
      chip: carryOn,
    })),
    // B2172 — composing a postcard is the studio's own flow now, so this
    // opens `/studio/postcard` rather than the read-only day (the day's own
    // photograph is what the flow starts from, not something to look at
    // first).
    ...(postcard
      ? [
          {
            key: "postcard",
            href: `/${username}/studio/postcard`,
            Icon: Mailbox,
            title: t("me.postcardCardTitle"),
            detail: t("me.postcardCardBody", { title: postcard.dayTitle }),
            chip: t("me.postcardCardOpen"),
          },
        ]
      : []),
  ];

  if (rows.length === 0) return null;

  // An import expiring within 3 days always shows — promoted to the front
  // if it is not already the row that would have led.
  // `daysUntil` clamps a past date to 0, so an already-expired run must be
  // excluded explicitly — otherwise it would read as maximally "urgent"
  // rather than simply gone.
  const today = readerTodayISO();
  const urgentRunIds = new Set(
    runs.filter((r) => r.expiresAt.slice(0, 10) >= today && daysUntil(r.expiresAt.slice(0, 10)) <= 3).map((r) => r.runId),
  );
  const urgentIndex = rows.findIndex((r) => urgentRunIds.has(r.key));
  const ordered = urgentIndex > 0 ? [rows[urgentIndex], ...rows.filter((_, i) => i !== urgentIndex)] : rows;
  const shown = expanded ? ordered : ordered.slice(0, 1);
  const more = ordered.length - shown.length;

  return (
    <section
      data-half-done
      aria-labelledby="h-half-done"
      className="mt-3 rounded-2xl border border-dashed border-navy-500 bg-surface-raised px-3 py-2.5"
    >
      <h2 id="h-half-done" className="mb-1.5 mt-0.5 font-mono text-[11px] font-medium uppercase tracking-[.06em] text-ink-secondary">
        {t("studio.hub.halfDone")}
      </h2>
      <ul>
        {shown.map((row) => (
          <li key={row.key}>
            <Link
              href={row.href}
              className="flex min-h-11 items-center gap-3 rounded-[10px] px-1.5 py-1.5 transition-colors hover:bg-surface-neutral
                         focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
            >
              <row.Icon className="h-5 w-5 flex-none text-ink-body" aria-hidden strokeWidth={2} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold leading-tight text-ink-strong">{row.title}</span>
                <span className="mt-0.5 block text-[12.5px] leading-snug text-ink-secondary">{row.detail}</span>
              </span>
              <Chip>{row.chip}</Chip>
            </Link>
          </li>
        ))}
      </ul>
      {more > 0 && (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-0.5 inline-flex min-h-11 items-center px-1.5 text-sm font-semibold text-ink-strong underline underline-offset-2"
        >
          {tn("studio.hub.halfDone.more", more, { count: String(more) })}
        </button>
      )}
    </section>
  );
}

/**
 * The Print card's foot — B2135: the last three orders (drafts are in Half
 * done, not here), each with its status and date and linking to the page its
 * mail carried, then every order on `/studio/orders`. Absent before a first order.
 */
function RecentOrders({ username, orders }: { username: string; orders: OrderRow[] }) {
  const { t, formatShortDate } = useI18n();
  if (orders.length === 0) return null;
  return (
    <div data-recent-orders className="mt-1.5 border-t border-line-faint px-1.5 pb-1 pt-2.5">
      <h3 className="font-mono text-[11px] font-medium uppercase tracking-[.06em] text-ink-secondary">{t("studio.hub.recentOrders")}</h3>
      <ul className="mt-1">
        {orders.map((order) => (
          <li key={`${order.kind}-${order.id}`}>
            <Link
              href={`/${username}/${order.kind === "postcard" ? "postcards" : "photobooks"}/${order.id}`}
              className="flex min-h-11 items-center rounded-[10px] px-1.5 text-[13px] text-ink-strong transition-colors hover:bg-surface-neutral
                         focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
            >
              {[
                t(`orders.kind.${order.kind}` as TranslationKey),
                t(`orders.status.${order.status}` as TranslationKey),
                formatShortDate(order.createdAt.slice(0, 10)),
              ].join(" · ")}
            </Link>
          </li>
        ))}
      </ul>
      <Link href={`/${username}/studio/orders`} className="mt-1 inline-flex min-h-11 items-center px-1.5 text-sm font-semibold text-ink-strong underline underline-offset-2">
        {t("studio.hub.allOrders")}
      </Link>
    </div>
  );
}
