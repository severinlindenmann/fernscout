import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import TripStory from "@/app/TripStory";
import CurrencyProvider from "@/components/CurrencyProvider";
import LocaleProvider from "@/components/LocaleProvider";
import SiteProvider from "@/components/SiteProvider";
import TripProvider from "@/components/TripProvider";
import TripListProvider from "@/components/TripListProvider";
import { buildStoryProps, STORY_WINDOW, storyWindow } from "@/lib/tripView";
import { clearUserCache } from "@/lib/users";
import { currencyOptions } from "@/lib/rates";
import { siteSummary } from "@/lib/site";
import { dictionaryFor } from "@/lib/locales";
import { getTrips } from "@/lib/trips";
import { makeScaleFixture, SCALE_PROSE } from "../scripts/make-scale-fixture.mjs";

// The header reads the current URL to mark the active nav item. There is no
// router here, only React, so it is told where it is.
vi.mock("next/navigation", () => ({
  usePathname: () => "/traveller",
  // The language switcher refreshes the route when the reader changes
  // language; there is no router here, only React.
  useRouter: () => ({ refresh: () => {} }),
}));

/**
 * The story page must not grow with the trip.
 *
 * Measured before this was fixed: 148 KB of HTML for 13 days, ~11.4 KB per
 * day, which is ~2 MB at 180 days — a reader downloading five months of
 * writing to see day one. The fix is `lib/tripView.ts`: every day travels as a
 * ~150-byte `DaySummary` for the navigation, and only a window of days travels
 * in full.
 *
 * These assertions are deliberately about *bytes* and *how many days are in
 * the tree*, not about implementation. Put a day's prose back into the client
 * tree by any route and the numbers move.
 */

const SHORT = 13;
const LONG = 200;

let tmp: string;
let previousContentDir: string | undefined;

/** Renders the story page's client tree the way a page would mount it. */
function render(ref: string, openAt?: string) {
  const props = buildStoryProps(ref, { openAt });
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
          <TripProvider trip={props.trip} isCurrent>
            {children}
          </TripProvider>
        </CurrencyProvider>
      </TripListProvider>
    </SiteProvider>
  );

  const markup = renderToStaticMarkup(
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

  // What a browser downloads is the markup plus the serialised props React
  // embeds alongside it to hydrate with. Both have to stay bounded, so both
  // are counted.
  const serialisedProps = JSON.stringify({
    index: props.index,
    days: props.days,
    windowStart: props.windowStart,
    initialDate: props.initialDate,
    stats: props.stats,
  });

  return {
    props,
    markup,
    bytes: Buffer.byteLength(markup) + Buffer.byteLength(serialisedProps),
  };
}

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-payload-"));
  makeScaleFixture(path.join(tmp, "short"), SHORT);
  makeScaleFixture(path.join(tmp, "long"), LONG);
  previousContentDir = process.env.CONTENT_DIR;
});

afterAll(() => {
  if (previousContentDir === undefined) delete process.env.CONTENT_DIR;
  else process.env.CONTENT_DIR = previousContentDir;
  clearUserCache();
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** Both fixtures live in their own content root, so switch and drop caches. */
function use(which: "short" | "long") {
  process.env.CONTENT_DIR = path.join(tmp, which);
  clearUserCache();
}

describe("story payload", () => {
  it("sends a window of full days, however long the trip is", () => {
    use("short");
    const short = buildStoryProps("traveller/scale");
    use("long");
    const long = buildStoryProps("traveller/scale");

    expect(short.index).toHaveLength(SHORT);
    expect(long.index).toHaveLength(LONG);

    // The window is the same size at 200 days as at 13 — this is the whole
    // mechanism, stated as an assertion.
    expect(long.days.length).toBe(2 * STORY_WINDOW + 1);
    // Both fixtures are entirely in the past, so both open on their last day
    // and the short one's window is clipped by the end of the trip. What
    // matters is that neither is anywhere near the length of its trip.
    expect(short.days.length).toBeLessThanOrEqual(2 * STORY_WINDOW + 1);
  });

  it("does not carry a day's writing until the reader is near it", () => {
    use("long");
    const { markup, props } = render("traveller/scale");

    // The window is centred on the last day that isn't in the future, so the
    // far end of a 200-day trip must be nowhere in the tree.
    const far = props.index[0];
    expect(props.days.some((d) => d.date === far.date)).toBe(false);
    expect(markup).not.toContain("Day 1 in Bangkok");

    // The prose appears once per rendered day at most — never 200 times.
    const occurrences = markup.split(SCALE_PROSE).length - 1;
    expect(occurrences).toBeLessThanOrEqual(props.days.length);
  });

  it("costs well under a kilobyte per extra day", () => {
    use("short");
    const short = render("traveller/scale");
    use("long");
    const long = render("traveller/scale");

    const perDay = (long.bytes - short.bytes) / (LONG - SHORT);

    // Measured before the fix: ~11'400 bytes per day. The remainder is the
    // day index itself — a list of days is irreducibly one entry per day —
    // and anything approaching a kilobyte means content has crept back in.
    expect(perDay).toBeLessThan(700);

    // And the absolute size at 200 days stays in the same league as 13 days,
    // rather than fifteen times it.
    expect(long.bytes).toBeLessThan(short.bytes * 3);
  });

  it("draws a bounded number of path nodes, not one per day", () => {
    use("long");
    const { markup } = render("traveller/scale");
    // Each node on the winding sidebar path carries the day's location in a
    // title attribute. At 200 days, drawing them all was ~120 KB of markup
    // for the dozen you can see.
    const nodes = (markup.match(/title="[^"]* — 20\d\d-\d\d-\d\d"/g) ?? []).length;
    expect(nodes).toBeGreaterThan(0);
    expect(nodes).toBeLessThan(60);
  });

  it("serves neighbours from the same source the page rendered from", () => {
    use("long");
    const window = storyWindow("traveller/scale", 100, 105);
    expect(window).toHaveLength(5);
    expect(window[0].lead.content).toContain("Twelve hours north");
    // Asking past the end of the trip is answered with what exists, not an
    // error — a reader paging is not an API client.
    expect(storyWindow("traveller/scale", 198, 210)).toHaveLength(2);
    expect(storyWindow("traveller/scale", -5, 2)).toHaveLength(2);
  });
});
