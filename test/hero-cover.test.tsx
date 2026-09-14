import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({
  usePathname: () => "/alex",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));

import TripStory from "@/app/TripStory";
import CurrencyProvider from "@/components/CurrencyProvider";
import LocaleProvider from "@/components/LocaleProvider";
import SiteProvider from "@/components/SiteProvider";
import TripListProvider from "@/components/TripListProvider";
import TripProvider from "@/components/TripProvider";
import { clearConfigCache } from "@/lib/config";
import { forgetEntries, getAllMedia } from "@/lib/entries";
import { dictionaryFor } from "@/lib/locales";
import { currencyOptions } from "@/lib/rates";
import { siteSummary } from "@/lib/site";
import { buildStoryProps } from "@/lib/tripView";
import { getTrip, getTrips } from "@/lib/trips";
import { clearUserCache } from "@/lib/users";
import { writeDayFixture, writeTripFixture } from "./fixtures/content";

/**
 * B1740 — which picture each surface shows.
 *
 * The owner saw a photograph on every card at `/<user>/trips` and none at all
 * on `/<user>/trips/<id>`, because the two read different things and the trip
 * page read neither `trip.cover` nor the freshest photograph: it took the
 * *first* image of the landing day and nothing else.
 *
 * The two precedences are deliberately opposite, so both are pinned here:
 *
 * - the hero follows the day — its **last** picture, which on a trip in
 *   progress is the one just taken — and falls back to `trip.cover` only when
 *   the landing day has no photograph at all;
 * - a card prefers `trip.cover` and falls back to the trip's last picture.
 */

const USER = "alex";
const TRIP = "cover-2026";
const REF = `${USER}/${TRIP}`;
let dir: string;

function media(slug: string, file: string): string {
  const abs = path.join(dir, USER, "trips", TRIP, "media", slug);
  fs.mkdirSync(abs, { recursive: true });
  // A JPEG's first four bytes, which is all anything reading these looks at.
  fs.writeFileSync(path.join(abs, file), Buffer.from([0xff, 0xd8, 0xff, 0xdb]));
  return `/media/${TRIP}/${slug}/${file}`;
}

/** Days in the past, so `getDefaultDay` lands on the last of them — the same
 * day it lands on for a trip in progress, which is why the hero needs no
 * status branch to show "today's newest picture". */
function buildTrip(options: { cover?: string; lastDayHasPhotos: boolean }) {
  writeTripFixture(USER, {
    id: TRIP,
    title: "Cover",
    start: "2026-06-01",
    end: "2026-06-03",
    status: "past",
    visibility: "public",
    cover: options.cover,
  });
  writeDayFixture(dir, USER, TRIP, {
    slug: "arrival",
    date: "2026-06-01",
    title: "Arrival",
    location: "Bangkok",
    country: "Thailand",
    media: [{ src: media("arrival", "01.jpg") }, { src: media("arrival", "02.jpg") }],
  });
  writeDayFixture(dir, USER, TRIP, {
    slug: "market",
    date: "2026-06-02",
    title: "Market",
    location: "Bangkok",
    country: "Thailand",
    media: options.lastDayHasPhotos
      ? [{ src: media("market", "03.jpg") }, { src: media("market", "04.jpg") }]
      : [],
  });
  forgetEntries(REF);
}

function renderStory(): string {
  const props = buildStoryProps(REF);
  const site = siteSummary(USER, true);
  if (!site) throw new Error("no site");
  const trip = getTrip(REF);
  if (!trip) throw new Error("no trip");
  const trips = getTrips(USER).map((t) => ({
    id: t.id,
    ref: t.ref,
    username: t.username,
    title: t.title,
    start: t.start,
    end: t.end,
    status: t.status,
    translations: t.translations,
  }));
  return renderToStaticMarkup(
    <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
      <SiteProvider value={site}>
        <TripListProvider trips={trips}>
          <CurrencyProvider options={currencyOptions(USER)}>
            <TripProvider trip={trip} isCurrent={false}>
              <TripStory
                index={props.index}
                days={props.days}
                windowStart={props.windowStart}
                initialDate={props.initialDate}
                stats={props.stats}
              />
            </TripProvider>
          </CurrencyProvider>
        </TripListProvider>
      </SiteProvider>
    </LocaleProvider>,
  );
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-hero-cover-"));
  process.env.CONTENT_DIR = dir;
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({ site: { name: "T", url: "https://t.test" }, features: {} }),
  );
  fs.mkdirSync(path.join(dir, USER), { recursive: true });
  fs.writeFileSync(
    path.join(dir, USER, "config.json"),
    JSON.stringify({
      title: "Alex",
      tagline: "t",
      owner: { name: "A B", nickname: "A" },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
    }),
  );
  clearConfigCache();
  clearUserCache();
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  forgetEntries(REF);
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("the trip page's hero", () => {
  test("shows the landing day's last picture, not its first", () => {
    buildTrip({ lastDayHasPhotos: true });
    const html = renderStory();
    expect(html).toContain("04.jpg");
    expect(html).not.toContain("03.jpg");
  });

  test("still follows the day when a cover is set — a cover must not freeze the hero mid-trip", () => {
    buildTrip({ lastDayHasPhotos: true, cover: `/media/${TRIP}/arrival/01.jpg` });
    const html = renderStory();
    expect(html).toContain("04.jpg");
    expect(html).not.toContain("01.jpg");
  });

  test("falls back to the cover when the landing day has no photograph", () => {
    buildTrip({ lastDayHasPhotos: false, cover: `/media/${TRIP}/arrival/01.jpg` });
    expect(renderStory()).toContain("01.jpg");
  });
});

describe("the trips index card", () => {
  /** The card resolves `trip.cover ?? <the trip's last picture>`, and the
   * second half is this ordering: `getAllMedia` is newest first, so the
   * trip's last picture is its first image-typed item. */
  test("the trip's last picture is the first image getAllMedia hands back", () => {
    buildTrip({ lastDayHasPhotos: true });
    expect(getAllMedia(REF).find((m) => m.type === "image")?.src).toBe(
      `/${USER}/media/${TRIP}/market/04.jpg`,
    );
  });

  test("a photograph this reader may not see is not offered as a card's picture", () => {
    writeTripFixture(USER, {
      id: TRIP,
      title: "Cover",
      start: "2026-06-01",
      end: "2026-06-03",
      status: "past",
      visibility: "public",
    });
    writeDayFixture(dir, USER, TRIP, {
      slug: "arrival",
      date: "2026-06-01",
      title: "Arrival",
      location: "Bangkok",
      country: "Thailand",
      media: [
        { src: media("arrival", "01.jpg") },
        { src: media("arrival", "02.jpg"), visibility: "private" },
      ],
    });
    forgetEntries(REF);
    expect(getAllMedia(REF).find((m) => m.type === "image")?.src).toBe(
      `/${USER}/media/${TRIP}/arrival/01.jpg`,
    );
  });
});
