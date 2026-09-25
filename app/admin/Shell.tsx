"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useSyncExternalStore, type ReactNode } from "react";
import {
  Activity,
  BookOpen,
  Coins,
  LayoutDashboard,
  MessageSquare,
  MoreHorizontal,
  Search,
  Server,
  Sprout,
  Users,
  type LucideIcon,
} from "lucide-react";
import Palette, { type PaletteItem } from "./Palette";

/**
 * The operator console's frame — a sidebar on a desktop, a bar at the bottom
 * on a phone, and one section on screen at a time. It replaced the four tabs
 * `Console.tsx` drew (B996), which had outgrown a row of pills once the page
 * had seven places to be.
 *
 * **The section is in the URL, as before.** `#instance` is a bookmark to the
 * health of the instance, and `#journals/<name>` is a bookmark to one journal's
 * panel — the part after the slash is read by `Journals`, so the attention
 * band, the palette and a mailed link can all open a journal directly. A hash
 * rather than a query because it is a position in the page, not a request to
 * the server; the period is the one thing that *is* a request (`?days=`), since
 * every figure on the page is computed for it.
 *
 * **The bar is at the bottom on a phone.** A phone is held near its lower edge
 * and a control pinned to the top is the one place a thumb cannot reach. It
 * holds the four sections an operator opens standing up; the rest are behind
 * More, which is also where the sidebar's footer lives on a phone.
 *
 * The attention band is not a section. It sits on Overview, first, and its
 * count is the badge on Overview — a person waiting is never behind a tap.
 */

type SectionIcon = "overview" | "money" | "journals" | "people" | "messages" | "instance" | "activity";

const ICONS: Record<SectionIcon, LucideIcon> = {
  overview: LayoutDashboard,
  money: Coins,
  journals: BookOpen,
  people: Users,
  messages: MessageSquare,
  instance: Server,
  activity: Activity,
};

export type Section = {
  id: string;
  label: string;
  icon: SectionIcon;
  /** One line under the heading, saying what this section answers. */
  lede: string;
  /** Shown beside the label when non-zero. */
  badge?: number;
  /** `alert` is the coral count; a plain count is how many there are. */
  badgeTone?: "alert" | "count";
  /** On the phone's bottom bar rather than behind More. */
  primary?: boolean;
  panel: ReactNode;
};

/** Everything currently watching the hash. `history.replaceState` does not fire
 *  `hashchange`, so a move made here has to tell its own subscribers. */
const WATCHING = new Set<() => void>();

/**
 * The hash, as a value rather than as state — `useSyncExternalStore` because
 * the hash is the browser's and the server's answer is "none", which is the
 * first section. Exported so `Journals` reads the same store.
 */
export function useHash(): string {
  return useSyncExternalStore(
    (onChange) => {
      window.addEventListener("hashchange", onChange);
      WATCHING.add(onChange);
      return () => {
        window.removeEventListener("hashchange", onChange);
        WATCHING.delete(onChange);
      };
    },
    () => decodeURIComponent(window.location.hash.slice(1)),
    () => "",
  );
}

/** Move to `#<hash>` without a navigation, and tell everybody watching.
 *  A new section starts at its top; opening a row within one does not. */
export function goTo(hash: string, scroll = true): void {
  window.history.replaceState(null, "", `#${hash}`);
  for (const tell of WATCHING) tell();
  if (scroll) window.scrollTo({ top: 0 });
}

const PERIODS = [7, 30, 90] as const;

export default function Shell({
  sections,
  days,
  siteName,
  deployed,
  journals,
}: {
  sections: Section[];
  /** The period every figure was computed for. */
  days: number;
  siteName: string;
  /** Commit and uptime, for the sidebar's foot. */
  deployed: string;
  /** Every journal's name, for the palette. */
  journals: string[];
}) {
  const hash = useHash();
  const router = useRouter();
  const [more, setMore] = useState(false);
  const [searching, setSearching] = useState(false);
  const head = hash.split("/")[0];
  const active = sections.find((one) => one.id === head) ?? sections[0];

  function period(count: number) {
    router.push(`/admin?days=${count}${window.location.hash}`, { scroll: false });
  }

  const palette: PaletteItem[] = [
    ...sections.map((one) => ({ label: one.label, hint: "Section", hash: one.id })),
    ...journals.map((name) => ({ label: name, hint: "Journal", hash: `journals/${name}` })),
    { label: "Invite someone", hint: "People", hash: "people" },
    { label: "Send an SMS", hint: "Messages", hash: "messages" },
    { label: "Backups", hint: "Instance", hash: "instance" },
  ];

  const nav = (onPick?: () => void) =>
    sections.map((one) => {
      const Icon = ICONS[one.icon];
      const on = one.id === active.id;
      return (
        <a
          key={one.id}
          href={`#${one.id}`}
          aria-current={on ? "page" : undefined}
          onClick={(event) => {
            event.preventDefault();
            goTo(one.id);
            onPick?.();
          }}
          className={`flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold transition-colors ${
            on ? "bg-yellow-400 text-on-bright" : "text-ink-body hover:bg-surface-muted"
          }`}
        >
          <Icon aria-hidden className="h-[18px] w-[18px] shrink-0" />
          {one.label}
          <Badge section={one} on={on} />
        </a>
      );
    });

  const foot = (
    <div className="space-y-2">
      <div className="rounded-2xl border border-surface-muted bg-surface-raised p-3.5">
        <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-ink-secondary">Deployed</p>
        <p className="mt-1 font-mono text-sm text-ink-strong">{deployed}</p>
        <Link
          href="/api/health"
          prefetch={false}
          className="mt-1.5 inline-block text-sm font-semibold text-ink-body underline"
        >
          /api/health
        </Link>
      </div>
      <Link href="/" className="flex min-h-11 items-center px-3 text-sm font-semibold text-ink-body underline">
        ← {siteName}
      </Link>
    </div>
  );

  return (
    <div className="min-h-screen lg:flex">
      <div className="hidden w-60 shrink-0 border-r border-surface-muted bg-surface-subtle lg:block">
        <aside
          aria-label="Operator sections"
          className="sticky top-0 flex h-screen flex-col gap-1 overflow-y-auto px-4 py-7"
        >
          <Brand name={siteName} />
          <nav className="flex flex-col gap-1">{nav()}</nav>
          <div className="flex-1" />
          {foot}
        </aside>
      </div>

      <div className="min-w-0 flex-1 px-4 pb-28 pt-6 sm:px-8 lg:px-10 lg:pb-16 lg:pt-8">
        <div className="mx-auto max-w-6xl">
          <div className="mb-4 lg:hidden">
            <Brand name={siteName} />
          </div>
          <header className="flex flex-wrap items-end gap-x-5 gap-y-4">
            <div className="min-w-0 flex-1 basis-64">
              <h1 className="font-display text-3xl font-semibold text-ink-strong sm:text-4xl">{active.label}</h1>
              <p className="mt-1 text-sm text-ink-secondary">{active.lede}</p>
            </div>
            <button
              type="button"
              onClick={() => setSearching(true)}
              className="flex min-h-11 w-full items-center gap-2.5 rounded-xl border border-line-quiet bg-surface-raised px-3.5 text-left text-sm text-ink-secondary hover:border-line-strong sm:w-72"
            >
              <Search aria-hidden className="h-4 w-4 shrink-0" />
              <span className="flex-1">Jump to a journal or section</span>
              <kbd className="rounded-md border border-line-quiet px-1.5 py-0.5 font-mono text-[11px] text-ink-secondary">
                ⌘K
              </kbd>
            </button>
            <div
              role="group"
              aria-label="Period"
              className="flex gap-1 rounded-full border border-line-quiet bg-surface-raised p-1"
            >
              {PERIODS.map((count) => (
                <button
                  key={count}
                  type="button"
                  aria-pressed={days === count}
                  onClick={() => period(count)}
                  className={`min-h-9 min-w-[3.25rem] rounded-full px-3 text-sm font-semibold ${
                    days === count ? "bg-action-strong text-on-action" : "text-ink-body hover:bg-surface-subtle"
                  }`}
                >
                  {count}d
                </button>
              ))}
            </div>
          </header>

          {/* Every panel was rendered on the server in one pass, so they are
              all here and all but one hidden — throwing the others away would
              mean fetching them again on every tap, and `hidden` keeps the
              browser's find-in-page honest about which one it searched. */}
          {sections.map((one) => (
            <div key={one.id} hidden={one.id !== active.id}>
              {one.panel}
            </div>
          ))}
        </div>
      </div>

      <nav
        aria-label="Operator sections"
        className="fixed inset-x-3 bottom-3 z-40 flex gap-1 rounded-3xl border border-line-quiet bg-surface-raised/95 p-1.5 shadow-lg backdrop-blur lg:hidden"
      >
        {sections
          .filter((one) => one.primary)
          .map((one) => {
            const Icon = ICONS[one.icon];
            const on = one.id === active.id;
            return (
              <a
                key={one.id}
                href={`#${one.id}`}
                aria-current={on ? "page" : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  goTo(one.id);
                }}
                className={`relative flex min-h-[3.25rem] flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl text-[11px] font-semibold ${
                  on ? "bg-yellow-400 text-on-bright" : "text-ink-body"
                }`}
              >
                <Icon aria-hidden className="h-[18px] w-[18px]" />
                {one.label}
                {one.badge ? (
                  <span
                    aria-label={`${one.badge} waiting`}
                    className={`absolute right-2 top-1.5 h-2 w-2 rounded-full ${
                      one.badgeTone === "alert" ? "bg-coral-600" : "bg-action-strong"
                    }`}
                  />
                ) : null}
              </a>
            );
          })}
        <button
          type="button"
          aria-expanded={more}
          onClick={() => setMore((was) => !was)}
          className={`flex min-h-[3.25rem] flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl text-[11px] font-semibold ${
            sections.some((one) => !one.primary && one.id === active.id)
              ? "bg-yellow-400 text-on-bright"
              : "text-ink-body"
          }`}
        >
          <MoreHorizontal aria-hidden className="h-[18px] w-[18px]" />
          More
        </button>
      </nav>

      {more ? (
        <div className="fixed inset-0 z-50 bg-overlay-strong/60 lg:hidden" onClick={() => setMore(false)}>
          <div
            role="dialog"
            aria-label="More sections"
            className="absolute inset-x-3 bottom-24 space-y-3 rounded-3xl bg-surface-subtle p-4 shadow-xl"
            onClick={(event) => event.stopPropagation()}
          >
            <nav className="flex flex-col gap-1">
              {nav(() => setMore(false))}
            </nav>
            {foot}
          </div>
        </div>
      ) : null}

      <Palette open={searching} onOpen={setSearching} items={palette} onPick={(item) => goTo(item.hash)} />
    </div>
  );
}

function Brand({ name }: { name: string }) {
  return (
    <div className="flex items-center gap-2.5 px-3 pb-5 lg:pb-6">
      <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-yellow-400 text-on-bright">
        <Sprout aria-hidden className="h-5 w-5" />
      </span>
      <span>
        <span className="block font-display text-lg font-semibold leading-none text-ink-strong">{name}</span>
        <span className="mt-1 block font-mono text-[11px] uppercase tracking-[0.08em] text-ink-secondary">
          Operator
        </span>
      </span>
    </div>
  );
}

function Badge({ section, on }: { section: Section; on: boolean }) {
  if (!section.badge) return null;
  const alert = section.badgeTone === "alert";
  return (
    <span
      className={`ml-auto rounded-full px-2 py-0.5 font-mono text-xs font-semibold ${
        alert
          ? "bg-coral-600 text-on-deep"
          : on
            ? "bg-surface-raised text-ink-strong"
            : "text-ink-secondary"
      }`}
    >
      {section.badge}
    </span>
  );
}
