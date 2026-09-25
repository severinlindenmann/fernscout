"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  BookImage,
  BookMarked,
  CalendarPlus,
  ChartNoAxesColumn,
  Coins,
  Compass,
  Download,
  Images,
  Inbox,
  KeyRound,
  Mailbox,
  MapPin,
  MapPinned,
  Mic,
  PenLine,
  PersonStanding,
  Printer,
  Receipt,
  Scissors,
  Send,
  SendHorizontal,
  SlidersHorizontal,
  Trash2,
  ArchiveRestore,
  UserPlus,
  Users,
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
import type { HubAccount, ResumableImportSummary, StudioHubModel } from "@/lib/studio/hub";
import type { TranslationKey } from "@/lib/i18n";
import { unfinishedIcon, unfinishedTitle } from "@paid/printOrder/components/studio/UnfinishedPrint";
import type { OrderRow, UnfinishedPrint } from "@paid/printOrder/lib/orders";
import { addDayExpiresOn, readAddDaySnapshot, type AddDaySnapshot } from "@/lib/studio/addDayResume";

type T = (key: TranslationKey, vars?: Record<string, string>) => string;
type TN = (key: TranslationKey, count: number, vars?: Record<string, string>) => string;

/** "4.0 of 10 GB" — the ceiling is whole gigabytes; used space under a
 *  gigabyte keeps its own unit ("3 MB of 10 GB"). */
function storageFact({ usedBytes, limitBytes }: { usedBytes: number; limitBytes: number }, t: T, locale: string): string {
  const gb = (bytes: number, digits: number) =>
    new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: 1 }).format(bytes / 1024 ** 3);
  const used = usedBytes >= 1024 ** 3 ? gb(usedBytes, 1) : formatStagedBytes(usedBytes, locale);
  return t("studio.hub.fact.storage", { used, limit: gb(limitBytes, 0) });
}

type Row = {
  href: string;
  Icon: LucideIcon;
  title: string;
  /** Absent only in the Journal card, which is titles only. */
  description?: string;
  /** Present exactly when this row cannot run right now — the fully worded
   *  reason (spec §3), shown in place of the description, with an "off" chip. */
  reason?: string;
  /** B2067 — a neutral fact for the chip on the right, only when non-zero. */
  fact?: string;
  /** B2134 — a row of chips in place of the line (Credits & storage): the
   *  balance, an amber "N open" for a purchase awaiting approval, storage. */
  factLine?: { text: string; amber?: boolean }[];
};

/**
 * The Journal card's rows — titles only (B2066). Visitors stays in the list
 * greyed, with its reason, when this journal does not count its readers:
 * hiding a row is how somebody concludes the software cannot do the thing.
 */
function journalRows(username: string, t: T, tn: TN, locale: string, analyticsEnabled: boolean, account: HubAccount): Row[] {
  const factLine = [
    ...(account.credits !== null
      ? [{ text: `${new Intl.NumberFormat(locale).format(account.credits)} ${tn("me.paymentUnit", account.credits)}` }]
      : []),
    ...(account.purchasesOpen
      ? [{ text: tn("studio.hub.fact.purchasesOpen", account.purchasesOpen, { count: String(account.purchasesOpen) }), amber: true }]
      : []),
    ...(account.storage ? [{ text: storageFact(account.storage, t, locale) }] : []),
  ];
  return [
    {
      href: `/${username}/studio/account`,
      Icon: Coins,
      title: t("studio.hub.item.account.title"),
      factLine: factLine.length ? factLine : undefined,
    },
    { href: `/${username}/studio/journal`, Icon: BookMarked, title: t("studio.hub.item.journalSettings.title") },
    { href: `/${username}/studio/agent`, Icon: KeyRound, title: t("studio.hub.item.agent.title") },
    {
      href: `/${username}/studio/visitors`,
      Icon: ChartNoAxesColumn,
      title: t("studio.hub.item.visitors.title"),
      reason: analyticsEnabled ? undefined : t("studio.hub.cannotRun.visitors"),
    },
  ];
}

/** B2160 — "2 drafts" on a Print row: how many of that kind wait unfinished
 *  behind it, on the page where Carry on and Discard already are. Nothing at
 *  zero, like every other fact chip. */
function draftsChip(unfinished: UnfinishedPrint[], kind: UnfinishedPrint["kind"], tn: TN): string | undefined {
  const n = unfinished.filter((u) => u.kind === kind).length;
  return n > 0 ? tn("studio.hub.fact.drafts", n, { count: String(n) }) : undefined;
}

/** Photographs and Your route — the Bring in rows an empty journal also
 *  gets, since either can make its first trip. */
function bringInFirstRows(username: string, t: T): Row[] {
  return [
    {
      href: `/${username}/studio/photos`,
      Icon: Images,
      title: t("studio.hub.item.photos.title"),
      description: t("studio.hub.item.photos.description"),
    },
    {
      href: `/${username}/studio/location?from=hub`,
      Icon: MapPin,
      title: t("studio.hub.item.location.title"),
      description: t("studio.hub.item.location.description"),
    },
  ];
}

/**
 * `/[user]/studio` — the Desk (B2066, after B1829's hub).
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
   *  one big "Tell about today" above everything else. */
  speak?: boolean;
}) {
  // The iPhone connects itself for Photos → Share the first time the studio
  // opens; the status lives on /me — B2206.
  useShareInboxAutoConnect(username);
  const { t, tn, locale } = useI18n();

  // The hero, and the same target for the phone bar's primary — B1951: a
  // current trip writes a day, an ended one with nothing after it starts the
  // next trip instead of backdating the one that just finished.
  const hero =
    model.kind === "empty"
      ? {
          href: `/${username}/studio/trip/new`,
          Icon: Compass,
          title: t("studio.hub.empty.cta"),
          description: t("studio.hub.empty.ctaHint"),
          cta: t("studio.hub.newTrip.cta"),
        }
      : model.addDayTrip?.current
        ? {
            href: `/${username}/studio/day/new?from=hub`,
            Icon: CalendarPlus,
            title: t("studio.hub.addDay.title"),
            description: t("studio.hub.addDay.subtitle", { trip: model.addDayTrip.title }),
            cta: t("studio.hub.addDay.cta"),
          }
        : model.addDayTrip
          ? {
              href: `/${username}/studio/trip/new`,
              Icon: Compass,
              title: t("studio.hub.item.newTrip.title"),
              description: t("studio.hub.item.newTrip.description"),
              cta: t("studio.hub.newTrip.cta"),
            }
          : {
              // Every trip still upcoming: a generic "Add a day" naming no trip.
              href: `/${username}/studio/day/new?from=hub`,
              Icon: CalendarPlus,
              title: t("studio.hub.addDay.title"),
              description: t("studio.hub.addDay.subtitleNoCurrent"),
              cta: t("studio.hub.addDay.cta"),
            };

  // `replace` — the hub *is* the studio, so its bottom bar never carries a
  // link back to itself (B2001) — and `revealAfterScroll={160}`, kept here
  // as the one caller of that option. `null` in the empty state.
  useStudioBar(
    model.kind === "full" ? (
      <>
        <Link
          href={hero.href}
          className="flex min-h-11 flex-1 items-center justify-center gap-2 rounded-full bg-action-strong px-3
                     text-sm font-semibold text-on-action transition-colors hover:bg-action-strong-hover
                     focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
        >
          <hero.Icon className="h-4 w-4 shrink-0" aria-hidden strokeWidth={2.2} />
          <span className="truncate">{hero.cta}</span>
        </Link>
        {/* Below 430px three labelled pills do not fit a 390px row without
            truncating every label (B1996), so the two secondary actions keep
            their icon and give their name to assistive tech instead. */}
        <Link
          href={`/${username}/studio/photos`}
          aria-label={t("studio.hub.item.photos.title")}
          className="flex min-h-11 min-w-11 flex-none items-center justify-center gap-2 rounded-full border
                     border-line-strong px-3 text-sm font-semibold text-ink-body transition-colors
                     hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-offset-2
                     focus-visible:outline-blue-500 min-[430px]:flex-1"
        >
          <Images className="h-4 w-4 shrink-0" aria-hidden strokeWidth={2.2} />
          <span className="hidden truncate min-[430px]:inline">{t("studio.hub.item.photos.title")}</span>
        </Link>
        {!model.cannotRun.postcard && (
          <Link
            href={`/${username}/studio/postcard`}
            aria-label={t("studio.hub.item.postcard.title")}
            className="flex min-h-11 min-w-11 flex-none items-center justify-center gap-2 rounded-full border
                       border-line-strong px-3 text-sm font-semibold text-ink-body transition-colors
                       hover:bg-surface-subtle focus-visible:outline-2 focus-visible:outline-offset-2
                       focus-visible:outline-blue-500 min-[430px]:flex-1"
          >
            <Printer className="h-4 w-4 shrink-0" aria-hidden strokeWidth={2.2} />
            <span className="hidden truncate min-[430px]:inline">{t("studio.hub.item.postcard.title")}</span>
          </Link>
        )}
      </>
    ) : null,
    { replace: true, revealAfterScroll: 160 },
  );

  const halfDone = (
    <HalfDone username={username} runs={model.resumableImports} postcard={model.postcardSuggestion} unfinished={model.print.unfinished} />
  );

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

  const { facts } = model;
  const ended = model.addDayTrip && !model.addDayTrip.current ? model.addDayTrip : null;
  const groups: { group: Exclude<StudioGroup, "journal">; rows: Row[] }[] = [
    {
      group: "write",
      rows: [
        {
          href: `/${username}/studio/day/edit`,
          Icon: PenLine,
          title: t("studio.hub.item.changeDay.title"),
          description: t("studio.hub.item.changeDay.description"),
          reason: model.cannotRun.changeDay ? t("studio.hub.cannotRun.changeDay") : undefined,
        },
        {
          href: `/${username}/studio/day/publish`,
          Icon: SendHorizontal,
          title: t("studio.hub.item.publishDay.title"),
          description: t("studio.hub.item.publishDay.description"),
          // A neutral count, never aged or ranked: publishing is never nagged.
          fact: facts.drafts > 0 ? tn("studio.hub.fact.drafts", facts.drafts, { count: String(facts.drafts) }) : undefined,
        },
        // B2259 — only while something is in it.
        ...(facts.deleted
          ? [
              {
                href: `/${username}/studio/day/deleted`,
                Icon: ArchiveRestore,
                title: t("studio.hub.item.deleted.title"),
                description: t("studio.hub.item.deleted.description"),
                fact: tn("studio.hub.fact.deleted", facts.deleted, { count: String(facts.deleted) }),
              },
            ]
          : []),
        {
          href: `/${username}/studio/day/reshape?from=hub`,
          Icon: Scissors,
          title: t("studio.hub.item.reshapeDay.title"),
          description: t("studio.hub.item.reshapeDay.description"),
          reason: model.cannotRun.reshapeDay ? t("studio.hub.cannotRun.reshapeDay") : undefined,
        },
        // The hero leads with a new trip once none is current (B1951) —
        // adding a day to the one that just ended stays reachable here,
        // honestly labelled as ended.
        ...(ended
          ? [
              {
                href: `/${username}/studio/day/new?trip=${encodeURIComponent(ended.id)}&from=hub`,
                Icon: CalendarPlus,
                title: t("studio.hub.item.addDayEnded.title", { trip: ended.title }),
                description: t("studio.hub.item.addDayEnded.description", { trip: ended.title }),
              },
            ]
          : []),
      ],
    },
    {
      group: "plan",
      rows: [
        // Not twice: when the hero already is the new trip, the row goes.
        ...(ended
          ? []
          : [
              {
                href: `/${username}/studio/trip/new`,
                Icon: Compass,
                title: t("studio.hub.item.newTrip.title"),
                description: t("studio.hub.item.newTrip.description"),
              },
            ]),
        // Hidden outright, not greyed — nothing upcoming is nothing to plan.
        ...(model.planTrip
          ? [
              {
                href: `/${username}/studio/plan/${model.planTrip.id}`,
                Icon: MapPinned,
                title: t("studio.hub.item.plan.title", { trip: model.planTrip.title }),
                description: t("studio.hub.item.plan.description"),
                fact: facts.planStartsInDays
                  ? tn("studio.hub.fact.startsIn", facts.planStartsInDays, { count: String(facts.planStartsInDays) })
                  : undefined,
              },
            ]
          : []),
        {
          href: `/${username}/studio/trip`,
          Icon: SlidersHorizontal,
          title: t("studio.hub.item.tripEdit.title"),
          description: t("studio.hub.item.tripEdit.description"),
        },
      ],
    },
    {
      group: "people",
      rows: [
        // B2133 — one row for the one readers page: inviting, answering who
        // asks and who reads along all happen on /studio/readers.
        {
          href: `/${username}/studio/readers`,
          Icon: UserPlus,
          title: t("studio.hub.item.readers.title"),
          description: t("studio.hub.item.readers.description"),
          fact: facts.readersAsking
            ? tn("studio.hub.fact.asking", facts.readersAsking, { count: String(facts.readersAsking) })
            : undefined,
        },
        {
          href: `/${username}/studio/people?from=hub`,
          Icon: Users,
          title: t("studio.hub.item.people.title"),
          description: t("studio.hub.item.people.description"),
        },
        {
          href: `/${username}/studio/figures`,
          Icon: PersonStanding,
          title: t("studio.hub.item.figures.title"),
          description: t("studio.hub.item.figures.description"),
        },
      ],
    },
    {
      group: "bringIn",
      rows: [
        ...bringInFirstRows(username, t),
        {
          href: `/${username}/studio/statement?from=hub`,
          Icon: Receipt,
          title: t("studio.hub.item.statement.title"),
          description: t("studio.hub.item.statement.description"),
        },
        {
          href: `/${username}/studio/inbox`,
          Icon: Inbox,
          title: t("studio.hub.item.inbox.title"),
          description: facts.inboxCount ? t("studio.hub.item.inbox.hint") : t("studio.hub.item.inbox.empty"),
          fact: facts.inboxCount
            ? tn("studio.hub.item.inbox.description", facts.inboxCount, {
                count: String(facts.inboxCount),
                size: formatStagedBytes(facts.inboxBytes, locale),
              })
            : undefined,
        },
      ],
    },
    {
      group: "print",
      rows: [
        {
          href: `/${username}/studio/postcard`,
          Icon: Send,
          title: t("studio.hub.item.postcard.title"),
          description: t("studio.hub.item.postcard.description"),
          reason: model.cannotRun.postcard ? t("studio.hub.cannotRun.postcard") : undefined,
          fact: draftsChip(model.print.unfinished, "postcard", tn),
        },
        {
          href: `/${username}/studio/photobook`,
          Icon: BookImage,
          title: t("studio.hub.item.photobook.title"),
          description: t("studio.hub.item.photobook.description"),
          reason: model.cannotRun.photobook ? t("studio.hub.cannotRun.photobook") : undefined,
          fact: draftsChip(model.print.unfinished, "photobook", tn),
        },
      ],
    },
  ];

  return (
    <StudioPage username={username} back={false} width="wide" title={t("studio.hub.title")}>
      {speak && <TellToday username={username} />}
      <Hero {...hero} />
      <WaitingDays username={username} model={model.waitingDays} canWrite />
      {/* B2197 — one notice for each future trip not yet armed or declined. */}
      <ScheduleRouteNotices username={username} trips={model.routeRecordingTrips} />
      {halfDone}
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

/** B2194 — the speak-mode home: one big button into the spoken questions. */
function TellToday({ username }: { username: string }) {
  const { t } = useI18n();
  return (
    <Link
      href={`/${username}/studio/day/new?mode=speak&from=hub`}
      data-tell-today
      className="fs-ask-dark mt-4 flex items-center gap-4 rounded-[20px] p-5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
    >
      <span aria-hidden="true" className="grid size-16 flex-none place-items-center rounded-full bg-coral-600 text-on-deep">
        <Mic size={30} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-display text-[23px] font-semibold leading-tight">{t("studio.hub.speak.title")}</span>
        <span className="mt-1 block text-base">{t("studio.hub.speak.subtitle")}</span>
      </span>
    </Link>
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
 * Half done — B2067. One strip under the hero for everything started and not
 * finished: the add-day draft (client-side, in `sessionStorage`, so read once
 * after mount — server and client agree on the first paint), each resumable
 * photographs import, and the postcard worth sending. Absent when there is
 * nothing, never an empty box.
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
        {rows.map((row) => (
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
