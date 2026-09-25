import {
  ArchiveRestore,
  BookImage,
  BookMarked,
  CalendarPlus,
  ChartNoAxesColumn,
  Coins,
  Compass,
  Images,
  Inbox,
  KeyRound,
  MapPin,
  MapPinned,
  PenLine,
  PersonStanding,
  Receipt,
  Scissors,
  Send,
  SendHorizontal,
  SlidersHorizontal,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";
import { formatStagedBytes } from "@/lib/validate/media";
import type { StudioGroup } from "@/lib/studio/groups";
import type { HubAccount, StudioHubModel } from "@/lib/studio/hub";
import type { UnfinishedPrint } from "@paid/printOrder/lib/orders";
import type { TranslationKey } from "@/lib/i18n";

type T = (key: TranslationKey, vars?: Record<string, string>) => string;
type TN = (key: TranslationKey, count: number, vars?: Record<string, string>) => string;

export type Row = {
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

export type HubGroup = { group: Exclude<StudioGroup, "journal">; rows: Row[] };

/** "4.0 of 10 GB" — the ceiling is whole gigabytes; used space under a
 *  gigabyte keeps its own unit ("3 MB of 10 GB"). */
function storageFact({ usedBytes, limitBytes }: { usedBytes: number; limitBytes: number }, t: T, locale: string): string {
  const gb = (bytes: number, digits: number) =>
    new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: 1 }).format(bytes / 1024 ** 3);
  const used = usedBytes >= 1024 ** 3 ? gb(usedBytes, 1) : formatStagedBytes(usedBytes, locale);
  return t("studio.hub.fact.storage", { used, limit: gb(limitBytes, 0) });
}

/**
 * The Journal card's rows — titles only (B2066). Visitors stays in the list
 * greyed, with its reason, when this journal does not count its readers:
 * hiding a row is how somebody concludes the software cannot do the thing.
 */
export function journalRows(username: string, t: T, tn: TN, locale: string, analyticsEnabled: boolean, account: HubAccount): Row[] {
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
export function bringInFirstRows(username: string, t: T): Row[] {
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
 * The five group cards' rows (Write, Plan, People, Bring in, Print) — B2066,
 * unchanged by B2304's calmer top. Pulled into one function so the filter
 * field (B2304) reads exactly the rows the grid renders; the two cannot
 * drift apart because there is only one place this is built.
 */
export function buildHubGroups(
  model: Extract<StudioHubModel, { kind: "full" }>,
  username: string,
  t: T,
  tn: TN,
  locale: string,
): HubGroup[] {
  const { facts } = model;
  const ended = model.addDayTrip && !model.addDayTrip.current ? model.addDayTrip : null;
  return [
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
}

/** Case- and diacritic-insensitive substring match — a normalised `includes`
 *  is smaller than a search index for six groups of five rows each, and
 *  exact enough for a title/description filter (B2304). */
function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

function matchesQuery(row: Row, query: string): boolean {
  return normalize(row.title).includes(query) || normalize(row.description ?? row.reason ?? "").includes(query);
}

/** Narrows `groups` (from `buildHubGroups`) to the rows matching `query`,
 *  dropping a group entirely once none of its rows match — the filter field
 *  directly above the grid (B2304). An empty query returns `groups`
 *  unchanged. */
export function filterHubGroups(groups: HubGroup[], query: string): HubGroup[] {
  const q = normalize(query);
  if (!q) return groups;
  return groups.map((g) => ({ ...g, rows: g.rows.filter((r) => matchesQuery(r, q)) })).filter((g) => g.rows.length > 0);
}
