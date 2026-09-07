"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Bot, FileText, Menu, X } from "lucide-react";
import BackLink from "./BackLink";
import SiteNav, { useNavEntries } from "./SiteNav";
import SkipLink from "./SkipLink";
import CurrencySwitcher from "./CurrencySwitcher";
import LocaleSwitcher from "./LocaleSwitcher";
import TripSwitcher from "./TripSwitcher";
import { useI18n } from "./LocaleProvider";
import { useTrip } from "./TripProvider";
import { useSite } from "@/components/SiteProvider";

export default function PageHeader({
  children,
  onHome,
}: {
  children?: React.ReactNode;
  /** Supplied by the story page: clicking the title there is a same-route
   * navigation, which leaves the pager sitting on whatever day it was on, so
   * that page handles it itself instead of linking. */
  onHome?: () => void;
}) {
  const { localizedTrip, t } = useI18n();
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
  const currentSection = navEntries.find((e) => e.active);

  const [menuOpen, setMenuOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(false);

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
    <header className="sticky top-0 z-30 border-b border-navy-200 bg-cream-100/95 px-4 py-2.5 backdrop-blur sm:px-6 sm:py-3">
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
          {/* See the identical link in the `sm`-and-up block below for why
              this exists and who it is drawn for. Icon-only here — the row
              has no room for the sentence a laptop gets — with the same
              accessible name carried by `aria-label` instead of visible text. */}
          {site.hasIdentity && (
            <BackLink
              fallbackHref="/"
              fallbackLabel={t("nav.myJournals")}
              retraceLabel={t("nav.back")}
              showLabel={false}
              iconClassName="h-5 w-5"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-navy-600
                         transition-colors hover:bg-navy-200/60 hover:text-navy-900
                         focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
            />
          )}
          {onHome ? (
            <button
              onClick={onHome}
              className="flex min-h-11 min-w-0 flex-1 items-center truncate text-left font-display
                         text-lg font-semibold tracking-tight text-navy-900"
            >
              {site.title}
            </button>
          ) : (
            <Link
              href={homeHref}
              className="min-w-0 flex-1 truncate font-display text-lg font-semibold tracking-tight text-navy-900"
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
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-navy-700
                       transition-colors hover:bg-navy-200/60
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
            className="mt-3 max-h-[70vh] overflow-y-auto rounded-2xl border border-navy-200 bg-cream-50 p-3 shadow-lg"
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
            <div className="flex flex-wrap items-center gap-2 border-b border-navy-200 pb-3">
              <TripSwitcher />
              <CurrencySwitcher />
              <LocaleSwitcher />
              <Link
                href="/docs"
                onClick={() => setMenuOpen(false)}
                className="flex min-h-11 items-center gap-1 rounded-full border border-navy-200 bg-white
                           px-3 text-sm font-semibold text-navy-700 transition-colors
                           hover:border-navy-500 focus-visible:outline-2 focus-visible:outline-offset-2
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
            <div className="mt-3">
              {/*
                Agent and Docs, as rows in the same list as the destinations
                below them — B824. B797 put these above the list as a
                differently-shaped navy pill and a quiet link under a rule;
                seeing that in place read as a banner stuck on the menu
                rather than as part of it, so they take the destinations'
                own row shape instead (`min-h-12`, icon + word, `rounded-xl`)
                and sit first, above Reise. They keep exactly one thing that
                marks them out: a hairline under Docs, since they are still
                not ordinary destinations — the agent leads from every
                header (B797) and Docs needs no capability to reach (B802).

                `helper` still gates the agent row; Docs stays ungated for
                the same reason as the `sm`-and-up header below. Neither row
                ever carries `aria-current` — they are never the active
                destination, so `yellow-400` stays true to "you are here".
              */}
              {site.helperEnabled && (
                <nav className="border-b border-navy-200 pb-2">
                  <Link
                    href="/agent"
                    onClick={() => setMenuOpen(false)}
                    className="flex min-h-12 items-center gap-3 rounded-xl bg-navy-900 px-3 text-base
                               font-semibold text-cream-50 transition-colors hover:bg-navy-700
                               focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
                  >
                    <Bot
                      className="h-5 w-5 shrink-0"
                      aria-hidden
                      strokeWidth={2.2}
                    />
                    {t("nav.agent")}
                  </Link>
                </nav>
              )}
              <div className="mt-1">
                <SiteNav variant="list" onNavigate={() => setMenuOpen(false)} />
              </div>
            </div>
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
            The way back out of this journal — B433.

            Inside the title box rather than as an eighth entry in `SiteNav`.
            That row is measured, twice, in the comments above: seven controls
            already wrap onto their own line at phone widths and were the cause
            of both B170 and B212. An eighth would be spent on the one control
            that is not about this journal at all.

            Above the title because it is a breadcrumb: it names where this
            journal sits, which is the same relationship `/` now has to it.
            Small, quiet, and the same at every width — a reader who arrived on
            a phone and one who arrived on a laptop are equally stuck without
            it, so this is not a mobile affordance with a desktop equivalent
            somewhere else.

            Drawn only for a reader holding an identity, because only they have
            somewhere to go: `/` is their journals, and for everybody else it
            is the pitch. See `hasIdentity` in lib/site.ts for why that is not
            `signedIn`.
          */}
          {site.hasIdentity && (
            <BackLink
              fallbackHref="/"
              fallbackLabel={t("nav.myJournals")}
              retraceLabel={t("nav.back")}
              iconClassName="h-3.5 w-3.5"
              className="-ml-1 mb-0.5 inline-flex min-h-6 items-center gap-1 rounded px-1 text-xs
                         font-semibold text-navy-600 transition-colors hover:text-navy-900
                         focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
            />
          )}
          {onHome ? (
            <button
              onClick={onHome}
              className="block max-w-full truncate font-display text-lg font-semibold tracking-tight text-navy-900 sm:text-xl"
            >
              {site.title}
            </button>
          ) : (
            <Link
              href={homeHref}
              className="block truncate font-display text-lg font-semibold tracking-tight text-navy-900 sm:text-xl"
            >
              {site.title}
            </Link>
          )}
          <p className="hidden truncate text-xs text-navy-600 sm:block">
            {tagline}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          {children}
          <TripSwitcher />
          <CurrencySwitcher />
          <LocaleSwitcher />
          {/*
            The way to `/agent`, at `sm` and up — B797. Gated on `helper`
            together with Docs, same as the mobile panel and for the same
            reason — see the comment there.

            There is room here that the phone row does not have, so
            icon-and-word sits inline rather than waiting for the panel.
            `bg-navy-900` rather than `yellow-400`, same reasoning as the
            mobile panel above: `SiteNav`'s active-tab colour, on the line
            below, is already the header's "you are here" waymark, and this
            is a different kind of control — a call to action to leave the
            journal and go write, not a place in it. Docs stays quieter,
            icon only, per request 3.
          */}
          {site.helperEnabled && (
            <Link
              href="/agent"
              className="flex min-h-11 items-center gap-2 rounded-full bg-navy-900 px-4 text-sm font-semibold
                           text-cream-50 transition-colors hover:bg-navy-800
                           focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
            >
              <Bot className="h-4 w-4" aria-hidden strokeWidth={2.2} />
              {t("nav.agent")}
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
            className="flex h-11 w-11 items-center justify-center rounded-full text-navy-600
                           transition-colors hover:bg-navy-200/60 hover:text-navy-900
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
