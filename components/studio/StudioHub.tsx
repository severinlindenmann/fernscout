"use client";

import { useEffect, useId, useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import {
  CalendarPlus,
  ChevronDown,
  Compass,
  Download,
  Images,
  Library,
  Mailbox,
  MapPinned,
  Printer,
  Search,
  Trash2,
  X,
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
import {
  bringInFirstRows,
  buildHubGroups,
  firstVisitDoors,
  filterHubGroups,
  journalRows,
  peopleRows,
  rowMatchesQuery,
  todayRows,
  tripsRows,
  type EverythingGroup,
  type Row,
} from "@/lib/studio/hubGroups";
import type { PostcardCard, ResumableImportSummary, StudioHubModel } from "@/lib/studio/hub";
import type { TranslationKey } from "@/lib/i18n";
import { daysUntil, readerTodayISO } from "@/lib/tripTime";
import { unfinishedIcon, unfinishedTitle } from "@paid/printOrder/components/studio/UnfinishedPrint";
import type { OrderRow, UnfinishedPrint } from "@paid/printOrder/lib/orders";
import { addDayExpiresOn, readAddDaySnapshot, type AddDaySnapshot } from "@/lib/studio/addDayResume";

import { journalPath } from "@/lib/journalPath";
type T = (key: TranslationKey, vars?: Record<string, string>) => string;

const DOOR_HUE = { newTrip: "var(--color-yellow-400)", polarsteps: "var(--color-blue-500)", photos: "var(--color-green-500)" };

/** B2810 — per journal, per device; storage can be blocked, so both ends are
 *  guarded and a failure just means the welcome shows again. */
const welcomeKey = (username: string) => `fs.studioWelcomeSkipped.${username}`;
const WELCOME_EVENT = "fs-studio-welcome";
const subscribeWelcome = (cb: () => void) => {
  window.addEventListener(WELCOME_EVENT, cb);
  return () => window.removeEventListener(WELCOME_EVENT, cb);
};
// Remembered for the page's life even where storage is blocked.
const skippedNow = new Set<string>();
function readWelcomeSkipped(username: string): boolean {
  if (skippedNow.has(username)) return true;
  try {
    return localStorage.getItem(welcomeKey(username)) === "1";
  } catch {
    return false;
  }
}
function writeWelcomeSkipped(username: string) {
  skippedNow.add(username);
  try {
    localStorage.setItem(welcomeKey(username), "1");
  } catch {
    /* the welcome shows again next visit */
  }
  window.dispatchEvent(new Event(WELCOME_EVENT));
}

/** B2600 — "Everything else"'s four cards: a tinted icon, a title and (on
 *  phone, where they open and close) one summary line. Independent of
 *  `GROUP_HUE` (the per-subpage crumb, unchanged) — these are the hub's own
 *  box titles, not a subpage's breadcrumb. */
const EVERYTHING_CARD: Record<EverythingGroup | "journal", { hue: string; icon: LucideIcon; titleKey: TranslationKey; summaryKey: TranslationKey }> = {
  tripsPeople: { hue: GROUP_HUE.plan.hue, icon: Compass, titleKey: "studio.hub.everything.tripsPeople", summaryKey: "studio.hub.everything.tripsPeople.summary" },
  bringIn: { hue: GROUP_HUE.bringIn.hue, icon: GROUP_HUE.bringIn.icon, titleKey: "studio.hub.group.bringIn", summaryKey: "studio.hub.everything.bringIn.summary" },
  print: { hue: GROUP_HUE.print.hue, icon: Printer, titleKey: "studio.hub.group.print", summaryKey: "studio.hub.everything.print.summary" },
  journal: { hue: GROUP_HUE.journal.hue, icon: Library, titleKey: "studio.hub.everything.journalAccount", summaryKey: "studio.hub.everything.journalAccount.summary" },
};

type HeroModel = {
  href: string;
  Icon: LucideIcon;
  title: string;
  description: string;
  cta: string;
  /** B2304 — the small link beside the hero, used only for "Change it" once
   *  today is already told. Absent when there is no second path worth
   *  naming. */
  altLink?: { href: string; label: string };
};

/**
 * The one hero, chosen by state (B2304, spec §"Only the top of the page
 * changes"). Replaces the old always-both TellToday-card-plus-Hero-card
 * stack: on a phone the owner is either mid-trip (write today, or told
 * already), a day from departure (plan), or between trips (start one) —
 * never more than one of those is true, so only one card is ever the right
 * one to lead with.
 */
function heroFor(model: StudioHubModel, username: string, t: T, formatLongDate: (iso: string) => string): HeroModel {
  if (model.kind === "empty") {
    return {
      href: `${journalPath(username)}/studio/trip/new`,
      Icon: Compass,
      title: t("studio.hub.empty.cta"),
      description: t("studio.hub.empty.ctaHint"),
      cta: t("studio.hub.newTrip.cta"),
    };
  }

  if (model.addDayTrip?.current) {
    const trip = model.addDayTrip;
    if (model.toldToday) {
      // B2676, decision 10 — "Today: “{title}” · Not published yet ·
      // Continue today", naming the day the owner already started rather
      // than the generic "Today is told".
      const day = model.toldTodayDay;
      // B2702 — a day with no title is named by its date, never "Untitled":
      // the same fallback `nameOf` already uses on the publish list.
      const dayName = day?.title || formatLongDate(readerTodayISO());
      return {
        // B2702 — "Continue today" opens the day just written, on the edit
        // flow, never a fresh "day/new" that asks "Add this to it?" about
        // the words it is itself the continuation of.
        href: day?.slug
          ? `${journalPath(username)}/studio/day/edit?slug=${encodeURIComponent(day.slug)}`
          : `${journalPath(username)}/studio/day/new`,
        Icon: CalendarPlus,
        title: t("studio.hub.addDay.toldToday.title", { title: dayName }),
        description: day?.published ? t("studio.hub.addDay.toldToday.published") : t("studio.hub.addDay.toldToday.subtitle"),
        cta: t("studio.hub.addDay.toldToday.cta"),
        altLink: { href: `${journalPath(username)}/studio/day/edit`, label: t("studio.hub.addDay.change") },
      };
    }
    return {
      href: `${journalPath(username)}/studio/day/new`,
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
      href: `${journalPath(username)}/studio/plan/${model.planTrip.id}`,
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
    href: `${journalPath(username)}/studio/trip/new`,
    Icon: Compass,
    title: t("studio.hub.betweenTrips.title"),
    description: t("studio.hub.item.newTrip.description"),
    cta: t("studio.hub.newTrip.cta"),
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
}: {
  username: string;
  model: StudioHubModel;
}) {
  // The iPhone connects itself for Photos → Share the first time the studio
  // opens; the status lives on /me — B2206.
  useShareInboxAutoConnect(username);
  const { t, tn, locale, formatLongDate } = useI18n();
  const [query, setQuery] = useState("");
  // B2810 — the first-visit welcome is shown once per journal per device;
  // `null` until the browser has been asked (nothing flashes meanwhile).
  const skipped = useSyncExternalStore(
    subscribeWelcome,
    () => readWelcomeSkipped(username),
    () => null,
  );

  // B2304 — no floating pill on the hub any more: it repeated the hero and
  // two of the group grid's own rows, one more "door" on a page about
  // having fewer of them. `replace: true` keeps the provider's own default
  // back-to-studio link off the hub too — the hub *is* the studio, so that
  // link would point at itself (B2001, unchanged). Deeper studio pages keep
  // their own bar.
  useStudioBar(null, { replace: true });

  const hero = heroFor(model, username, t, formatLongDate);

  const halfDone = (
    <HalfDone username={username} tripId={model.kind === "full" ? (model.addDayTrip?.id ?? "") : ""} runs={model.resumableImports} postcard={model.postcardSuggestion} unfinished={model.print.unfinished} />
  );

  // Hooks run unconditionally, before the empty-state's own early return —
  // `buildHubGroups` only accepts the "full" model, so the empty branch is
  // handed an empty array it never renders.
  const allGroups = useMemo(
    () => (model.kind === "full" ? buildHubGroups(model, username, t, tn, locale) : []),
    [model, username, t, tn, locale],
  );
  const groups = useMemo(() => filterHubGroups(allGroups, query), [allGroups, query]);

  // B2600 — the four "Everything else" cards, closed by default on phone
  // (never at desktop, see `EverythingCardShell`); typing into the filter
  // opens whichever ones matched, without forcing a card the owner closed
  // by hand shut again once they clear it.
  const [openByHand, setOpenByHand] = useState<Set<string>>(() => new Set());
  const toggleOpen = (key: string) =>
    setOpenByHand((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const todayRowsList = useMemo(() => (model.kind === "full" ? todayRows(model, username, t, tn) : []), [model, username, t, tn]);
  const journalFullRows = useMemo(
    () => (model.kind === "full" ? journalRows(username, t, tn, locale, model.analyticsEnabled, model.account) : []),
    [model, username, t, tn, locale],
  );
  // B2600 — Trips & people's own unfiltered rows, kept apart so the card's
  // two `#plan`/`#people` anchors each wrap only their own rows. Once a
  // query narrows the grid the anchors are moot (nothing to scroll back to
  // mid-search), so the filtered, merged list from `groups` renders instead.
  const tripsOnlyRows = useMemo(() => (model.kind === "full" ? tripsRows(model, username, t, tn) : []), [model, username, t, tn]);
  const peopleOnlyRows = useMemo(() => (model.kind === "full" ? peopleRows(model, username, t, tn) : []), [model, username, t, tn]);
  const journalMatches = query.trim() !== "" && journalFullRows.some((row) => rowMatchesQuery(row, query));
  const matchingKeys = useMemo(() => {
    if (!query.trim()) return new Set<string>();
    const s = new Set<string>(groups.map((g) => g.group));
    if (journalMatches) s.add("journal");
    return s;
  }, [groups, query, journalMatches]);
  const isOpen = (key: string) => openByHand.has(key) || matchingKeys.has(key);

  if (model.kind === "empty" && skipped !== true) {
    const { nickname, address } = model.welcome;
    return (
      <StudioPage
        username={username}
        back={false}
        width="wide"
        title={nickname ? t("studio.hub.first.title", { name: nickname }) : t("studio.hub.first.titleAnon")}
        lede={t("studio.hub.first.body", { address })}
      >
        <div className={skipped === null ? "invisible" : undefined}>
          <WaitingDays username={username} model={model.waitingDays} canWrite={false} />
          {halfDone}
          <ul className="mt-4 grid max-w-xl gap-3">
            {firstVisitDoors(username, model.welcome, model.extractOff, t).map(({ key, href, Icon, title, description }, i) => (
              <li key={key}>
                <Link
                  href={href}
                  data-door={key}
                  className={`flex min-h-11 items-center gap-3.5 rounded-2xl bg-surface-raised p-4 text-ink-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 ${
                    i === 0 ? "border-2 border-ink-strong" : "border border-line-faint"
                  }`}
                >
                  <span
                    aria-hidden="true"
                    className="grid size-11 flex-none place-items-center rounded-xl"
                    style={{ background: `color-mix(in srgb, ${DOOR_HUE[key]} ${key === "newTrip" ? 100 : 18}%, var(--surface-raised))` }}
                  >
                    <Icon size={22} />
                  </span>
                  <span>
                    <b className="block text-base">{title}</b>
                    <span className="block text-sm text-ink-secondary">{description}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => {
              writeWelcomeSkipped(username);
            }}
            className="mt-3 inline-flex min-h-11 items-center rounded px-4 text-[15px] font-semibold text-blue-700 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
          >
            {t("studio.hub.first.skip")}
          </button>
        </div>
      </StudioPage>
    );
  }

  if (model.kind === "empty")
    return (
      <StudioPage username={username} back={false} width="wide" title={t("studio.hub.empty.title")} lede={t("studio.hub.empty.body")}>
        <Hero {...hero} />
        <WaitingDays username={username} model={model.waitingDays} canWrite={false} />
        {halfDone}
        <div className="mt-3 grid grid-cols-1 items-start gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <GroupCard group="bringIn" rows={bringInFirstRows(username, t, model.extractOff)} arriveIndex={0} />
          <JournalCard username={username} rows={journalRows(username, t, tn, locale, model.analyticsEnabled, model.account)} arriveIndex={1} />
        </div>
      </StudioPage>
    );

  const duringTrip = Boolean(model.addDayTrip?.current);
  const waitingThisTrip = duringTrip
    ? (model.waitingDays?.cards.find((c) => c.trip?.id === model.addDayTrip!.id) ?? null)
    : null;
  const waitingThisTripCount = duringTrip ? (model.waitingDays?.cards.filter((c) => c.trip?.id === model.addDayTrip!.id).length ?? 0) : 0;

  const searching = query.trim() !== "";
  const nothingMatched = searching && groups.length === 0 && !journalMatches;

  return (
    <StudioPage username={username} back={false} width="wide" title={t("studio.hub.title")}>
      {/* B2664 — from lg up, two columns: today's things left, the rest as
          one list on the right. Below lg the two wrappers are plain blocks
          and the page reads exactly as before. */}
      <div className="lg:mt-4 lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start lg:gap-8">
      <div data-hub-main className="min-w-0">
      <FilterInput value={query} onChange={setQuery} className="mt-4 lg:mt-0" />

      {!searching && (
        <>
          <h2 id="h-today" className="mt-4 font-display text-lg font-semibold text-ink-strong">
            {t("studio.hub.today.heading")}
          </h2>
          <div className="mt-2 grid grid-cols-1 items-start gap-3 md:grid-cols-2 lg:grid-cols-1 lg:gap-4">
            <div className="lg:mt-2 lg:rounded-[24px] lg:border-[1.5px] lg:border-yellow-600 lg:bg-yellow-50 lg:p-6">
              <Hero {...hero} />
              {hero.altLink && (
                <Link
                  href={hero.altLink.href}
                  data-hero-alt
                  className="mt-2 inline-flex min-h-11 items-center px-1 text-sm font-semibold text-ink-strong underline underline-offset-2
                             lg:mt-4 lg:rounded-full lg:border-[1.5px] lg:border-yellow-600 lg:px-5 lg:no-underline lg:hover:bg-yellow-100"
                >
                  {hero.altLink.label}
                </Link>
              )}
            </div>
            <section
              id="write"
              data-group="write"
              className="rounded-2xl md:mt-4 border border-line-faint bg-surface-raised px-2.5 py-1.5 lg:mt-0 lg:border-0 lg:bg-transparent lg:p-0"
            >
              <ul className="divide-y divide-line-faint lg:grid lg:grid-cols-2 lg:gap-3 lg:divide-y-0">
                {todayRowsList.map((row) => (
                  <li key={row.href} className="lg:rounded-2xl lg:border lg:border-line-faint lg:bg-surface-raised lg:p-2">
                    <HubRow row={row} />
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </>
      )}
      {duringTrip ? (
        // B2600 — Publish and A postcard now live in Today's own card and in
        // Print, so the only thing left worth a one-tap shortcut during a
        // trip is photos still waiting for words on it; absent when there
        // are none.
        <DuringTripRows username={username} waitingCount={waitingThisTripCount} waitingFirstDate={waitingThisTrip?.date ?? null} />
      ) : (
        <>
          <WaitingDays username={username} model={model.waitingDays} canWrite />
          {/* B2197 — one notice for each future trip not yet armed or declined. */}
          <ScheduleRouteNotices username={username} trips={model.routeRecordingTrips} />
        </>
      )}
      {model.latestPublishedDay && (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-2xl border border-line-quiet bg-surface-raised p-4">
          <div className="min-w-0">
            <p className="font-semibold text-ink-strong">{t("studio.share.title")}</p>
            <p className="truncate text-sm text-ink-secondary">{model.latestPublishedDay.title}</p>
          </div>
          <Link
            href={`${journalPath(username)}/studio/day/share?trip=${encodeURIComponent(model.latestPublishedDay.tripId)}&day=${encodeURIComponent(model.latestPublishedDay.slug)}`}
            className="flex min-h-11 flex-none items-center rounded-full bg-yellow-400 px-4 text-sm font-semibold text-navy-900 hover:bg-yellow-300"
          >
            {t("studio.share.whatNextLabel")}
          </Link>
        </div>
      )}
      {halfDone}
      </div>

      <div data-hub-aside className="min-w-0">
      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 lg:mt-1">
        <h2 id="h-everything" className="font-display text-lg font-semibold text-ink-strong">
          {t("studio.hub.everything.heading")}
        </h2>
      </div>
      {groups.length > 0 && (
        <div className="mt-3 grid grid-cols-1 items-start gap-3 md:grid-cols-3 lg:grid-cols-1 lg:gap-0 lg:rounded-2xl lg:border lg:border-line-faint lg:bg-surface-raised lg:p-2">
          {groups.map(({ group, rows }, i) => (
            <EverythingCardShell key={group} group={group} open={isOpen(group)} onToggle={() => toggleOpen(group)} arriveIndex={i}>
              {group === "tripsPeople" && !searching ? (
                <>
                  <ul id="plan" className="divide-y divide-line-faint lg:divide-y-0">
                    {tripsOnlyRows.map((row) => (
                      <li key={row.href}>
                        <HubRow row={row} dense />
                      </li>
                    ))}
                  </ul>
                  <ul id="people" className="divide-y divide-line-faint border-t border-line-faint lg:divide-y-0 lg:border-t-0">
                    {peopleOnlyRows.map((row) => (
                      <li key={row.href}>
                        <HubRow row={row} dense />
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <ul className="divide-y divide-line-faint lg:divide-y-0">
                  {rows.map((row) => (
                    <li key={row.href}>
                      <HubRow row={row} dense />
                    </li>
                  ))}
                </ul>
              )}
              {group === "print" && <RecentOrders username={username} orders={model.print.recentOrders} />}
            </EverythingCardShell>
          ))}
        </div>
      )}

      {/* B2641 — a query matching nothing anywhere (not even Journal &
          account) gets its own line instead of a silently empty grid. */}
      {nothingMatched && (
        <p data-filter-empty className="mt-3 text-sm text-ink-secondary">
          {t("studio.hub.filter.empty", { query })}
        </p>
      )}

      {/* B2600 — a query that matches none of its rows hides it, like the other cards. */}
      {(!searching || journalMatches) && (
        <JournalAccountSection
          username={username}
          rows={journalFullRows}
          open={isOpen("journal")}
          onToggle={() => toggleOpen("journal")}
          arriveIndex={groups.length}
        />
      )}
      </div>
      </div>
    </StudioPage>
  );
}

/** B2304, trimmed by B2600 — the during-trip hero's own one-tap row: photos
 *  still waiting for words on this trip. Publish and A postcard used to
 *  ride along here too, duplicating Today's own card and Print's own row
 *  (B2580); absent entirely once nothing is waiting. */
function DuringTripRows({
  username,
  waitingCount,
  waitingFirstDate,
}: {
  username: string;
  waitingCount: number;
  waitingFirstDate: string | null;
}) {
  const { t, tn } = useI18n();
  const id = useId();
  if (waitingCount === 0 || !waitingFirstDate) return null;
  return (
    <ul data-during-trip-rows className="mt-3 divide-y divide-line-faint rounded-2xl border border-line-faint bg-surface-raised px-2.5">
      <li>
        <Link
          href={`${journalPath(username)}/studio/day/new?photos=${waitingFirstDate}`}
          aria-label={t("studio.hub.duringTrip.waiting.title")}
          aria-describedby={`${id}-d`}
          className="flex min-h-11 items-center gap-3 rounded-[10px] px-1.5 py-2 transition-colors hover:bg-surface-neutral
                     focus-visible:bg-surface-neutral focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
        >
          <Images className="h-5 w-5 flex-none text-ink-body" aria-hidden strokeWidth={2} />
          <span className="min-w-0 flex-1">
            <span className="block text-[15px] font-semibold leading-tight text-ink-strong">{t("studio.hub.duringTrip.waiting.title")}</span>
            <span id={`${id}-d`} className="mt-0.5 block text-[12.5px] leading-snug text-ink-secondary">
              {tn("studio.hub.duringTrip.waiting.detail", waitingCount, { count: String(waitingCount) })}
            </span>
          </span>
        </Link>
      </li>
    </ul>
  );
}

/** B2641 — one filter field, directly under the studio title at every
 *  width (the old desktop/phone pair, each hidden at the other's width and
 *  sitting below "Everything else", is gone — the owner wanted search at
 *  the top). A non-empty query hides Today's hero/write section (below)
 *  and narrows "Everything else" and Journal & account to matching rows,
 *  opened; the (x) clears it back to the unfiltered page. */
function FilterInput({ value, onChange, className }: { value: string; onChange: (value: string) => void; className?: string }) {
  const { t } = useI18n();
  return (
    <label className={`relative block ${className ?? ""}`}>
      <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-secondary" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t("studio.hub.filter.placeholder")}
        aria-label={t("studio.hub.filter.placeholder")}
        data-hub-filter
        className={`min-h-11 w-full rounded-full border border-line-faint bg-surface-raised py-2 pl-9 text-sm text-ink-strong
                   placeholder:text-ink-secondary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 ${
                     value ? "pr-10" : "pr-4"
                   }`}
      />
      {value !== "" && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label={t("studio.hub.filter.clear")}
          data-hub-filter-clear
          className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-ink-secondary
                     transition-colors hover:bg-surface-neutral focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
        >
          <X aria-hidden className="h-4 w-4" strokeWidth={2} />
        </button>
      )}
    </label>
  );
}

/**
 * One of "Everything else"'s three disclosure cards — B2600. A real
 * `<button aria-expanded>`, closed by default on phone (`open` decided by
 * the caller); `md:block` on the rows always wins at desktop, so the three
 * cards read as open cards there regardless of `open`'s own value.
 */
function EverythingCardShell({
  group,
  open,
  onToggle,
  arriveIndex,
  children,
}: {
  group: EverythingGroup;
  open: boolean;
  onToggle: () => void;
  /** B2325 — this card's position in the grid on first paint; `.fs-arrive`
   *  in `app/globals.css` reads it back as `--i` for its stagger. */
  arriveIndex: number;
  children: React.ReactNode;
}) {
  const { t } = useI18n();
  const { hue, icon: Icon, titleKey, summaryKey } = EVERYTHING_CARD[group];
  return (
    <section
      id={group}
      data-group={group}
      className="fs-arrive scroll-mt-20 rounded-2xl border border-line-faint bg-surface-raised px-2.5 pb-1.5 pt-3
                 lg:rounded-none lg:border-0 lg:bg-transparent lg:px-0 lg:pb-1 lg:pt-2"
      style={{ "--i": arriveIndex } as React.CSSProperties}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        // B2600 — no rule under a closed card on phone; desktop always shows its rows.
        className={`flex w-full items-center gap-2.5 border-b px-1 pb-2.5 text-left lg:border-b-0 lg:px-1.5 lg:pb-1 ${open ? "border-line-faint" : "border-transparent md:border-line-faint"}`}
      >
        <span
          aria-hidden="true"
          className="grid size-10 flex-none place-items-center rounded-[11px] border border-line-faint text-ink-strong lg:size-6 lg:rounded-md lg:[&>svg]:size-3.5"
          style={{ background: `color-mix(in srgb, ${hue} 22%, var(--surface-raised))` }}
        >
          <Icon size={20} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-display text-[19px] font-semibold text-ink-strong lg:font-mono lg:text-[11px] lg:font-medium lg:uppercase lg:tracking-[.07em] lg:text-ink-secondary">{t(titleKey)}</span>
          <span className="mt-0.5 block text-[12.5px] leading-snug text-ink-secondary md:hidden">{t(summaryKey)}</span>
        </span>
        <ChevronDown aria-hidden strokeWidth={2} className={`h-4 w-4 flex-none text-ink-secondary transition-transform md:hidden ${open ? "rotate-180" : ""}`} />
      </button>
      <div className={`${open ? "block" : "hidden"} md:block`}>{children}</div>
    </section>
  );
}

/**
 * Journal & account — B2600. A fourth disclosure card on phone (same chrome
 * as `EverythingCardShell`); one compact muted row of links and chips at
 * desktop instead of a fourth grid card. One row of rows, not two — each
 * link only ever renders once, styled differently per breakpoint by CSS
 * alone (a stacked tile on phone, an inline chip at `md`), so no href is
 * ever duplicated in the document the way two full re-renders would.
 * Export and Delete keep exactly the ConfirmPanel/mail flow they always
 * had — only where they sit on the page, and how they are drawn, changes.
 */
function JournalAccountSection({
  username,
  rows,
  open,
  onToggle,
  arriveIndex,
}: {
  username: string;
  rows: Row[];
  open: boolean;
  onToggle: () => void;
  arriveIndex: number;
}) {
  const { t } = useI18n();
  const [tileOpen, setTileOpen] = useState<"export" | "delete" | null>(null);
  const { hue, icon: Icon, titleKey, summaryKey } = EVERYTHING_CARD.journal;
  const id = useId();
  const toggleTile = (tile: "export" | "delete") => setTileOpen((prev) => (prev === tile ? null : tile));
  const rowClass =
    "flex min-h-11 items-center gap-2.5 rounded-[10px] px-1.5 py-2 text-left text-sm font-semibold transition-colors hover:bg-surface-subtle " +
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 " +
    "md:inline-flex md:min-h-8 md:w-auto md:rounded-full md:px-1 md:py-0 md:hover:bg-transparent md:hover:underline " +
    "lg:flex lg:min-h-10 lg:w-full lg:rounded-[10px] lg:px-2.5 lg:hover:bg-surface-raised lg:hover:no-underline";
  return (
    <section
      id="journal"
      data-group="journal"
      className="fs-arrive mt-3 rounded-2xl border border-line-faint bg-surface-neutral px-2.5 pb-2.5 pt-3
                 md:border md:bg-surface-neutral md:px-4 md:py-3 lg:mt-6 lg:border-0 lg:bg-transparent lg:px-0 lg:py-0"
      style={{ "--i": arriveIndex } as React.CSSProperties}
    >
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className={`flex w-full items-center gap-2.5 border-b px-1 pb-2.5 text-left md:hidden ${open ? "border-line-faint" : "border-transparent"}`}
      >
        <span
          aria-hidden="true"
          className="grid size-10 flex-none place-items-center rounded-[11px] border border-line-faint text-ink-strong"
          style={{ background: `color-mix(in srgb, ${hue} 40%, var(--surface-raised))` }}
        >
          <Icon size={20} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-display text-[19px] font-semibold text-ink-strong">{t(titleKey)}</span>
          <span className="mt-0.5 block text-[12.5px] leading-snug text-ink-secondary">{t(summaryKey)}</span>
        </span>
        <ChevronDown aria-hidden strokeWidth={2} className={`h-4 w-4 flex-none text-ink-secondary transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      <p aria-hidden="true" className="mb-1 hidden px-2.5 font-mono text-[11px] font-medium uppercase tracking-[.07em] text-ink-secondary lg:block">
        {t(titleKey)}
      </p>
      <ul
        className={`${open ? "flex" : "hidden"} md:flex flex-col divide-y divide-line-faint
                    md:flex-row md:flex-wrap md:items-center md:divide-y-0 md:gap-x-5 md:gap-y-1.5
                    lg:flex-col lg:flex-nowrap lg:items-stretch lg:gap-0`}
      >
        {rows.map((row, ri) => {
          const off = Boolean(row.reason);
          const rid = `${id}-${ri}`;
          const described = [row.reason && `${rid}-d`, off ? `${rid}-o` : row.factLine?.map((_, i) => `${rid}-l${i}`).join(" ")].filter(Boolean).join(" ");
          return (
            <li key={row.href} className="min-w-0 md:w-auto lg:w-full">
              <Link href={row.href} data-row aria-label={row.title} aria-describedby={described || undefined} className={`${rowClass} ${off ? "text-ink-faint" : "text-ink-strong"}`}>
                <row.Icon className="h-4 w-4 flex-none" aria-hidden strokeWidth={2} />
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5">
                    {row.title}
                    {off ? (
                      <Chip id={`${rid}-o`}>{t("studio.hub.chip.off")}</Chip>
                    ) : (
                      row.factLine?.map((f, i) => (
                        <Chip key={f.text} id={`${rid}-l${i}`} fact amber={f.amber}>
                          {f.text}
                        </Chip>
                      ))
                    )}
                  </span>
                  {/* The reason a row cannot run right now — kept on phone
                      (acceptance §6); the compact desktop row leans on the
                      "off" chip alone, the same way Print's own cards do. */}
                  {row.reason && <span id={`${rid}-d`} data-desc className="mt-0.5 block text-[12.5px] italic leading-snug text-ink-secondary md:hidden">{row.reason}</span>}
                </span>
              </Link>
            </li>
          );
        })}
        <li className="min-w-0 md:w-auto lg:w-full">
          <button type="button" aria-expanded={tileOpen === "export"} onClick={() => toggleTile("export")} className={`${rowClass} text-ink-strong`}>
            <Download className="h-4 w-4 flex-none" aria-hidden strokeWidth={2} />
            {t("me.exportTitle")}
          </button>
        </li>
        <li className="min-w-0 md:w-auto lg:mt-2 lg:w-full">
          <button type="button" aria-expanded={tileOpen === "delete"} onClick={() => toggleTile("delete")} className={`${rowClass} text-coral-600`}>
            <Trash2 className="h-4 w-4 flex-none" aria-hidden strokeWidth={2} />
            {t("me.deleteTitle")}
          </button>
        </li>
      </ul>
      {tileOpen === "export" ? <ExportAccount key="export" username={username} open onClose={() => setTileOpen(null)} /> : null}
      {tileOpen === "delete" ? <DeleteAccount key="delete" username={username} open onClose={() => setTileOpen(null)} /> : null}
    </section>
  );
}

function Hero({ href, Icon, title, description, cta }: { href: string; Icon: LucideIcon; title: string; description: string; cta: string }) {
  const id = useId();
  return (
    <Link
      href={href}
      data-hero
      aria-label={title}
      aria-describedby={`${id}-d ${id}-c`}
      className="mt-4 flex flex-wrap items-start gap-3 rounded-[20px] border-[1.5px] border-yellow-600 bg-yellow-50 p-4
                 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 sm:items-center sm:px-5 sm:py-5
                 lg:mt-0 lg:gap-5 lg:border-0 lg:bg-transparent lg:p-0"
    >
      <span
        aria-hidden="true"
        className="grid size-10 flex-none place-items-center rounded-[11px] border border-line-faint bg-surface-raised text-ink-strong
                   lg:size-16 lg:rounded-[20px] lg:border-0 lg:bg-yellow-400 lg:[&>svg]:size-7"
      >
        <Icon size={20} />
      </span>
      <span className="min-w-[200px] flex-1">
        <span className="block font-display text-[23px] font-semibold leading-tight text-ink-strong lg:text-[30px]">{title}</span>
        <span id={`${id}-d`} className="mt-1 block text-sm text-ink-secondary lg:text-[15px]">{description}</span>
      </span>
      <span id={`${id}-c`} className="inline-flex min-h-11 items-center rounded-full bg-action-strong px-5 text-[15px] font-semibold text-on-action">
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

function GroupCard({
  group,
  rows,
  foot,
  arriveIndex,
}: {
  group: StudioGroup;
  rows: Row[];
  foot?: React.ReactNode;
  /** B2325 — this card's position in the grid on first paint; `.fs-arrive`
   *  in `app/globals.css` reads it back as `--i` for its stagger. The card
   *  keeps the same key across a re-render (a search filter, say), so React
   *  reuses the same DOM node and the animation, which only ever runs once
   *  per insertion, does not repeat. */
  arriveIndex: number;
}) {
  return (
    <section
      id={group}
      data-group={group}
      aria-labelledby={`h-${group}`}
      className="fs-arrive scroll-mt-20 rounded-2xl border border-line-faint bg-surface-raised px-2.5 pb-1.5 pt-3"
      style={{ "--i": arriveIndex } as React.CSSProperties}
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

/** `dense` (B2664) — the desktop right-hand list: title and chips only from
 *  lg up; the description stays in the DOM and shows again below lg. A row
 *  that cannot run still says so with its "off" chip. */
function HubRow({ row, compact = false, dense = false }: { row: Row; compact?: boolean; dense?: boolean }) {
  const { t } = useI18n();
  const off = Boolean(row.reason);
  const line = row.reason ?? row.description;
  const id = useId();
  const described = [
    line && `${id}-d`,
    off ? `${id}-o` : row.fact && `${id}-f`,
    ...(!off && row.factLine ? row.factLine.map((_, i) => `${id}-l${i}`) : []),
  ].filter(Boolean).join(" ");
  return (
    <Link
      href={row.href}
      data-row
      aria-label={row.title}
      aria-describedby={described || undefined}
      className={`flex flex-wrap items-center gap-x-3 rounded-[10px] px-1.5 py-[7px] transition-colors hover:bg-surface-neutral
                  focus-visible:bg-surface-neutral focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 ${
                    compact && !line ? "min-h-11" : "min-h-[52px]"
                  } ${dense ? "lg:min-h-10 lg:py-1.5" : ""}`}
    >
      <row.Icon className={`h-5 w-5 flex-none ${off ? "text-ink-faint" : "text-ink-body"}`} aria-hidden strokeWidth={2} />
      <span className="min-w-0 flex-1 basis-0">
        {/* The chip stays on the title's line (B2134): a long title wraps
            inside its own box instead of pushing the chip onto a line alone. */}
        <span className="flex items-start gap-x-2">
          <span className={`min-w-0 flex-1 break-words hyphens-auto font-semibold leading-tight text-ink-strong ${compact ? "text-sm" : "text-[15px]"}`}>
            {row.title}
          </span>
          {off ? <Chip id={`${id}-o`}>{t("studio.hub.chip.off")}</Chip> : row.fact ? <Chip id={`${id}-f`} fact>{row.fact}</Chip> : null}
        </span>
        {line && (
          <span id={`${id}-d`} data-desc className={`mt-0.5 block text-[12.5px] leading-snug text-ink-secondary ${off ? "italic" : ""} ${dense ? "lg:hidden" : ""}`}>
            {line}
          </span>
        )}
      </span>
      {/* B2156 — the chip line takes the whole row, under the icon column too,
          so three chips fit in a desktop column; the icon stays on the title. */}
      {row.factLine && !off && (
        <span className="mt-1.5 flex basis-full flex-wrap gap-1 [&>*]:ml-0">
          {row.factLine.map((f, i) => (
            <Chip key={f.text} id={`${id}-l${i}`} fact amber={f.amber}>
              {f.text}
            </Chip>
          ))}
        </span>
      )}
    </Link>
  );
}

function Chip({ children, id, fact = false, amber = false }: { children: React.ReactNode; id?: string; fact?: boolean; amber?: boolean }) {
  // Amber is a fill and a border only; the words stay ink (test/contrast.test.ts).
  const tone = amber ? "border-yellow-600 bg-yellow-100 text-ink-strong" : "border-line-faint bg-surface-neutral text-ink-secondary";
  return (
    <span
      id={id}
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
function JournalCard({ username, rows, arriveIndex }: { username: string; rows: Row[]; arriveIndex: number }) {
  const { t } = useI18n();
  const [open, setOpen] = useState<"export" | "delete" | null>(null);
  const tile =
    "flex min-h-[52px] w-full items-center gap-3 rounded-[10px] border px-2.5 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500";
  return (
    <section
      id="journal"
      data-group="journal"
      aria-labelledby="h-journal"
      className="fs-arrive scroll-mt-20 rounded-2xl border border-line-faint bg-surface-neutral px-2.5 pb-2.5 pt-3"
      style={{ "--i": arriveIndex } as React.CSSProperties}
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
  tripId,
  runs,
  postcard,
  unfinished,
}: {
  username: string;
  /** B2826 — the trip whose add-a-day draft this offers to continue. */
  tripId: string;
  runs: ResumableImportSummary[];
  postcard: PostcardCard | null;
  /** B2135 — postcards not sent and photobook setups not ordered. */
  unfinished: UnfinishedPrint[];
}) {
  const { t, tn, locale, formatLongDate, formatShortDate } = useI18n();
  const id = useId();
  const [snapshot, setSnapshot] = useState<AddDaySnapshot | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- see the doc comment above.
    setSnapshot(readAddDaySnapshot(username, tripId));
  }, [username, tripId]);

  const carryOn = t("studio.hub.resume.import.cta");
  const rows: CarryRow[] = [
    ...(snapshot
      ? [
          {
            key: "add-day",
            href: `${journalPath(username)}/studio/day/new?trip=${encodeURIComponent(tripId)}`,
            Icon: CalendarPlus,
            title: t("studio.hub.resume.addDay.title"),
            detail: t("studio.hub.resume.addDay.detail", { date: formatLongDate(addDayExpiresOn(snapshot.savedAt)) }),
            chip: carryOn,
          },
        ]
      : []),
    ...runs.map((run) => ({
      key: run.runId,
      href: `${journalPath(username)}/studio/photos`,
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
            href: `${journalPath(username)}/studio/postcard`,
            Icon: Mailbox,
            title: t("me.postcardCardTitle"),
            detail: postcard.dayTitle
              ? t("me.postcardCardBody", { title: postcard.dayTitle })
              : postcard.dayDate && postcard.tripTitle
                ? t("me.postcardCardBodyUntitled", {
                    date: formatLongDate(postcard.dayDate),
                    trip: postcard.tripTitle,
                  })
                : t("me.postcardCardBodyPlain"),
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
      className="mt-3 rounded-2xl border border-dashed border-navy-500 bg-surface-raised px-3 py-2.5 lg:mt-4 lg:border-solid lg:border-line-faint"
    >
      <h2 id="h-half-done" className="mb-1.5 mt-0.5 font-mono text-[11px] font-medium uppercase tracking-[.06em] text-ink-secondary">
        {t("studio.hub.halfDone")}
      </h2>
      <ul>
        {shown.map((row, ri) => (
          <li key={row.key}>
            <Link
              href={row.href}
              aria-label={row.title}
              aria-describedby={`${id}-${ri}-d ${id}-${ri}-c`}
              className="flex min-h-11 items-center gap-3 rounded-[10px] px-1.5 py-1.5 transition-colors hover:bg-surface-neutral
                         focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
            >
              <row.Icon className="h-5 w-5 flex-none text-ink-body" aria-hidden strokeWidth={2} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold leading-tight text-ink-strong">{row.title}</span>
                <span id={`${id}-${ri}-d`} className="mt-0.5 block text-[12.5px] leading-snug text-ink-secondary">{row.detail}</span>
              </span>
              <Chip id={`${id}-${ri}-c`}>{row.chip}</Chip>
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
              href={`${journalPath(username)}/${order.kind === "postcard" ? "postcards" : "photobooks"}/${order.id}`}
              className="flex min-h-11 items-center rounded-[10px] px-1.5 text-[13px] text-ink-strong transition-colors hover:bg-surface-neutral
                         focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
            >
              {[
                t(`orders.kind.${order.kind}` as TranslationKey),
                "labelKey" in order.displayStatus ? t(order.displayStatus.labelKey) : order.displayStatus.rawLabel,
                formatShortDate(order.createdAt.slice(0, 10)),
              ].join(" · ")}
            </Link>
          </li>
        ))}
      </ul>
      <Link href={`${journalPath(username)}/studio/orders`} className="mt-1 inline-flex min-h-11 items-center px-1.5 text-sm font-semibold text-ink-strong underline underline-offset-2">
        {t("studio.hub.allOrders")}
      </Link>
    </div>
  );
}
