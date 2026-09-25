import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import TripStory from "@/app/TripStory";
import CurrencyProvider from "@/components/CurrencyProvider";
import LatestDayButton from "@/components/LatestDayButton";
import LocaleProvider from "@/components/LocaleProvider";
import SiteProvider from "@/components/SiteProvider";
import TripListProvider from "@/components/TripListProvider";
import TripProvider from "@/components/TripProvider";
import { clearConfigCache } from "@/lib/config";
import { dictionaryFor } from "@/lib/locales";
import { currencyOptions } from "@/lib/rates";
import { siteSummary } from "@/lib/site";
import { buildStoryProps } from "@/lib/tripView";
import { getTrips } from "@/lib/trips";
import { clearUserCache } from "@/lib/users";
import type { Trip } from "@/lib/types";

/**
 * The control that jumps back to the day the story opens at.
 *
 * `getDefaultDay` lands a finished trip on its **last** day, so the jump
 * always worked — it was the word on it that was wrong. A reader browsing the
 * 2024 Alps trip was offered "Today" and arrived in September 2024 (B12).
 *
 * Three places render it — the desktop day bar, the trip hero, and the mobile
 * sheet — which is why the last test here is about the source rather than the
 * markup: the mobile sheet's copy is behind a tap, so no server render can
 * reach it, and a fix that lands in two of three places is the shape this bug
 * already had.
 */

vi.mock("next/navigation", () => ({
  usePathname: () => "/example",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

/** A trip that ended in 2024, and is `status: past` in the shipped demo. */
const PAST = "example/alps-2024";

let previousContentDir: string | undefined;

beforeAll(() => {
  previousContentDir = process.env.CONTENT_DIR;
});

afterAll(() => {
  if (previousContentDir === undefined) delete process.env.CONTENT_DIR;
  else process.env.CONTENT_DIR = previousContentDir;
  clearConfigCache();
  clearUserCache();
});

beforeEach(() => {
  process.env.CONTENT_DIR = path.join(process.cwd(), "content");
  clearConfigCache();
  clearUserCache();
});

/**
 * The story page's client tree, the way a page mounts it.
 *
 * `override` is applied to the trip the providers carry, and to nothing else:
 * `isOver` reads only `status` and `end`, so the same real trip can be asked
 * both questions without a second fixture — and without a test that starts
 * failing on the day a demo trip's end date goes past.
 */
function render(ref: string, override: Partial<Trip> = {}) {
  const props = buildStoryProps(ref);
  const username = props.trip.username;
  const site = siteSummary(username, true);
  if (!site) throw new Error("no site");

  const trips = getTrips(username).map((t) => ({
    id: t.id,
    ref: t.ref,
    username: t.username,
    title: t.title,
    start: t.start,
    end: t.end,
    status: t.status,
    translations: t.translations,
  }));

  const wrap = (children: ReactNode) => (
    <SiteProvider value={site}>
      <TripListProvider trips={trips}>
        <CurrencyProvider options={currencyOptions(username)}>
          <TripProvider trip={{ ...props.trip, ...override }} isCurrent>
            {children}
          </TripProvider>
        </CurrencyProvider>
      </TripListProvider>
    </SiteProvider>
  );

  return renderToStaticMarkup(
    <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
      {wrap(
        <TripStory
          index={props.index}
          days={props.days}
          windowStart={props.windowStart}
          initialDate={props.initialDate}
          openAtDate={props.openAtDate}
          stats={props.stats}
        />,
      )}
    </LocaleProvider>,
  );
}

const count = (html: string, needle: string) => html.split(needle).length - 1;

function button(tripOver: boolean, locale: string) {
  return renderToStaticMarkup(
    <LocaleProvider locale={locale} dictionary={dictionaryFor(locale)}>
      <LatestDayButton tripOver={tripOver} onClick={() => {}} className="x" />
    </LocaleProvider>,
  );
}

describe("the jump-to-latest-day button", () => {
  test("a running trip is still offered Today", () => {
    expect(button(false, "en")).toContain("Today");
    expect(button(false, "de")).toContain("Heute");
    expect(button(false, "hu")).toContain("Ma");
  });

  test("a finished trip names the last day instead, in every shipped locale", () => {
    expect(button(true, "en")).toContain("Last day");
    expect(button(true, "de")).toContain("Letzter Tag");
    expect(button(true, "hu")).toContain("Utolsó nap");

    // The word the bug was: never on a trip that is over.
    expect(button(true, "en")).not.toContain("Today");
    expect(button(true, "de")).not.toContain("Heute");
  });

  test("the jump target is unchanged — this renames a control, it does not hide one", () => {
    // Both variants render a button. Somebody on day 3 of a finished trip
    // still needs the way back to where it ended.
    expect(button(true, "en")).toContain("<button");
    expect(button(false, "en")).toContain("<button");
  });
});

describe("the story page for a trip that is over", () => {
  test("neither the hero nor the day bar says Today", () => {
    const html = render(PAST);
    // The hero always renders it; the day bar renders it because the story
    // opens on the overview, which is not the day the trip ended on.
    expect(count(html, 'data-jump="last-day"')).toBe(2);
    expect(count(html, 'data-jump="today"')).toBe(0);
    expect(html).toContain("Last day");
  });

  test("the same page, with the trip still running, is unchanged", () => {
    const html = render(PAST, { status: "current", end: "2099-01-01" });
    expect(count(html, 'data-jump="today"')).toBe(2);
    expect(count(html, 'data-jump="last-day"')).toBe(0);
  });
});

describe("no call site rolls its own", () => {
  // The mobile sheet's copy of this button only exists once the sheet is
  // tapped open, so it is out of reach of a server render. What can be
  // checked is that there is nothing left for it to get wrong.
  const sites = [
    "app/TripStory.tsx",
    "components/MobileDaySheet.tsx",
    "components/TripHero.tsx",
  ];

  test.each(sites)("%s renders the shared button", (file) => {
    const src = fs.readFileSync(path.join(process.cwd(), file), "utf8");
    expect(src).toContain("<LatestDayButton");
    expect(src).not.toContain('t("day.today")');
    expect(src).not.toContain('t("day.lastDay")');
  });
});
