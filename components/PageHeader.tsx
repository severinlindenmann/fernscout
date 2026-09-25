"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { FileText, Menu, NotebookPen, X } from "lucide-react";
import UpLink from "./UpLink";
import UpTrail from "./UpTrail";
import { useUpCrumbs } from "./useUpCrumbs";
import SiteNav, { useNavEntries } from "./SiteNav";
import SkipLink from "./SkipLink";
import CurrencySwitcher from "./CurrencySwitcher";
import LocaleSwitcher from "./LocaleSwitcher";
import ThemeSwitcher from "./ThemeSwitcher";
import TripSwitcher from "./TripSwitcher";
import { useI18n } from "./LocaleProvider";
import { useTrip } from "./TripProvider";
import { useSite } from "@/components/SiteProvider";
import type { TranslationKey } from "@/lib/i18n";

/**
 * Whether the header should be out of the way right now — B2162, the
 * owner's pick 2. On a phone, reading pages hand the whole screen to the
 * page: scrolling down past the header's own height slides it out, the
 * first scroll up brings it back, and so does the top of the page (which is
 * where iOS puts you on a status-bar tap). A small threshold keeps a
 * finger's jitter from flapping it. Desktop never hides it — there is room.
 */
function useHiddenOnScroll(enabled: boolean): boolean {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let last = window.scrollY;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(() => {
        const y = window.scrollY;
        const delta = y - last;
        if (y <= 8) setHidden(false);
        else if (delta > 6 && y > 72) setHidden(true);
        else if (delta < -6) setHidden(false);
        last = y;
        ticking = false;
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [enabled]);
  return enabled && hidden;
}

export default function PageHeader({
  children,
  onHome,
  backTo,
  hideOnScroll = false,
}: {
  children?: React.ReactNode;
  /** Reading pages only (B2162): the header slides away while scrolling
   * down on a phone and returns on the first scroll up. Never the studio. */
  hideOnScroll?: boolean;
  /** Supplied by the story page: clicking the title there is a same-route
   * navigation, which leaves the pager sitting on whatever day it was on, so
   * that page handles it itself instead of linking. */
  onHome?: () => void;
  /**
   * Overrides the ancestor trail `useUpCrumbs` would otherwise compute from
   * the URL alone — B1992. `lib/navUp.ts` only knows the journal and the
   * trip; it has no way to know that `/<user>/studio/day/edit`'s real parent
   * is the studio hub rather than the trip list, because nothing about that
   * shape is in the path. Every studio subpage passes this instead of
   * forking the header for one different word.
   */
  backTo?: { href: string; labelKey: TranslationKey };
}) {
  const { localizedTrip, t } = useI18n();
  const hidden = useHiddenOnScroll(hideOnScroll);
  const site = useSite();
  // Null on pages with no trip in context, such as /trips — the site logo
  // there has nowhere trip-relative to go, so it falls back to "/".
  const active = useTrip();
  // Outside a trip (the trip list, search, join) the logo still belongs to the
  // journal, not to the instance's landing page.
  const homeHref = active ? active.href("/") : site.base;
  const tagline = active
    ? (localizedTrip(active.trip).tagline ?? site.tagline)
    : site.tagline;
  const navEntries = useNavEntries();
  // The phone row takes the nearest ancestor only; `UpTrail` draws the whole
  // chain from `sm` up. Both read the same source — B1728. `backTo` (B1992)
  // replaces that source wholesale with a single crumb, for a page whose
  // real "up" the URL alone cannot say.
  const upCrumbs = useUpCrumbs();
  const crumbs = backTo ? [{ href: backTo.href, label: t(backTo.labelKey) }] : upCrumbs;
  const currentSection = navEntries.find((e) => e.active);

  const [menuOpen, setMenuOpen] = useState(false);
  const [panelOverflowsBelow, setPanelOverflowsBelow] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);

  // Whether the panel has more content below the fold — B1418. Drives a
  // bottom fade so a reader does not mistake a `max-h` cut for the whole
  // menu; recomputed on scroll and on resize, since a rotation can turn an
  // overflowing panel into one that fits.
  useEffect(() => {
    if (!menuOpen) return;
    const panel = panelRef.current;
    if (!panel) return;
    const update = () => {
      setPanelOverflowsBelow(
        panel.scrollHeight - panel.scrollTop - panel.clientHeight > 1,
      );
    };
    update();
    panel.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      panel.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    // Moves focus into the panel — the container itself, since its first
    // real control (the trip switcher, or the story link) is exactly as good
    // a landing spot as a dedicated "skip to here" button would have been,
    // and adding one would have been a second close affordance beside
    // tapping outside and Escape.
    panelRef.current?.focus();
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        // Without this, the browser's own default action for the same click
        // — moving focus onto whatever was tapped — lands after the panel's
        // effect has already sent focus back to the button, and wins. The
        // tap itself did nothing anyway: it landed outside every control in
        // the header, so there is nothing here to lose by cancelling it.
        e.preventDefault();
        setMenuOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  // Focus lands back on the button for every way the panel closes — Escape,
  // a tap outside, or a link inside it — rather than only the keyboard path,
  // so a reader who dismissed it by touch does not lose their place either.
  useEffect(() => {
    if (wasOpen.current && !menuOpen) menuButtonRef.current?.focus();
    wasOpen.current = menuOpen;
  }, [menuOpen]);

  return (
    <header
      className={`sticky top-0 z-30 -mt-[env(safe-area-inset-top,0px)] border-b border-line-quiet bg-surface-subtle/95 px-4 pb-2.5 pt-[calc(env(safe-area-inset-top,0px)+0.625rem)] backdrop-blur motion-safe:transition-transform motion-safe:duration-200 sm:px-6 sm:pb-3 sm:pt-[calc(env(safe-area-inset-top,0px)+0.75rem)] ${
        hidden ? "max-lg:-translate-y-full" : ""
      }`}
    >
      <SkipLink />
      {/*
        One row on a phone, below `sm` — B770.

        The four-row stack this replaced (a back link, the title, three
        chips, seven nav icons) spent a quarter of a 390px viewport on chrome
        before a word of the journal appeared, above a page that already
        carries a fixed bottom day-navigator on its story pages. A bottom tab
        bar was the other phone-native answer and was not available for the
        same reason: two fixed bars would leave almost no reading window.

        So: back, the journal's name, which section this is, and a single
        button — everything else (the trip switcher, currency, language, and
        the seven destinations) moves into the panel below, opened by that
        button. `sm` and up keep the arrangement this header always had; see
        the block after the panel.

        The current section stays visible without opening the panel: a small
        yellow-400 disc carrying that section's own icon, the same waymark
        `SiteNav`'s tab bar already uses for "you are here" — B770 kept the
        idiom rather than inventing a second one for the same fact.
      */}
      <div ref={wrapRef} className="sm:hidden">
        <div className="flex items-center gap-1">
          {/*
            One step up, with the destination's name on it — B1728.

            It used to be a bare arrow (`showLabel={false}`), and that is half
            of why the control was unreadable: `BackLink` swapped its meaning
            between "your journals" and `router.back()` and announced the swap
            by changing its label, which this row never drew. The word is here
            now, truncating against the title beside it, and there is only one
            meaning left for it to carry.

            The nearest crumb only. The full trail needs a line of its own and
            this row does not have one — see `UpTrail`.

            No longer gated on `site.hasIdentity` (B433's rule, now retired
            here): a reader who followed a shared link into one day is the
            person most stuck without a way out, and they are exactly the one
            holding no identity. The *word* still depends on it — "Your
            journals" for a reader who has some, the instance's own name for a
            stranger — which is what that gate was really protecting.
          */}
          {crumbs.length > 0 && (
            <UpLink
              href={crumbs[0].href}
              label={crumbs[0].label}
              iconClassName="h-5 w-5 shrink-0"
              labelClassName="truncate max-w-[8rem]"
              className="flex h-11 min-w-0 shrink items-center gap-1 rounded-full pl-1.5 pr-2 text-sm
                         font-semibold text-ink-secondary transition-colors hover:bg-surface-selected/60
                         hover:text-ink-strong focus-visible:outline-2 focus-visible:outline-offset-2
                         focus-visible:outline-blue-500"
            />
          )}
          {onHome ? (
            <button
              onClick={onHome}
              className="flex min-h-11 min-w-0 flex-1 items-center truncate text-left font-display
                         text-lg font-semibold tracking-tight text-ink-strong"
            >
              {site.title}
            </button>
          ) : (
            <Link
              href={homeHref}
              className="min-w-0 flex-1 truncate font-display text-lg font-semibold tracking-tight text-ink-strong"
            >
              {site.title}
            </Link>
          )}
          {currentSection && (
            <span
              role="img"
              aria-label={currentSection.label}
              title={currentSection.label}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-yellow-400 text-yellow-950"
            >
              <currentSection.Icon
                className="h-4 w-4"
                aria-hidden
                strokeWidth={2.4}
              />
            </span>
          )}
          <button
            ref={menuButtonRef}
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            aria-haspopup="dialog"
            aria-expanded={menuOpen}
            aria-controls="mobile-menu-panel"
            aria-label={menuOpen ? t("nav.closeMenu") : t("nav.menu")}
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink-body
                       transition-colors hover:bg-surface-selected/60
                       focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
          >
            {menuOpen ? (
              <X className="h-5 w-5" aria-hidden strokeWidth={2.2} />
            ) : (
              <Menu className="h-5 w-5" aria-hidden strokeWidth={2.2} />
            )}
          </button>
        </div>

        {menuOpen && (
          // In the flow, not over it — the same call `ConfirmPanel` makes and
          // for the same reason: nothing here is urgent enough to dim the
          // page for, so `aria-modal` stays false and Escape plus a tap
          // outside are the whole of how it closes (handled above).
          <div
            id="mobile-menu-panel"
            ref={panelRef}
            role="dialog"
            aria-modal="false"
            aria-label={t("nav.menu")}
            tabIndex={-1}
            className="relative mt-3 max-h-[70vh] overflow-y-auto rounded-2xl border border-line-quiet bg-surface-base p-3 shadow-lg"
          >
            {/* `children` is not repeated here: the one caller that passes any
                (`TripStory`'s day counter) already marks it `xl:block`, so it
                never draws below the width this panel exists for — mounting
                a second, permanently invisible copy would be for nothing. */}
            {/* Docs sits with the chips, not with the destinations — B843.
                Reise, Galerie, Karte and the rest are places inside this
                journal; `/docs` is the software's own documentation and
                leaves it entirely, so listing it among them said it was one
                of them. The chips row is already where the things that are
                not destinations live. Icon-only, with the label as its
                accessible name, because it is joining a set rather than
                arriving as a new kind of control. */}
            <div className="flex flex-wrap items-center gap-2 border-b border-line-quiet pb-3">
              <TripSwitcher />
              <CurrencySwitcher />
              <LocaleSwitcher />
              <ThemeSwitcher />
              <Link
                href="/docs"
                onClick={() => setMenuOpen(false)}
                className="flex min-h-11 items-center gap-1 rounded-full border border-line-quiet bg-surface-raised
                           px-3 text-sm font-semibold text-ink-body transition-colors
                           hover:border-line-prominent focus-visible:outline-2 focus-visible:outline-offset-2
                           focus-visible:outline-blue-500"
              >
                <FileText
                  className="h-4 w-4 shrink-0"
                  aria-hidden
                  strokeWidth={2.2}
                />
                {t("nav.docs")}
              </Link>
            </div>
              {/*
                The studio and Docs, as rows in the same list as the destinations
                below them — B824. B797 put these above the list as a
                differently-shaped navy pill and a quiet link under a rule;
                seeing that in place read as a banner stuck on the menu
                rather than as part of it, so they take the destinations'
                own row shape instead (`min-h-12`, icon + word, `rounded-xl`)
                and sit first, above Reise. They keep exactly one thing that
                marks them out: a hairline under Docs, since they are still
                not ordinary destinations — this row leads from every header
                (B797) and Docs needs no capability to reach (B802).

                **Points at the studio, not `/agent` — B1905.** It used to be
                the way into the room; the room is on a retirement path
                (`docs/plans/2026-09-17-the-studio.md`) and this row is the
                header's one prominent "go write" call, so it follows the
                capability rather than the old destination.

                `helper` still gates the row, and it is owner-only now too:
                unlike `/agent`, which always opened *this reader's own*
                journal regardless of whose page they were on, `/<user>/studio`
                is gated on this journal specifically (`requireStudioOwner`),
                so a guest reading somebody else's trip has nothing at the far
                end of it. Docs stays ungated for the same reason as the
                `sm`-and-up header below. Neither row ever carries
                `aria-current` — they are never the active destination, so
                `yellow-400` stays true to "you are here".
              */}
              {site.isOwner && (
                <nav className="border-b border-line-quiet pb-2">
                  <Link
                    href={`${site.base}/studio`}
                    onClick={() => setMenuOpen(false)}
                    className="flex min-h-12 items-center gap-3 rounded-xl bg-action-strong px-3 text-base
                               font-semibold text-on-action transition-colors hover:bg-action-strong-hover
                               focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
                  >
                    <NotebookPen
                      className="h-5 w-5 shrink-0"
                      aria-hidden
                      strokeWidth={2.2}
                    />
                    {t("nav.studio")}
                  </Link>
                </nav>
              )}
            <div className="mt-3">
              <div className="mt-1">
                <SiteNav variant="list" onNavigate={() => setMenuOpen(false)} />
              </div>
            </div>
            {panelOverflowsBelow && (
              // A hairline inset shadow reads as a shelf edge rather than a
              // wash of the panel's own background over the last row, which
              // is what a plain gradient did to a highlighted or dark row.
              <div
                aria-hidden
                className="pointer-events-none sticky bottom-0 -mx-3 -mb-3 -mt-2.5 h-2.5
                           shadow-[inset_0_-9px_8px_-8px_rgba(28,43,63,0.35)]"
              />
            )}
          </div>
        )}
      </div>
      {/*
        `sm` and up: the arrangement this header has always had.

        Nine controls and a journal title do not fit across 390px once every
        control is 44px tall — 373px of controls into 343px of room, which is
        the whole reason the block above exists now. From `sm` there is room:
        title and the small chips share the first line, the nav wraps to a
        second line of its own until `lg`, where everything fits on one.

        The row keeps its own width rather than the 5xl content column: the
        nine controls measure ~985px, which left the title a 15px box that its
        own text then overflowed, printing the journal name across the day
        counter. Wider row, and the nav keeps its second line up to `lg`.

        The title's `12rem` basis is what stops that from happening again in a
        quieter way (B170, and B212 which saw it from outside). `flex-1` alone
        is `flex: 1 1 0%`, and a flex base size of zero is what a browser uses
        to decide whether a row *fits*: the title contributed nothing to that
        sum, so the nav never wrapped and the title absorbed the entire
        shortfall instead. Measured on `/example/trips/parks-2025` at 1440,
        where the chips carry the day counter: 525px of chips and 660px of nav
        into a 1280px row left the title a 71px box for 140px of "Fernscout
        Demo", and the header of every trip page in the README said "Ferns…"
        with half a screen of empty space beside it.

        With a real basis the row is measured as 192 + 525 + 660 and does not
        fit, so the nav takes the second line it is already built for — it has
        wrapped below `lg` since B44 — and `grow` on its box makes it fill that
        line so `justify-end` still puts the pills on the right. The order of
        what gives is then the one the page wants: the tagline truncates first,
        the nav moves to its own line second, and the journal's name — the only
        thing in the header that says whose journal this is — is last.

        `grow` stops at `lg` (`lg:grow-0`, B285). Past that point the nav
        shares the line with the title and chips instead of owning it alone,
        and a `grow` that kept applying there competed with the title's own
        `grow` for whatever the row had left over. On a page with a small chip
        row — no active trip, one currency — that left only the language chip
        in the middle, pinned between two boxes that had each swollen to
        absorb half the leftover width, with a few hundred pixels of empty
        space on both sides of it. Past `lg` there is nothing left to fill —
        `SiteNav`'s content is `justify-end` inside a box no longer wider than
        itself — so the chips and the nav end up as one tight cluster at the
        row's right edge instead.
      */}
      <div className="mx-auto hidden max-w-7xl flex-wrap items-center gap-x-3 gap-y-2 sm:flex">
        <div className="min-w-0 flex-[1_1_12rem]">
          {/*
            Where this page sits — B433, rebuilt by B1728.

            Inside the title box rather than as an eighth entry in `SiteNav`.
            That row is measured, twice, in the comments above: seven controls
            already wrap onto their own line at phone widths and were the cause
            of both B170 and B212. An eighth would be spent on the one control
            that is not about this journal at all.

            Above the title because it is a breadcrumb — and B1728 is the
            ticket that made it one in fact rather than only in this comment.
            It was a single arrow that led to `/` on a fresh tab and to
            `router.back()` once the tab had navigated anywhere, which is how
            a reader clicking a breadcrumb ended up one page sideways instead
            of one level up. Now it is the chain, every crumb a link, nothing
            in it depending on what the reader did earlier in the tab.

            Drawn for everybody. B433 gated it on `hasIdentity` because `/`
            was its only destination and a stranger has no journals there; the
            trail's nearest crumbs are this journal and this trip, which every
            reader has, and the one crumb that is `/` takes the instance's own
            name for a reader with no identity. See `useUpCrumbs`.
          */}
          <UpTrail crumbs={crumbs} />
          {onHome ? (
            <button
              onClick={onHome}
              className="block max-w-full truncate font-display text-lg font-semibold tracking-tight text-ink-strong sm:text-xl"
            >
              {site.title}
            </button>
          ) : (
            <Link
              href={homeHref}
              className="block truncate font-display text-lg font-semibold tracking-tight text-ink-strong sm:text-xl"
            >
              {site.title}
            </Link>
          )}
          <p className="hidden truncate text-xs text-ink-secondary sm:block">
            {tagline}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          {children}
          <TripSwitcher />
          <CurrencySwitcher />
          <LocaleSwitcher />
          <ThemeSwitcher />
          {/*
            The way to the studio, at `sm` and up — B797, repointed by B1905.
            Gated on `helper` and ownership together with Docs, same as the
            mobile panel and for the same reason — see the comment there.

            There is room here that the phone row does not have, so
            icon-and-word sits inline rather than waiting for the panel.
            `bg-action-strong` rather than `yellow-400`, same reasoning as the
            mobile panel above: `SiteNav`'s active-tab colour, on the line
            below, is already the header's "you are here" waymark, and this
            is a different kind of control — a call to action to leave the
            journal and go write, not a place in it. Docs stays quieter,
            icon only, per request 3.
          */}
          {site.isOwner && (
            <Link
              href={`${site.base}/studio`}
              className="flex min-h-11 items-center gap-2 rounded-full bg-action-strong px-4 text-sm font-semibold
                           text-on-action transition-colors hover:bg-action-strong-hover
                           focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
            >
              <NotebookPen className="h-4 w-4" aria-hidden strokeWidth={2.2} />
              {t("nav.studio")}
            </Link>
          )}
          {/* Docs is NOT gated — `/docs` needs no capability, and gating it
              alongside the agent left a self-hoster with the helper off (the
              default) no route to the documentation at all once the landing
              page's own link was removed. B802. */}
          <Link
            href="/docs"
            title={t("nav.docs")}
            aria-label={t("nav.docs")}
            className="flex h-11 w-11 items-center justify-center rounded-full text-ink-secondary
                           transition-colors hover:bg-surface-selected/60 hover:text-ink-strong
                           focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
          >
            <FileText className="h-4 w-4" aria-hidden strokeWidth={2.2} />
          </Link>
        </div>
        <div className="flex w-full grow justify-end lg:w-auto lg:grow-0">
          <SiteNav />
        </div>
      </div>
    </header>
  );
}
