import { afterEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * B214 / B382 — the trip-scoped costs page's `<meta name="description">`.
 *
 * It was a literal English sentence, always past tense, naming the journal by
 * `trip.username` — the URL slug — rather than its title or the currency the
 * sentence is actually about: "What Cherry blossom, north to south actually
 * cost, itemised in xydhd-lifecycle's currency." on a trip that had not
 * started, observed on fernscout.ch at e85248d.
 *
 * Fixed by asking the tense the way the sibling page's own metadata does
 * (`hasBegun(trip, days)`, not `getCostSummary`) and naming the currency
 * instead of the slug.
 */

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => ({ get: () => "/alex/trips/ridge-2025/costs" }),
}));

const SERVER_CFG =
  '{"site":{"name":"F","url":"https://example.test","defaultUser":"alex"},"users":{"reserved":[]},"features":{}}';

function journal(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trip-costs-description-"));
  fs.writeFileSync(path.join(dir, "config.json"), SERVER_CFG);

  const past = path.join(dir, "alex", "trips", "ridge-2025");
  fs.mkdirSync(path.join(past, "entries"), { recursive: true });
  fs.writeFileSync(
    path.join(past, "trip.md"),
    '---\nid: ridge-2025\ntitle: "Along the ridge"\nstart: "2025-05-01"\nend: "2025-05-10"\n' +
      "status: past\nvisibility: public\n---\n\nSomething.\n",
  );
  fs.writeFileSync(
    path.join(past, "costs.md"),
    "---\nbudget:\n  total: 100\n  days: 10\n---\n\nBefore we left.\n",
  );

  const upcoming = path.join(dir, "alex", "trips", "cherry-blossom");
  fs.mkdirSync(path.join(upcoming, "entries"), { recursive: true });
  fs.writeFileSync(
    path.join(upcoming, "trip.md"),
    '---\nid: cherry-blossom\ntitle: "Cherry blossom, north to south"\nstart: "2027-04-03"\n' +
      'end: "2027-04-20"\nstatus: upcoming\nvisibility: public\n---\n\nSomething.\n',
  );
  fs.writeFileSync(
    path.join(upcoming, "costs.md"),
    "---\nbudget:\n  total: 100\n  days: 10\n---\n\nBefore we left.\n",
  );

  fs.writeFileSync(
    path.join(dir, "alex", "config.json"),
    JSON.stringify({
      title: "The Lifecycle Journal",
      tagline: "t",
      owner: { name: "A B", nickname: "A" },
      startLocation: "X",
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      displayCurrencies: ["CHF"],
      units: "metric",
      features: {},
    }),
  );
  return dir;
}

afterEach(() => {
  delete process.env.CONTENT_DIR;
});

describe("a trip-scoped costs page's description", () => {
  test("a finished trip is past tense; an upcoming one is a budget, and neither names the username", async () => {
    process.env.CONTENT_DIR = journal();
    const { clearConfigCache } = await import("@/lib/config");
    const { clearUserCache } = await import("@/lib/users");
    const { clearLocaleCache } = await import("@/lib/locales");
    clearConfigCache();
    clearUserCache();
    clearLocaleCache();
    const { generateMetadata } = await import("@/app/[user]/trips/[trip]/costs/page");

    const past = await generateMetadata({
      params: Promise.resolve({ user: "alex", trip: "ridge-2025" }),
      searchParams: Promise.resolve({}),
    });
    const upcoming = await generateMetadata({
      params: Promise.resolve({ user: "alex", trip: "cherry-blossom" }),
      searchParams: Promise.resolve({}),
    });

    expect(past.description).toBe("What Along the ridge actually cost, itemised in CHF.");
    expect(upcoming.description).toBe(
      "What Cherry blossom, north to south is budgeted to cost, itemised in CHF.",
    );
    expect(past.description).not.toBe(upcoming.description);
    // Past tense must not leak into a trip that has not started.
    expect(upcoming.description).not.toMatch(/actually cost/);

    for (const description of [past.description, upcoming.description]) {
      expect(description).not.toContain("alex");
    }
  });
});
