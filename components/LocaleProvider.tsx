"use client";

import { createContext, useContext, useMemo } from "react";
import { MotionConfig } from "motion/react";
import { translate, plural, monthNames, weekdayNames, type TranslationKey } from "@/lib/i18n";
import type { Entry, Locale, Trip } from "@/lib/types";

/** What `localizedTrip` needs — a full `Trip` satisfies this, but so does a
 * `TripSummary` (the header's trip switcher only has that for the other
 * trips in the list, and `TripSummary` deliberately omits `tagline`). */
type LocalizableTrip = Pick<Trip, "title" | "translations"> & Partial<Pick<Trip, "tagline">>;

type Ctx = {
  locale: string;
  t: (key: TranslationKey, vars?: Record<string, string>) => string;
  /** `t`, for a string that names a number of things. See `plural`. */
  tn: (key: TranslationKey, count: number, vars?: Record<string, string>) => string;
  formatLongDate: (date: string) => string;
  formatShortDate: (date: string) => string;
  formatStay: (nights: number) => string;
  /** Entry title/content in the active locale, falling back to the original. */
  localized: (entry: Entry) => { title: string; content: string };
  /** Trip title/tagline in the active locale, falling back to the original.
   * Takes just the fields it needs, not the full `Trip` — the header's trip
   * switcher only ever has a `TripSummary` (no `tagline`) on hand for the
   * other trips in the list. */
  localizedTrip: (trip: LocalizableTrip) => { title: string; tagline?: string };
};

const LocaleContext = createContext<Ctx | null>(null);

function parseUTC(date: string) {
  return new Date(`${date}T00:00:00Z`);
}

/**
 * The active language, and the strings for it.
 *
 * Both come from the server, because the locale is in the URL — which is the
 * whole point of putting it there. Before that, this rendered English on the
 * server and swapped after the first paint, so search engines only ever saw
 * English and no German page had an address of its own.
 *
 * The dictionary arrives already merged over English (see lib/locales.ts), so
 * nothing here has to know a fallback exists.
 */
export default function LocaleProvider({
  locale,
  dictionary,
  children,
}: {
  locale: string;
  dictionary: Record<string, string>;
  children: React.ReactNode;
}) {

  const value = useMemo<Ctx>(() => {
    const months = monthNames(locale);
    const weekdays = weekdayNames(locale);

    const formatLongDate = (date: string) => {
      const d = parseUTC(date);
      const day = d.getUTCDate();
      const month = months[d.getUTCMonth()];
      const weekday = weekdays[d.getUTCDay()];
      if (locale === "de") return `${weekday}, ${day}. ${month}`;
      if (locale === "hu") return `${month} ${day}., ${weekday}`;
      return `${weekday}, ${day} ${month}`;
    };

    const formatShortDate = (date: string) => {
      const d = parseUTC(date);
      const day = d.getUTCDate();
      const month = months[d.getUTCMonth()].slice(0, 3);
      if (locale === "de") return `${day}. ${month}`;
      if (locale === "hu") return `${month} ${day}.`;
      return `${day} ${month}`;
    };

    const t = (key: TranslationKey, vars?: Record<string, string>) =>
      translate(dictionary, key, vars);

    const tn = (key: TranslationKey, count: number, vars?: Record<string, string>) =>
      plural(dictionary, key, count, vars);

    const formatStay = (nights: number) => {
      if (nights <= 0) return t("stay.sameDay");
      return `${nights} ${nights === 1 ? t("stay.night") : t("stay.nights")}`;
    };

    const localized = (entry: Entry) => {
      if (locale === "en") return { title: entry.title, content: entry.content };
      const tr = entry.translations?.[locale];
      return {
        title: tr?.title ?? entry.title,
        content: tr?.content ?? entry.content,
      };
    };

    const localizedTrip = (trip: LocalizableTrip) => {
      if (locale === "en") return { title: trip.title, tagline: trip.tagline };
      const tr = trip.translations?.[locale];
      return { title: tr?.title ?? trip.title, tagline: tr?.tagline ?? trip.tagline };
    };

    return {
      locale,
      t,
      tn,
      formatLongDate,
      formatShortDate,
      formatStay,
      localized,
      localizedTrip,
    };
  }, [locale, dictionary]);

  // `reducedMotion="user"` is the whole of this project's answer to somebody
  // who has asked their system for less movement. Motion does not read that
  // setting on its own — without this, every `whileInView` and every page
  // transition ran regardless, and there is a lot of movement here. With it,
  // transform and layout animations resolve straight to their end state,
  // which is why the charts animate a transform rather than a size: the end
  // state of a scale is the bar at its real length, and the end state of a
  // width was a bar that had never been given one.
  return (
    <MotionConfig reducedMotion="user">
      <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
    </MotionConfig>
  );
}

export function useI18n(): Ctx {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useI18n must be used inside LocaleProvider");
  return ctx;
}
