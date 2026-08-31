"use client";

import Link from "next/link";
import SiteNav from "./SiteNav";
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
  const { localizedTrip } = useI18n();
  const site = useSite();
  // Null on pages with no trip in context, such as /trips — the site logo
  // there has nowhere trip-relative to go, so it falls back to "/".
  const active = useTrip();
  // Outside a trip (the trip list, search, join) the logo still belongs to the
  // journal, not to the instance's landing page.
  const homeHref = active ? active.href("/") : site.base;
  const tagline = active ? localizedTrip(active.trip).tagline ?? site.tagline : site.tagline;

  return (
    <header className="sticky top-0 z-30 border-b border-navy-200 bg-cream-100/95 px-4 py-3 backdrop-blur sm:px-6">
      <SkipLink />
      {/*
        Two rows on a phone, one from `sm` up.

        Nine controls and a journal title do not fit across 390px once every
        control is 44px tall — 373px of controls into 343px of room. The old
        single row "solved" that by crushing the title to 32px wide, three
        characters of somebody's name, and pushing the document 11px past the
        screen so the whole site scrolled sideways under a thumb.

        So: title and the small chips share the first line, the six navigation
        icons take the second. Wrapping rather than an `overflow-x-auto` strip,
        which would look tidier and clip the currency and language menus as
        they open downward out of it. Costs about 60px of sticky header on a
        phone; a proper mobile menu would buy that back, and is a design
        decision rather than a contrast fix.

        The row keeps its own width rather than the 5xl content column: the
        nine controls measure ~985px, which left the title a 15px box that its
        own text then overflowed, printing the journal name across the day
        counter. Wider row, and the nav keeps its second line up to `lg`.
      */}
      <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
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
          <p className="hidden truncate text-xs text-navy-600 sm:block">{tagline}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2 sm:gap-3">
          {children}
          <TripSwitcher />
          <CurrencySwitcher />
          <LocaleSwitcher />
        </div>
        <div className="flex w-full justify-end lg:w-auto">
          <SiteNav />
        </div>
      </div>
    </header>
  );
}
