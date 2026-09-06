import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";

/**
 * What `/<user>/trips` sends a reader who may not open a teasered trip — B587.
 *
 * The page's props rather than its markup, because the promise is about the
 * *payload*: a locked card carries a title and two dates, and a cover, a
 * tagline, a day count or a route in that object would be a leak whatever the
 * component chose to render. Modelled on `test/unlisted-owner-trip.test.tsx`,
 * with `listableTrips` stubbed to the one rule this fixture is about — a
 * closed trip is not listed to this reader.
 */

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-teaser-page-"));
  process.env.CONTENT_DIR = dir;
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({ site: { name: "T", url: "https://t.test", defaultUser: "alex" }, features: {} }),
  );
  fs.mkdirSync(path.join(dir, "alex", "trips", "closed-2026", "entries"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "alex", "config.json"),
    JSON.stringify({ title: "Alex", owner: { name: "A B", nickname: "A", email: "a@t.test" } }),
  );
  // Two days: one published, one draft, both in Portugal. The draft must not
  // reach the map either — see the assertions below.
  fs.writeFileSync(
    path.join(dir, "alex", "trips", "closed-2026", "entries", "2026-01-02-faro.md"),
    ["---", 'title: "Faro"', 'date: "2026-01-02"', 'location: "Faro"', 'country: "Portugal"',
      'countryCode: "PT"', "lat: 37.0194", "lng: -7.9304", 'status: "published"', "---", "",
      "Ankunft.", ""].join("\n"),
  );
  fs.writeFileSync(
    path.join(dir, "alex", "trips", "closed-2026", "entries", "2026-01-03-lagos.md"),
    ["---", 'title: "Lagos"', 'date: "2026-01-03"', 'location: "Lagos"', 'country: "Spain"',
      'countryCode: "ES"', "lat: 37.1028", "lng: -8.6742", 'status: "draft"', "---", "",
      "Ein Entwurf.", ""].join("\n"),
  );
  fs.writeFileSync(
    path.join(dir, "alex", "trips", "closed-2026", "trip.md"),
    ["---", 'id: "closed-2026"', 'title: "Quiet"', 'tagline: "A fortnight"', 'cover: "cover.jpg"',
      'start: "2026-01-01"', 'end: "2026-01-05"', 'status: "past"', 'visibility: "private"',
      "teaser: true", "---", "", "Intro.", ""].join("\n"),
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

async function pageProps() {
  vi.resetModules();
  vi.doMock("@/lib/contacts/session", () => ({ isOwner: async () => false }));
  vi.doMock("@/lib/tripGate", () => ({
    // Nobody's trip is listed to this reader — the state a teaser is for.
    listableTrips: async () => [],
    draftsVisibleTo: async () => ({ visible: false, canPublish: false }),
    signedInAs: async () => null,
  }));
  const { default: TripsPage } = await import("@/app/[user]/trips/page");
  const element = (await TripsPage({
    params: Promise.resolve({ user: "alex" }),
    searchParams: Promise.resolve({}),
  } as never)) as { props: Record<string, unknown> };
  return element.props;
}

describe("a reader who may not open a teasered trip", () => {
  test("gets a locked card with the title and the dates and nothing else", async () => {
    const props = (await pageProps()) as { locked: unknown[]; trips: unknown[] };
    expect(props.trips).toEqual([]);
    expect(props.locked).toEqual([
      { id: "closed-2026", title: "Quiet", start: "2026-01-01", end: "2026-01-05" },
    ]);
  });

  test("and is not told the journal is empty, because it is not", async () => {
    const props = (await pageProps()) as { empty: unknown; routes: unknown[] };
    expect(props.empty).toBeNull();
    // No route, no stops, no coordinates — B600 draws countries and nothing
    // else, and the route list is where a stop would have travelled.
    expect(props.routes).toEqual([]);
  });

  test("fills the countries its published days reached, and only those", async () => {
    const props = (await pageProps()) as {
      visits: { code: string; name: string; trips: { id: string; title: string }[] }[];
      lifetime: { countries: number; days: number; photos: number; trips: number };
    };
    // Portugal from the published day. Not Spain: that day is a draft, and a
    // draft on a closed trip is doubly not this reader's.
    expect(props.visits.map((v) => v.code)).toEqual(["PT"]);
    expect(props.visits[0].trips).toEqual([{ id: "closed-2026", title: "Quiet" }]);
    // And it counts towards none of the four figures, which are about what
    // this reader may actually read.
    expect(props.lifetime).toEqual({ countries: 0, days: 0, photos: 0, trips: 0 });
  });

  test("puts no stop, coordinate or place name of the trip in the payload", async () => {
    const props = await pageProps();
    // The whole props object, not one field: the promise is about what leaves
    // the server, and a stop that reached the map through the frame, the
    // basemap or a legend would show up here.
    const sent = JSON.stringify(props);
    for (const secret of ["37.0194", "-7.9304", "Faro", "Lagos", "Spain"]) {
      expect(sent, `${secret} reached a reader who may not open the trip`).not.toContain(secret);
    }
    // And the map is drawn all the same — the country fill needs a basemap.
    expect((props as { basemap: unknown }).basemap).not.toBeNull();
  });
});
