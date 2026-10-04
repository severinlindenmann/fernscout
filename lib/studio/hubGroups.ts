import {
  ArchiveRestore,
  ArrowRight,
  BookImage,
  BookMarked,
  CalendarPlus,
  ChartNoAxesColumn,
  Coins,
  Compass,
  FileArchive,
  Images,
  Inbox,
  KeyRound,
  MapPin,
  MapPinned,
  PenLine,
  Plus,
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
import type { HubAccount, StudioHubModel } from "@/lib/studio/hub";
import type { UnfinishedPrint } from "@paid/printOrder/lib/orders";
import type { TranslationKey } from "@/lib/i18n";

import { journalPath } from "../journalPath";
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
   *  balance, storage. */
  factLine?: { text: string; amber?: boolean }[];
};

/** B2600 — "Everything else"'s three open/disclosure cards. Trips & people
 *  merges the old Plan and People groups (minus Walking figures, which left
 *  the hub for Journal settings); Bring in and Print are unchanged. Journal
 *  & account (the old "journal" group) is built separately by `journalRows`
 *  — it renders as its own desktop row, not a card in this grid. */
export type EverythingGroup = "tripsPeople" | "bringIn" | "print";
export type HubGroup = { group: EverythingGroup; rows: Row[] };

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
    ...(account.storage ? [{ text: storageFact(account.storage, t, locale) }] : []),
  ];
  return [
    {
      href: `${journalPath(username)}/studio/account`,
      Icon: Coins,
      title: t("studio.hub.item.account.title"),
      factLine: factLine.length ? factLine : undefined,
    },
    { href: `${journalPath(username)}/studio/journal`, Icon: BookMarked, title: t("studio.hub.item.journalSettings.title") },
    { href: `${journalPath(username)}/studio/agent`, Icon: KeyRound, title: t("studio.hub.item.agent.title") },
    {
      href: `${journalPath(username)}/studio/visitors`,
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
export function bringInFirstRows(username: string, t: T, extractOff: boolean): Row[] {
  return [
    {
      href: `${journalPath(username)}/studio/photos`,
      Icon: Images,
      title: t("studio.hub.item.photos.title"),
      description: t("studio.hub.item.photos.description"),
      // B2577 — the page's own banner string, so menu and page cannot drift.
      reason: extractOff ? t("studio.extract.off.banner") : undefined,
    },
    {
      href: `${journalPath(username)}/studio/location?from=hub`,
      Icon: MapPin,
      title: t("studio.hub.item.location.title"),
      description: t("studio.hub.item.location.description"),
    },
  ];
}

/**
 * Today's one list card (the old "write" group) — B2600. Change a day,
 * Publish (drafts chip), Move or split a day (renamed from "Something is
 * filed wrong"), plus the deleted-days and ended-trip rows Write already
 * carried, conditionally, unchanged.
 */
export function todayRows(model: Extract<StudioHubModel, { kind: "full" }>, username: string, t: T, tn: TN): Row[] {
  const { facts } = model;
  const ended = model.addDayTrip && !model.addDayTrip.current ? model.addDayTrip : null;
  return [
    {
      href: `${journalPath(username)}/studio/day/edit`,
      Icon: PenLine,
      title: t("studio.hub.item.changeDay.title"),
      description: t("studio.hub.item.changeDay.description"),
      reason: model.cannotRun.changeDay ? t("studio.hub.cannotRun.changeDay") : undefined,
    },
    {
      href: `${journalPath(username)}/studio/day/publish`,
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
            href: `${journalPath(username)}/studio/day/deleted`,
            Icon: ArchiveRestore,
            title: t("studio.hub.item.deleted.title"),
            description: t("studio.hub.item.deleted.description"),
            fact: tn("studio.hub.fact.deleted", facts.deleted, { count: String(facts.deleted) }),
          },
        ]
      : []),
    {
      href: `${journalPath(username)}/studio/day/reshape?from=hub`,
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
            href: `${journalPath(username)}/studio/day/new?trip=${encodeURIComponent(ended.id)}`,
            Icon: CalendarPlus,
            title: t("studio.hub.item.addDayEnded.title", { trip: ended.title }),
            description: t("studio.hub.item.addDayEnded.description", { trip: ended.title }),
          },
        ]
      : []),
  ];
}

/**
 * Trips & people's two sub-lists (B2600 — the old Plan and People groups,
 * merged into one card; Walking figures left for Journal settings). Kept
 * apart, not concatenated, so the hub can still mark `#plan` and `#people`
 * as two anchors inside the one card — every subpage that used to link back
 * to either (`StudioPage group="plan"` / `group="people"`) still lands on
 * its own rows, not just the top of a merged list.
 */
export function tripsRows(model: Extract<StudioHubModel, { kind: "full" }>, username: string, t: T, tn: TN): Row[] {
  const { facts } = model;
  const ended = model.addDayTrip && !model.addDayTrip.current ? model.addDayTrip : null;
  return [
    // Not twice: when the hero already is the new trip, the row goes.
    ...(ended
      ? []
      : [
          {
            href: `${journalPath(username)}/studio/trip/new`,
            Icon: Compass,
            title: t("studio.hub.item.newTrip.title"),
            description: t("studio.hub.item.newTrip.description"),
          },
        ]),
    // Hidden outright, not greyed — nothing upcoming is nothing to plan.
    ...(model.planTrip
      ? [
          {
            href: `${journalPath(username)}/studio/plan/${model.planTrip.id}`,
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
      href: `${journalPath(username)}/studio/trip`,
      Icon: SlidersHorizontal,
      // B2600 — its own wording here ("Your trips"): the page's own title
      // and every other reader of this key (EditDayFlow's breadcrumb, the
      // nav destination list) keep "Trips".
      title: t("studio.hub.item.tripEdit.hubTitle"),
      description: t("studio.hub.item.tripEdit.description"),
    },
  ];
}

export function peopleRows(model: Extract<StudioHubModel, { kind: "full" }>, username: string, t: T, tn: TN): Row[] {
  const { facts } = model;
  return [
    // B2133 — one row for the one readers page: inviting, answering who
    // asks and who reads along all happen on /studio/readers.
    {
      href: `${journalPath(username)}/studio/readers`,
      Icon: UserPlus,
      title: t("studio.hub.item.readers.title"),
      description: t("studio.hub.item.readers.description"),
      reason: model.cannotRun.readers ? t("studio.readers.off.banner") : undefined,
      fact: facts.readersAsking
        ? tn("studio.hub.fact.asking", facts.readersAsking, { count: String(facts.readersAsking) })
        : undefined,
    },
    {
      href: `${journalPath(username)}/studio/people?from=hub`,
      Icon: Users,
      title: t("studio.hub.item.people.title"),
      description: t("studio.hub.item.people.description"),
    },
  ];
}

/**
 * The two open/disclosure cards in "Everything else" that are not Trips &
 * people — B2066, unchanged rows by B2304's calmer top. Pulled into one
 * function so the filter field (B2304) reads exactly the rows the grid
 * renders; the two cannot drift apart because there is only one place this
 * is built.
 */
export function buildHubGroups(
  model: Extract<StudioHubModel, { kind: "full" }>,
  username: string,
  t: T,
  tn: TN,
  locale: string,
): HubGroup[] {
  const { facts } = model;
  return [
    {
      group: "tripsPeople",
      rows: [...tripsRows(model, username, t, tn), ...peopleRows(model, username, t, tn)],
    },
    {
      group: "bringIn",
      rows: [
        ...bringInFirstRows(username, t, model.cannotRun.extract),
        {
          href: `${journalPath(username)}/studio/statement?from=hub`,
          Icon: Receipt,
          title: t("studio.hub.item.statement.title"),
          description: t("studio.hub.item.statement.description"),
        },
        {
          href: `${journalPath(username)}/studio/import/polarsteps`,
          Icon: FileArchive,
          title: t("studio.hub.item.polarsteps.title"),
          description: t("studio.hub.item.polarsteps.description"),
        },
        {
          href: `${journalPath(username)}/studio/inbox`,
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
          href: `${journalPath(username)}/studio/postcard`,
          Icon: Send,
          title: t("studio.hub.item.postcard.title"),
          description: t("studio.hub.item.postcard.description"),
          reason: model.cannotRun.postcard ? t("studio.postcard.off.banner") : undefined,
          fact: draftsChip(model.print.unfinished, "postcard", tn),
        },
        {
          href: `${journalPath(username)}/studio/photobook`,
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

/** Whether one row matches a raw (not yet normalized) filter query — B2600,
 *  shared with Journal & account, which is never narrowed by the filter
 *  (see `StudioHub.tsx`) but still opens on phone when it has a match. */
export function rowMatchesQuery(row: Row, query: string): boolean {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  // B2581 — every typed word must appear somewhere in title + description (AND, any order).
  const hay = normalize(`${row.title} ${row.description ?? row.reason ?? ""}`);
  return words.every((w) => hay.includes(w));
}

/** Narrows `groups` (from `buildHubGroups`) to the rows matching `query`,
 *  dropping a group entirely once none of its rows match — the filter field
 *  (B2304, moved below the groups on phone by B2600). An empty query
 *  returns `groups` unchanged. */
export function filterHubGroups(groups: HubGroup[], query: string): HubGroup[] {
  if (!query.trim()) return groups;
  return groups.map((g) => ({ ...g, rows: g.rows.filter((r) => rowMatchesQuery(r, query)) })).filter((g) => g.rows.length > 0);
}

/** B2810 — the first-visit studio's doors, in the mockup's order. Every door
 *  works with its capability off (B-2842). */
export type FirstVisitDoor = { key: "newTrip" | "polarsteps" | "import"; href: string; Icon: LucideIcon; title: string; description: string };

export function firstVisitDoors(
  username: string,
  welcome: { polarsteps: boolean },
  t: T,
): FirstVisitDoor[] {
  const base = journalPath(username);
  return [
    { key: "newTrip", href: `${base}/studio/trip/new`, Icon: Plus, title: t("studio.hub.item.newTrip.title"), description: t("studio.hub.first.newTrip.hint") },
    ...(welcome.polarsteps
      ? [{ key: "polarsteps" as const, href: `${base}/studio/import/polarsteps`, Icon: ArrowRight, title: t("studio.hub.item.polarsteps.title"), description: t("studio.hub.first.polarsteps.hint") }]
      : []),
    // B-2842: always there; with extract off the page behind it offers only the helper.
    { key: "import", href: `${base}/studio/import`, Icon: Images, title: t("studio.hub.first.photos.title"), description: t("studio.hub.first.photos.hint") },
  ];
}
