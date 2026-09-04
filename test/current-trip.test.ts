import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The gate reads the guest cookie through `next/headers`, which throws outside
// a real request scope. An empty jar is the case that matters: a stranger with
// the URL, which is who a brand-new journal's own owner looks like here.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { currentTripOrRedirect } from "@/lib/currentTrip";
import Home from "@/app/[user]/(trip)/page";
import GalleryPage from "@/app/[user]/(trip)/gallery/page";
import MapPage from "@/app/[user]/(trip)/map/page";
import CostsPage from "@/app/[user]/(trip)/costs/page";
import TripsPage from "@/app/[user]/trips/page";

/**
 * B73 — the four pages `SiteNav` offers when the journal has no current trip.
 *
 * A brand-new journal has no trips at all, and one whose only trip is
 * `upcoming` has none that is current either. Three of the four answered 404
 * to their own header's links; the fourth had already been fixed. They resolve
 * the trip in one place now (lib/currentTrip.ts), and this asserts all four
 * land on the trip list rather than on "this page does not exist".
 */

const SERVER_CFG =
  '{"site":{"name":"F","url":"https://example.test","defaultUser":"alex"},"users":{"reserved":[]},"features":{}}';
const USER_CFG =
  '{"title":"F","tagline":"t","owner":{"name":"A B","nickname":"A"},"startLocation":"X","defaultLocale":"en","locales":["en"],"baseCurrency":"CHF","displayCurrencies":["CHF"],"units":"metric","features":{"reactions":{"enabled":true},"costs":{"enabled":true}}}';

/** A journal on disk with exactly the trips given, and nothing else. */
function journal(trips: { id: string; status: string; start: string; end: string }[]): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "current-trip-"));
  fs.writeFileSync(path.join(dir, "config.json"), SERVER_CFG);
  fs.mkdirSync(path.join(dir, "alex", "trips"), { recursive: true });
  fs.writeFileSync(path.join(dir, "alex", "config.json"), USER_CFG);
  for (const t of trips) {
    fs.mkdirSync(path.join(dir, "alex", "trips", t.id), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "alex", "trips", t.id, "trip.md"),
      `---\nid: ${t.id}\ntitle: "${t.id}"\nstart: "${t.start}"\nend: "${t.end}"\n` +
        `status: ${t.status}\nvisibility: public\n---\n\nSomething.\n`,
    );
    // A `costs.md` per trip: this file is about B73's redirect logic, not
    // about B267's "no budget anywhere" 404, and the two must not tangle —
    // every trip here has a budget so the costs page's own emptiness never
    // enters into what these assertions are checking.
    fs.writeFileSync(
      path.join(dir, "alex", "trips", t.id, "costs.md"),
      "---\nbudget:\n  total: 100\n  days: 10\n---\n\nBefore we left.\n",
    );
  }
  process.env.CONTENT_DIR = dir;
  clearConfigCache();
  clearUserCache();
  return dir;
}

/** `redirect()` reports itself by throwing; the target is in the digest. */
function digestOf(err: unknown): string {
  return typeof err === "object" && err !== null && "digest" in err
    ? String((err as { digest: unknown }).digest)
    : "";
}

/** Where a page sends the reader, or null when it does not send them anywhere. */
async function redirectTarget(page: () => Promise<unknown>): Promise<string | null> {
  try {
    await page();
  } catch (err) {
    const digest = digestOf(err);
    if (digest.startsWith("NEXT_REDIRECT")) return digest.split(";")[2];
    throw err;
  }
  return null;
}

const params = Promise.resolve({ user: "alex" });
const slug = Promise.resolve({ user: "alex", slug: "x" });
const search = Promise.resolve({});

/** The four links in the header, in the order `SiteNav` draws them. */
const NAV_PAGES: [string, () => Promise<unknown>][] = [
  ["/alex", () => Home({ params, searchParams: search })],
  ["/alex/gallery", () => GalleryPage({ params, searchParams: search })],
  ["/alex/map", () => MapPage({ params, searchParams: search })],
  ["/alex/costs", () => CostsPage({ params, searchParams: search })],
];

afterEach(() => {
  delete process.env.CONTENT_DIR;
});

describe("a journal with no trips at all", () => {
  beforeEach(() => {
    journal([]);
  });

  test("the helper sends the reader to the trip list", () => {
    expect(() => currentTripOrRedirect("alex")).toThrowError(/NEXT_REDIRECT/);
    try {
      currentTripOrRedirect("alex");
    } catch (err) {
      expect(digestOf(err)).toContain(";/alex/trips;");
    }
  });

  /**
   * The acceptance line, one page per case so a failure names the page.
   * `/alex/gallery`, `/alex/map` and `/alex/costs` each answered 404 before B73.
   */
  for (const [url, page] of NAV_PAGES) {
    test(`${url} redirects to the trip list rather than answering 404`, async () => {
      await expect(redirectTarget(page)).resolves.toBe("/alex/trips");
    });
  }
});

describe("a journal whose only trip is upcoming", () => {
  beforeEach(() => {
    // Dated far enough out that no date-derived reading of `status` can call
    // it current — the point is a journal with content and no current trip.
    journal([{ id: "later-2099", status: "upcoming", start: "2099-01-01", end: "2099-01-10" }]);
  });

  for (const [url, page] of NAV_PAGES) {
    test(`${url} redirects to the trip list rather than answering 404`, async () => {
      await expect(redirectTarget(page)).resolves.toBe("/alex/trips");
    });
  }
});

describe("a journal with a current trip", () => {
  beforeEach(() => {
    journal([{ id: "now-2026", status: "current", start: "2026-01-01", end: "2026-12-31" }]);
  });

  /** The guard on the fix: resolving the trip must not send everybody away. */
  for (const [url, page] of NAV_PAGES) {
    test(`${url} renders the trip instead of bailing out`, async () => {
      await expect(redirectTarget(page)).resolves.toBeNull();
      expect(await page()).toBeTruthy();
    });
  }
});

describe("the destination", () => {
  /**
   * A redirect is only an improvement if the page it lands on exists. The trip
   * list is the one page in the header that does not resolve a trip at all,
   * which is what makes it the honest answer for a journal that has none.
   */
  test("/alex/trips renders for a journal with no trips", async () => {
    journal([]);
    const page = await TripsPage({ params, searchParams: search });
    expect(page).toBeTruthy();
  });
});

describe("a day permalink", () => {
  test("is still a 404 when the journal has no trips — that day is not a page", async () => {
    journal([]);
    const { default: DayPage } = await import("@/app/[user]/(trip)/day/[slug]/page");
    let digest = "";
    try {
      await DayPage({ params: slug, searchParams: search });
    } catch (err) {
      digest = digestOf(err);
    }
    expect(digest).toContain("NEXT_HTTP_ERROR_FALLBACK;404");
  });
});
