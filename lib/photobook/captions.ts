/**
 * The line under a page in the preview, in the reader's own language — B562.
 *
 * The planner's page kinds ("photos", "colophon") and its layout names
 * ("full-bleed") were being printed under somebody's holiday, which answered
 * a question nobody had asked. What a reader wants to know is where the page
 * came from: a page from a day names the day, and a page that is only in the
 * book because an include-switch is on names that switch — which is the
 * fastest route to "I do not want this", with the switches one tap away.
 *
 * `BookPage.from` is what makes the second half honest. The alternative was a
 * kind → option table in here, and B517 is the record of what that costs: a
 * second copy of a decision made in `plan.ts` drifts from it the first time
 * the gating changes.
 *
 * Takes a translator rather than reaching for one, so this is testable
 * without a dictionary and so the composer's page and any other caller answer
 * in whatever language they were asked in.
 */

import type { TranslationKey } from "../i18n.ts";
import type { BookPage, BookPageOption, Photobook } from "./plan.ts";

const OPTION: Record<BookPageOption, TranslationKey> = {
  includeText: "photobook.caption.text",
  includeMap: "photobook.caption.map",
  includeChapters: "photobook.caption.chapters",
  includeCosts: "photobook.caption.costs",
};

const KIND: Partial<Record<BookPage["kind"], TranslationKey>> = {
  title: "photobook.caption.title",
  photos: "photobook.caption.photographs",
  followers: "photobook.caption.names",
  transport: "photobook.caption.transport",
  colophon: "photobook.caption.colophon",
  blank: "photobook.caption.blank",
};

export type Translate = (key: TranslationKey, vars?: Record<string, string>) => string;

export function captionsFor(book: Photobook, t: Translate): (page: BookPage) => string {
  // "Day 3" counted off the book's own order, which is chronological, rather
  // than off a second read of the trip: every page belonging to a day carries
  // its date (B534), and the first `day` page for a date carries the title as
  // the author wrote it. A book with the writing switched off has the dates
  // and no titles, and says "Day 3" alone rather than inventing one.
  const dates: string[] = [];
  const titles = new Map<string, string>();
  for (const volume of book.volumes) {
    for (const page of volume.pages) {
      const date = page.kind === "day" || page.kind === "photos" ? page.date : undefined;
      if (!date) continue;
      if (!dates.includes(date)) dates.push(date);
      if (page.kind === "day" && page.title && !titles.has(date)) titles.set(date, page.title);
    }
  }

  return (page) => {
    const date = page.kind === "day" || page.kind === "photos" ? page.date : undefined;
    if (date) {
      const n = String(dates.indexOf(date) + 1);
      const title = titles.get(date);
      return title ? t("photobook.caption.day", { n, title }) : t("photobook.caption.dayOnly", { n });
    }
    if (page.from) return t(OPTION[page.from]);
    return t(KIND[page.kind] ?? "photobook.caption.page");
  };
}
