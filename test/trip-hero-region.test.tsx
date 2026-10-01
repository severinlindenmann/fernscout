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
import { dictionaryFor } from "@/lib/locales";
import { currencyOptions } from "@/lib/rates";
import { siteSummary } from "@/lib/site";
import { buildStoryProps } from "@/lib/tripView";
import { createTrip } from "@/lib/tripWrite";
import { getTrips } from "@/lib/trips";
import { clearUserCache } from "@/lib/users";
import { writeDayFixture, writeTripFixture } from "./fixtures/content";

/**
 * B2640 — "Zeit pro Land" showed the stored free-text country ("Spanien") in
 * every UI language, and a trip that never left one country said nothing
 * useful at all. Two separate fixes, each with its own test below:
 *
 * - the country name is now the reader's own locale's name for the code
 *   (`countryNameFor`), never the owner's raw spelling;
 * - a one-country trip with at least two named regions swaps the whole card
 *   for "Zeit pro Kanton" (etc.) and a region-by-region list.
 */

let dir: string;

function siteConfig(locale: string) {
  return JSON.stringify({
    title: "Alex",
    tagline: "t",
    owner: { name: "A B", nickname: "A" },
    defaultLocale: locale,
    locales: [locale],
    baseCurrency: "CHF",
  });
}

function render(ref: string, locale: string, username: string) {
  const props = buildStoryProps(ref);
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

  return renderToStaticMarkup(
    <LocaleProvider locale={locale} dictionary={dictionaryFor(locale)}>
      <SiteProvider value={site}>
        <TripListProvider trips={trips}>
          <CurrencyProvider options={currencyOptions(username)}>
            <TripProvider trip={props.trip} isCurrent>
              <TripStory
                index={props.index}
                days={props.days}
                windowStart={props.windowStart}
                initialDate={props.initialDate}
                openAtDate={props.openAtDate}
                stats={props.stats}
              />
            </TripProvider>
          </CurrencyProvider>
        </TripListProvider>
      </SiteProvider>
    </LocaleProvider>,
  );
}

describe("time per country — localized names (B2640)", () => {
  const username = "alex";
  const ref = `${username}/europe-2026`;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-hero-countries-"));
    process.env.CONTENT_DIR = dir;
    fs.writeFileSync(
      path.join(dir, "config.json"),
      JSON.stringify({ site: { name: "T", url: "https://t.test" }, features: {} }),
    );
    fs.mkdirSync(path.join(dir, username), { recursive: true });
    fs.writeFileSync(path.join(dir, username, "config.json"), siteConfig("de"));
    clearConfigCache();
    clearUserCache();

    const made = createTrip(username, {
      id: "europe-2026",
      title: "Europe",
      start: "2026-06-01",
      end: "2026-06-10",
      status: "current",
      visibility: "public",
    });
    if (!made.ok) throw new Error(`could not create the trip: ${made.message}`);

    writeDayFixture(dir, username, "europe-2026", {
      slug: "stockholm",
      date: "2026-06-02",
      location: "Stockholm",
      country: "Sweden",
      countryCode: "SE",
    });
    writeDayFixture(dir, username, "europe-2026", {
      slug: "madrid",
      date: "2026-06-03",
      location: "Madrid",
      country: "Spain",
      countryCode: "ES",
    });
  });

  afterEach(() => {
    delete process.env.CONTENT_DIR;
    clearConfigCache();
    clearUserCache();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("a German reader sees Schweden/Spanien, never the stored English spelling", () => {
    const html = render(ref, "de", username);
    expect(html).toContain("Schweden");
    expect(html).toContain("Spanien");
    expect(html).not.toContain("Sweden");
    expect(html).not.toContain(">Spain<");
  });
});

describe("time per region — a one-country trip with named regions (B2640)", () => {
  const username = "alex";
  const ref = `${username}/switzerland-2026`;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-hero-regions-"));
    process.env.CONTENT_DIR = dir;
    fs.writeFileSync(
      path.join(dir, "config.json"),
      JSON.stringify({ site: { name: "T", url: "https://t.test" }, features: {} }),
    );
    fs.mkdirSync(path.join(dir, username), { recursive: true });
    fs.writeFileSync(path.join(dir, username, "config.json"), siteConfig("de"));
    clearConfigCache();
    clearUserCache();

    const made = createTrip(username, {
      id: "switzerland-2026",
      title: "Switzerland",
      start: "2026-06-01",
      end: "2026-06-10",
      status: "current",
      visibility: "public",
    });
    if (!made.ok) throw new Error(`could not create the trip: ${made.message}`);

    writeDayFixture(dir, username, "switzerland-2026", {
      slug: "zurich",
      date: "2026-06-02",
      location: "Zürich",
      country: "Switzerland",
      countryCode: "CH",
      region: "Zürich",
    });
    writeDayFixture(dir, username, "switzerland-2026", {
      slug: "lucerne",
      date: "2026-06-03",
      location: "Luzern",
      country: "Switzerland",
      countryCode: "CH",
      region: "Luzern",
    });
  });

  afterEach(() => {
    delete process.env.CONTENT_DIR;
    clearConfigCache();
    clearUserCache();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("shows the local word (Kanton) and both region rows, not the one-country sentence", () => {
    const html = render(ref, "de", username);
    expect(html).toContain("Zeit pro Kanton");
    expect(html).toContain("Zürich");
    expect(html).toContain("Luzern");
    // Not the single-country sentence this card would otherwise draw.
    expect(html).not.toContain("Zeit pro Land");
  });
});

describe("time per country — a single country with no named regions (unchanged, B2308/B2640)", () => {
  const username = "alex";
  const ref = `${username}/japan-2026`;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-hero-one-country-"));
    process.env.CONTENT_DIR = dir;
    fs.writeFileSync(
      path.join(dir, "config.json"),
      JSON.stringify({ site: { name: "T", url: "https://t.test" }, features: {} }),
    );
    fs.mkdirSync(path.join(dir, username), { recursive: true });
    fs.writeFileSync(path.join(dir, username, "config.json"), siteConfig("en"));
    clearConfigCache();
    clearUserCache();

    const made = createTrip(username, {
      id: "japan-2026",
      title: "Japan",
      start: "2026-06-01",
      end: "2026-06-10",
      status: "current",
      visibility: "public",
    });
    if (!made.ok) throw new Error(`could not create the trip: ${made.message}`);

    writeDayFixture(dir, username, "japan-2026", {
      slug: "tokyo",
      date: "2026-06-02",
      location: "Tokyo",
      country: "Japan",
      countryCode: "JP",
    });
  });

  afterEach(() => {
    delete process.env.CONTENT_DIR;
    clearConfigCache();
    clearUserCache();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("keeps the plain one-line sentence — no region card with fewer than two regions", () => {
    const html = render(ref, "en", username);
    expect(html).toContain("Time per country");
    expect(html).toContain("Japan");
    expect(html).not.toContain("Time per region");
  });
});
