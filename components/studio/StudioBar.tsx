"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronUp } from "lucide-react";
import ActionBar from "@/components/studio/ActionBar";
import GroupMark from "@/components/studio/GroupMark";
import { useOutbox } from "@/components/studio/useOutbox";
import { useI18n } from "@/components/LocaleProvider";
import { STUDIO_GROUPS, type StudioGroup } from "@/lib/studio/groups";

type BarState = { actions: ReactNode; mode: "extend" | "replace"; revealAfterScroll: number; desktop: boolean };

/** What `StudioPage` tells the bar about the page it is drawing — B2069/B2076. */
type PageState = { group?: StudioGroup; width: "flow" | "board" | "wide" };

type StudioBarContextValue = {
  setBar: (state: BarState) => void;
  clearBar: () => void;
  setPage: (page: PageState | null) => void;
  /** B2331 — `useOutbox`'s own reachability probe (`/api/health`, not just
   *  `navigator.onLine`), shared here so every "needs a signal" feature can
   *  grey out on the same signal the pill already shows rather than each
   *  keeping its own, weaker one. See `useOnline`. */
  online: boolean;
};

/** The desktop row lines up with the page's own column (StudioPage's WIDTH). */
const ROW_WIDTH = { flow: "md:max-w-xl", board: "md:max-w-3xl", wide: "md:max-w-5xl" } as const;

const StudioBarContext = createContext<StudioBarContextValue | null>(null);

/**
 * One bottom `ActionBar` per studio subpage — B2001.
 *
 * B1992 gave four studio pages (the hub, the photobook chooser, the inbox
 * and the postcard flow) their own sticky bottom bar, each rendering
 * `ActionBar` itself. Every other studio page had none, so on a phone the
 * only way back to the studio was the header's small crumb at the very top
 * of a long page. `app/[user]/studio/layout.tsx` wraps every studio page in
 * this provider instead, which renders the one `ActionBar` — last in flow,
 * as `ActionBar`'s own doc comment requires for `position: sticky` to
 * behave — so a page gets a bar by doing nothing, and the four pages that
 * already had one keep it by calling `useStudioBar` instead of rendering
 * `ActionBar` themselves.
 *
 * The default, when no page has registered anything: a "Zurück zum Studio"
 * link to `/{user}/studio` (`studio.flow.backToStudio` — the exact string
 * `PhotobookPick`, `InboxHub` and `PostcardFlow` already used for the same
 * link before this ticket). `extend` keeps that link and adds a page's own
 * actions beside it; `replace` shows only the page's own actions — the hub
 * uses this because the hub *is* the studio, so a link back to itself would
 * be circular, and the inbox/postcard use it while a sheet or a selection
 * is open, so the default back link cannot be tapped by mistake mid-action.
 *
 * B2069: a page drawn through `StudioPage` tells this provider its group
 * (`StudioBarPage`), and the back link returns to that group's anchor on the
 * hub (`/{user}/studio#plan`) rather than the top of it.
 *
 * B2076: from `md` up the same bar is a static, right-aligned row under the
 * page's column — one element at every width, so the back link and the one
 * primary exist once in the document. Only on a `StudioPage` (the hub keeps
 * its own desktop grid) and only for what a caller marked `desktop` (a step
 * primary, the photobook chooser's "Show more"); the inbox and the postcard
 * already draw their own sheet and links in flow from `md`, so their bar
 * content stays phone-only.
 *
 * B2137: below `md` the provider's own wrapper is at least one viewport
 * tall with the page growing to fill it, so on a short page the bar's place
 * in the flow is the viewport's bottom edge — still `position: sticky`, still
 * last in flow, no reserved room. From `md` the wrapper is a plain block and
 * the desktop row follows the page, as before.
 *
 * B2141: beside "← Studio" a chevron opens `GroupSheet`, the six groups as
 * links to their hub sections. The back link itself stays one plain tap.
 *
 * B2329: a small status pill sits above the bar — offline, or how many
 * queued writes are still waiting, or that they are being sent right now.
 * It floats above the bar (`OutboxPill`) rather than sharing the row with
 * the back link and a page's own actions, so it never competes for the
 * limited width that row already has at 390px, and it is absent entirely —
 * no reserved space — the moment there is nothing to say (online, empty
 * queue): most studio sessions never see it.
 */
export default function StudioBarProvider({
  username,
  autoKeepTrips,
  children,
}: {
  username: string;
  /** D6, B2330 — the current trip and the soonest upcoming one
   *  (`offlineKeepTrips`, `lib/studio/day.ts`), kept on this phone by
   *  themselves once the studio is open and online, so the owner never has
   *  to find "Keep on this phone" for either. Absent fields are simply
   *  skipped — a journal with no trip yet, or nothing upcoming, keeps
   *  nothing new. */
  autoKeepTrips?: { current?: string; nextPlanned?: string };
  children: ReactNode;
}) {
  const { t } = useI18n();
  const [bar, setBar] = useState<BarState | null>(null);
  const [page, setPage] = useState<PageState | null>(null);
  const clearBar = useCallback(() => setBar(null), []);
  const outbox = useOutbox(username);
  const value = useMemo(
    () => ({ setBar, clearBar, setPage, online: outbox.online }),
    [clearBar, outbox.online],
  );

  // D6, B2330 — ask the worker to keep whichever of the two named trips it
  // does not already hold, the moment the studio is open and there is a
  // connection to fetch them with. The same `fernscout-keep` message
  // `KeepTrip.tsx`'s own "Keep on this phone" switch posts, so a trip kept
  // this way is indistinguishable from one the owner kept by hand — and the
  // same "is it already kept" read (`caches.keys()`, matched by the
  // `-<user>-<trip>` suffix, identity ignored) `KeepTrip.tsx`'s own
  // `keptBytes` uses, so this never re-fetches a trip already on the phone.
  useEffect(() => {
    if (!outbox.online) return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator) || typeof caches === "undefined") return;
    const ids = [autoKeepTrips?.current, autoKeepTrips?.nextPlanned].filter((id): id is string => !!id);
    if (ids.length === 0) return;
    let cancelled = false;
    void (async () => {
      const keys = await caches.keys().catch(() => [] as string[]);
      for (const trip of ids) {
        if (cancelled) return;
        const suffix = `-${username}-${trip}`;
        if (keys.some((k) => k.startsWith("kept-") && k.endsWith(suffix))) continue;
        navigator.serviceWorker.controller?.postMessage({ type: "fernscout-keep", user: username, trip });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [outbox.online, autoKeepTrips?.current, autoKeepTrips?.nextPlanned, username]);

  // B2329 — the worker only knows which `personal-<id>` cache is this
  // owner's own once something has fetched `/api/v2/me/home` (the same
  // request `Landing.tsx` makes on `/`); a studio session reached by a
  // bookmark or an installed PWA's own shortcut never visits `/`. This reads
  // the worker's own pointer cache first (`caches`, not `indexedDB` — a plain
  // browser API, not gated by `hasOutbox()`) and only fires the request when
  // no identity is known yet, so a test environment with no `CacheStorage`
  // (jsdom) and a browser that already knows the identity both do nothing.
  useEffect(() => {
    if (typeof caches === "undefined") return;
    let cancelled = false;
    caches
      .open("personal-pointer")
      .then((c) => c.match("https://fernscout.invalid/personal-id"))
      .then((known) => {
        if (cancelled || known) return undefined;
        return fetch("/api/v2/me/home", { headers: { accept: "application/json" } });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // A step's primary (B2002) shares the row with this link below 430px —
  // the same width the hub's own three-pill row gives up a label at
  // (B1996) — so below that width the back link keeps only its icon and
  // lets the primary's own label have the room instead.
  const hasExtension = bar?.mode !== "replace" && !!bar?.actions;
  const backLink = (
    <Link
      href={`/${username}/studio${page?.group ? `#${page.group}` : ""}`}
      aria-label={t("studio.flow.backToStudio")}
      className={`flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-full border border-line-strong
                 px-4 text-sm font-semibold text-ink-body transition-colors hover:bg-surface-subtle ${
                   // Beside a step primary the link is only an arrow below
                   // 430px, so it takes the arrow's width and no more — the
                   // primary's label gets the rest of the row (B2002).
                   hasExtension ? "flex-none min-[430px]:min-w-0 min-[430px]:flex-1" : "min-w-0 flex-1"
                 } md:flex-none`}
    >
      <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden strokeWidth={2.2} />
      <span className={hasExtension ? "hidden truncate min-[430px]:inline" : "truncate"}>
        {t("studio.flow.backToStudio")}
      </span>
    </Link>
  );

  return (
    <StudioBarContext.Provider value={value}>
      <div className="max-md:flex max-md:min-h-[100dvh] max-md:flex-col">
      <div className="max-md:flex-1">{children}</div>
      <div className="relative">
        <OutboxPill
          username={username}
          online={outbox.online}
          pending={outbox.pending}
          conflicts={outbox.conflicts}
          syncing={outbox.syncing}
        />
        <ActionBar
          revealAfterScroll={bar?.revealAfterScroll ?? 0}
          desktop={page && !(bar?.mode === "replace" && !bar.desktop) ? ROW_WIDTH[page.width] : null}
        >
          {bar?.mode === "replace" ? (
            bar.actions
          ) : (
            <>
              {backLink}
              {page && <GroupSheet username={username} />}
              {bar?.desktop ? bar.actions : bar?.actions && <div className="contents md:hidden">{bar.actions}</div>}
            </>
          )}
        </ActionBar>
      </div>
      </div>
    </StudioBarContext.Provider>
  );
}

/**
 * Offline / waiting / syncing — B2329. Absent when there is nothing to say:
 * online with an empty queue is the common case and gets no pill at all.
 * Floats above the bar rather than inside its row (see the provider's own
 * doc comment) so it never has to fight the row for width.
 */
function OutboxPill({
  username,
  online,
  pending,
  conflicts,
  syncing,
}: {
  username: string;
  online: boolean;
  pending: number;
  conflicts: number;
  syncing: boolean;
}) {
  const { t, tn } = useI18n();
  // B2331, D3 — a conflict needs the owner's own decision before anything
  // else this pill could say matters; it takes priority over "waiting" or
  // "offline" and, unlike those, is a real link (`pointer-events-none`
  // dropped) to where that decision is actually made.
  if (conflicts > 0) {
    return (
      <Link
        href={`/${username}/studio/day/conflicts`}
        className="absolute -top-3 left-4 z-20 -translate-y-full rounded-full border border-coral-400
                   bg-coral-100 px-3 py-1 text-xs font-semibold text-coral-600 shadow-sm hover:bg-coral-300/40"
      >
        {tn("studio.outbox.conflicts", conflicts, { n: String(conflicts) })}
      </Link>
    );
  }
  if (online && pending === 0 && !syncing) return null;
  const label = !online
    ? pending > 0
      ? t("studio.outbox.offlineWaiting", { n: String(pending) })
      : t("studio.outbox.offline")
    : syncing
      ? t("studio.outbox.syncing")
      : t("studio.outbox.waiting", { n: String(pending) });
  return (
    <p
      role="status"
      className="pointer-events-none absolute -top-3 left-4 z-20 -translate-y-full rounded-full border border-line-quiet
                 bg-surface-raised px-3 py-1 text-xs font-semibold text-ink-body shadow-sm"
    >
      {label}
    </p>
  );
}

/**
 * The six studio groups, one tap from any subpage — B2141. A `<details>`, so
 * it opens from the keyboard (Enter/Space on the chevron) with no script of
 * its own; Escape and choosing a group close it. It opens upwards: the bar
 * sits at the foot of the page.
 */
function GroupSheet({ username }: { username: string }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDetailsElement>(null);
  const close = () => {
    if (ref.current) ref.current.open = false;
  };
  return (
    <details
      ref={ref}
      data-group-sheet
      // Below md the sheet hangs off the sticky bar itself (left-aligned with
      // the page, never past the viewport's edge); from md, off the chevron.
      className="flex-none md:relative"
      onKeyDown={(e) => {
        if (e.key === "Escape" && ref.current?.open) {
          close();
          ref.current.querySelector("summary")?.focus();
        }
      }}
    >
      <summary
        aria-label={t("studio.flow.groups")}
        className="flex min-h-11 min-w-11 cursor-pointer list-none items-center justify-center rounded-full border
                   border-line-strong text-ink-body transition-colors hover:bg-surface-subtle [&::-webkit-details-marker]:hidden"
      >
        <ChevronUp className="h-4 w-4" aria-hidden strokeWidth={2.2} />
      </summary>
      <nav
        aria-label={t("studio.flow.groups")}
        className="absolute bottom-full left-4 z-30 mb-2 w-60 md:left-auto md:right-0 rounded-2xl border border-line-quiet bg-surface-raised p-2 shadow-lg"
      >
        <ul>
          {STUDIO_GROUPS.map((group) => (
            <li key={group}>
              <Link
                href={`/${username}/studio#${group}`}
                onClick={close}
                className="block rounded-xl px-2 pt-2 pb-0.5 hover:bg-surface-subtle"
              >
                <GroupMark group={group} size="sm" />
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </details>
  );
}

/**
 * B2331 — the shared reachability signal every "needs a signal" feature
 * reads instead of keeping its own. `null` outside the provider (a test
 * that mounts a component on its own with no `StudioBarProvider`), which
 * `useOnline` treats as "no shared answer" and falls back to
 * `navigator.onLine`.
 */
export function useStudioOnline(): boolean | null {
  const ctx = useContext(StudioBarContext);
  return ctx ? ctx.online : null;
}

/**
 * Registers one page's own bottom-bar content. Sets it in an effect (so the
 * very first paint — server-rendered, before this effect has run — shows
 * the provider's default back link) and clears it on unmount, so a page
 * that stops rendering never leaves stale actions behind for the next one.
 *
 * `replace: true` hides the default back link and shows only `actions`;
 * `revealAfterScroll` (the hub's own option, B1992) keeps the bar hidden
 * until the page has been scrolled that many pixels — every other caller
 * leaves it at 0 and shows the bar at once.
 */
export function useStudioBar(
  actions: ReactNode,
  {
    replace = false,
    revealAfterScroll = 0,
    desktop = false,
  }: { replace?: boolean; revealAfterScroll?: number; desktop?: boolean } = {},
) {
  const ctx = useContext(StudioBarContext);
  if (!ctx) throw new Error("useStudioBar must be used under app/[user]/studio/layout.tsx");
  const { setBar, clearBar } = ctx;
  useEffect(() => {
    setBar({ actions, mode: replace ? "replace" : "extend", revealAfterScroll, desktop });
    return clearBar;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `actions` is a fresh element tree every render by design; re-registering on every change is the point (an inbox move sheet, a postcard selection).
  }, [actions, replace, revealAfterScroll, desktop]);
}

/**
 * Rendered by `StudioPage` — tells the provider this is a subpage, which
 * group it belongs to (the back link's anchor) and how wide its column is
 * (the desktop row's). Draws nothing; a no-op outside the provider, so
 * `StudioPage` still renders on its own in a test.
 */
export function StudioBarPage({ group, width }: PageState) {
  const setPage = useContext(StudioBarContext)?.setPage;
  useEffect(() => {
    if (!setPage) return;
    setPage({ group, width });
    return () => setPage(null);
  }, [setPage, group, width]);
  return null;
}
