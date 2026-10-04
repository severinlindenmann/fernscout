import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { resolveServerTree } from "./support/serverTree";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { writeDayFixture, writeTripFixture } from "./fixtures/content";
import TripsIndexContent from "@/app/at/[user]/trips/TripsIndexContent";
import LocaleProvider from "@/components/LocaleProvider";
import SiteProvider from "@/components/SiteProvider";
import CurrencyProvider from "@/components/CurrencyProvider";
import TripListProvider from "@/components/TripListProvider";
import { dictionaryFor } from "@/lib/locales";
import { mergeEntriesIntoPast, type VisitedCardData } from "@/lib/visitedCards";
import type { SiteSummary } from "@/lib/site";

/**
 * B2914 — countries visited without a trip, on the trips page. What the page
 * hands its client component for each kind of reader: entries counted once and
 * merged with a trip's country, continent counts, the Past order, and — the
 * guard rail — that a stranger who may see no entry is given exactly the page
 * a journal with no entries gives. `listableTrips` is stubbed to pass trips
 * through (its own table lives in access-gate.test.ts); the reader is the
 * cookie-derived `isOwner`/`journalReader` pair `visitReader` reads.
 */

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/@test-trips/trips",
  useRouter: () => ({ push: () => {}, replace: () => {}, refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => ({ get: () => null }),
}));

const USER = "test-trips";
let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-trips-visited-"));
  process.env.CONTENT_DIR = dir;
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({ site: { name: "T", url: "https://t.test", defaultUser: USER }, features: {} }),
  );
  fs.mkdirSync(path.join(dir, USER), { recursive: true });
  fs.writeFileSync(
    path.join(dir, USER, "config.json"),
    JSON.stringify({ title: "Alex", owner: { name: "A B", nickname: "A", email: "a@t.test" } }),
  );
  clearConfigCache();
  clearUserCache();
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
  vi.resetModules();
});

type Viewer = "owner" | "guest" | "stranger";
type Props = {
  empty: unknown;
  owner: boolean;
  trips: { id: string; start: string }[];
  visits: { code: string; trips: unknown[]; entry?: VisitedCardData }[];
  continents: { continent: string; count: number }[];
  lifetime: { countries: number; days: number; photos: number; trips: number };
  countryChoices?: unknown;
};

async function pageProps(viewer: Viewer): Promise<Props> {
  vi.resetModules();
  vi.doMock("@/lib/contacts/session", () => ({
    isOwner: async () => viewer === "owner",
    journalReader: async () => ({ guest: viewer === "guest", close: false }),
  }));
  vi.doMock("@/lib/tripGate", () => ({
    listableTrips: async (t: unknown[]) => t,
    readFor: async () => ({ read: undefined }),
    signedInAs: async () => null,
  }));
  const { default: TripsPage } = await import("@/app/at/[user]/trips/page");
  const element = (await resolveServerTree(
    await TripsPage({ params: Promise.resolve({ user: USER }), searchParams: Promise.resolve({}) } as never),
  )) as { props: Props };
  return element.props;
}

async function addEntry(input: { country: string; visibility?: "private" | "guest" | "public"; year?: number; month?: number }) {
  const { addVisit } = await import("@/lib/visited");
  addVisit(USER, input);
}

function tripThrough(id: string, start: string, end: string, country: { name: string; code: string }) {
  writeTripFixture(USER, { id, title: id, start, end, status: "past", visibility: "public" });
  writeDayFixture(dir, USER, id, {
    slug: "a-day",
    date: start,
    country: country.name,
    countryCode: country.code,
    coordinates: { lat: 60, lng: 10 },
  });
}

const site = {
  username: USER,
  title: "Alex",
  tagline: "t",
  url: "https://example.test",
  startLocation: "X",
  baseCurrency: "CHF",
  locales: ["en"],
  base: `/@${USER}`,
  canSignIn: true,
  signedIn: false,
} as unknown as SiteSummary;

function html(props: Props): string {
  return renderToStaticMarkup(
    <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
      <SiteProvider value={site}>
        <CurrencyProvider options={{ base: "CHF", currencies: ["CHF"], rates: { CHF: 1 } }}>
          <TripListProvider trips={[]}>
            <TripsIndexContent {...(props as unknown as React.ComponentProps<typeof TripsIndexContent>)} codeMinutes="30" />
          </TripListProvider>
        </CurrencyProvider>
      </SiteProvider>
    </LocaleProvider>,
  );
}

describe("a stranger who can see no entry", () => {
  test("gets byte for byte the page a journal with no entries gets", async () => {
    // No trips; one Private and one Guests entry.
    await addEntry({ country: "GR", visibility: "private" });
    await addEntry({ country: "NO" });
    const withHidden = await pageProps("stranger");

    fs.rmSync(path.join(dir, USER, "visited"), { recursive: true });
    const withNone = await pageProps("stranger");

    expect(JSON.stringify(withHidden)).toBe(JSON.stringify(withNone));
    expect(html(withHidden)).toBe(html(withNone));
    // And it is the empty state, not a map.
    expect(withHidden.empty).toEqual({ owner: false, signedIn: false, ownerName: "A" });
    expect(withHidden.visits).toEqual([]);
  });

  test("with hidden entries beside a trip sees the same lifetime figures and map as without them", async () => {
    tripThrough("fjords", "2020-06-01", "2020-06-05", { name: "Norway", code: "NO" });
    const without = await pageProps("stranger");
    await addEntry({ country: "GR", visibility: "private" });
    await addEntry({ country: "IT" });
    const hidden = await pageProps("stranger");
    expect(JSON.stringify(hidden)).toBe(JSON.stringify(without));
  });

  test("with one Public entry and no trips gets the map and its card, not the empty state", async () => {
    await addEntry({ country: "GR", visibility: "public" });
    await addEntry({ country: "NO", visibility: "private" });
    const props = await pageProps("stranger");
    expect(props.empty).toBeNull();
    expect(props.visits.map((v) => v.code)).toEqual(["GR"]);
    expect(props.visits[0].entry?.name).toBe("Greece");
    expect(props.lifetime.countries).toBe(1);
    const page = html(props);
    expect(page).toContain("Greece");
    expect(page).toContain("Without a trip");
    expect(page).not.toContain("Norway");
  });

  test("is never given the owner controls", async () => {
    await addEntry({ country: "GR", visibility: "public" });
    const props = await pageProps("stranger");
    expect(props.owner).toBe(false);
    expect(props.countryChoices).toBeUndefined();
    expect(props.visits[0].entry).not.toHaveProperty("visibility");
    expect(html(props)).not.toContain("Add a country");
  });
});

describe("the owner", () => {
  test("sees every entry and the Add button, on a journal with no trips", async () => {
    await addEntry({ country: "GR", visibility: "private" });
    const props = await pageProps("owner");
    expect(props.empty).toBeNull();
    expect(props.owner).toBe(true);
    expect(props.countryChoices).toBeDefined();
    expect(props.visits[0].entry?.visibility).toBe("private");
    expect(html(props)).toContain("Add a country");
  });

  test("an empty journal offers Add a country beside the new-trip link", async () => {
    const props = await pageProps("owner");
    expect(props.empty).toEqual({ owner: true });
    expect(html(props)).toContain("Add a country");
  });
});

describe("a guest", () => {
  test("sees a Guests entry and not a Private one", async () => {
    await addEntry({ country: "GR" });
    await addEntry({ country: "NO", visibility: "private" });
    const props = await pageProps("guest");
    expect(props.visits.map((v) => v.code)).toEqual(["GR"]);
    expect(props.owner).toBe(false);
  });
});

describe("entries and trips together", () => {
  test("a country with a trip and an entry counts once; continent counts include entries", async () => {
    tripThrough("fjords", "2020-06-01", "2020-06-05", { name: "Norway", code: "NO" });
    await addEntry({ country: "NO", visibility: "public" });
    const one = await pageProps("owner");
    expect(one.lifetime.countries).toBe(1);
    expect(one.visits).toHaveLength(1);
    expect(one.visits[0].trips).toHaveLength(1);
    expect(one.visits[0].entry?.code).toBe("NO");

    await addEntry({ country: "GR" });
    await addEntry({ country: "JP" });
    const three = await pageProps("owner");
    expect(three.lifetime.countries).toBe(3);
    expect(three.lifetime.trips).toBe(1);
    expect(three.lifetime.days).toBe(one.lifetime.days);
    expect(three.lifetime.photos).toBe(one.lifetime.photos);
    expect(three.visits.map((v) => v.code).sort()).toEqual(["GR", "JP", "NO"]);
    expect(three.continents.find((c) => c.continent === "Europe")?.count).toBe(2);
    expect(three.continents.find((c) => c.continent === "Asia")?.count).toBe(1);
  });
});

describe("the Past order", () => {
  const trip = (start: string) => ({ start });
  const entry = (code: string, year?: number, month?: number): VisitedCardData => ({ code, name: code, year, month });

  test("an entry sits among the trips by its date; undated entries are last", () => {
    const merged = mergeEntriesIntoPast(
      [trip("2012-05-01"), trip("2010-03-01")],
      [entry("UNDATED"), entry("A2011", 2011, 7), entry("A2013", 2013), entry("A2009", 2009)],
    );
    expect(merged.map((i) => (i.kind === "trip" ? i.trip.start : i.entry.code))).toEqual([
      "A2013",
      "2012-05-01",
      "A2011",
      "2010-03-01",
      "A2009",
      "UNDATED",
    ]);
  });

  test("a journal of entries alone keeps them newest first with undated last", () => {
    const merged = mergeEntriesIntoPast<{ start: string }>([], [entry("X"), entry("Y", 2001), entry("Z", 2005, 2)]);
    expect(merged.map((i) => (i.kind === "entry" ? i.entry.code : ""))).toEqual(["Z", "Y", "X"]);
  });
});
