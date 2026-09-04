import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { costsAvailable, hasCostsData } from "@/lib/costs";
import { siteSummaryFor } from "@/lib/site";
import { getUser } from "@/lib/users";
import { tripRef } from "@/lib/trips";

/**
 * B267 — a journal with no `costs.md` anywhere had the capability on by
 * default (lib/journals.ts) and nothing to show for it: a "Costs" tab in the
 * nav, and a page rendering an empty shell underneath it. `costsAvailable`
 * (lib/costs.ts) is what the nav (`SiteNav`, through `SiteSummary.costsEnabled`
 * in lib/site.ts) and both costs pages now ask instead of the bare capability
 * check — capability on *and* at least one trip's `costs.md` written.
 *
 * `test/costs.test.ts` covers the money arithmetic against the shared fixture
 * content, which mixes a trip with a budget (`alpha-2023`) and one without
 * (`beta-2026`) under a single user — useful there, useless here, since this
 * question is asked per journal and that journal already has one trip with a
 * budget. Two journals of its own, written fresh, are what let the two states
 * actually differ.
 */

let dir: string;

function writeUser(username: string) {
  fs.mkdirSync(path.join(dir, username), { recursive: true });
  fs.writeFileSync(
    path.join(dir, username, "config.json"),
    JSON.stringify({
      title: `${username}'s journal`,
      tagline: "A tagline",
      owner: { name: "A B", nickname: "A" },
      startLocation: "X",
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      displayCurrencies: ["CHF"],
      units: "metric",
      features: { costs: { enabled: true } },
    }),
  );
}

function writeTrip(username: string, tripId: string, withCosts: boolean) {
  const tripPath = path.join(dir, username, "trips", tripId);
  fs.mkdirSync(path.join(tripPath, "entries"), { recursive: true });
  fs.writeFileSync(
    path.join(tripPath, "trip.md"),
    [
      "---",
      `id: ${tripId}`,
      `title: "${tripId}"`,
      'start: "2026-01-01"',
      'end: "2026-01-31"',
      "status: past",
      "---",
      "",
      "Body.",
      "",
    ].join("\n"),
  );
  if (withCosts) {
    fs.writeFileSync(
      path.join(tripPath, "costs.md"),
      ["---", "budget:", "  total: 100", "  days: 10", "---", "", "Before we left.", ""].join(
        "\n",
      ),
    );
  }
}

/** One day, carrying its own `costs:` block and nothing else particular —
 * B328's fixture: the trip that has money logged and no `costs.md` at all. */
function writeDayCostEntry(username: string, tripId: string, draft: boolean) {
  const entriesDir = path.join(dir, username, "trips", tripId, "entries");
  fs.mkdirSync(entriesDir, { recursive: true });
  fs.writeFileSync(
    path.join(entriesDir, "2026-01-02-a-day.md"),
    [
      "---",
      'title: "A day"',
      'date: "2026-01-02"',
      "costs:",
      '  - { label: "Street food", amount: 20, category: "food" }',
      ...(draft ? ["status: draft"] : []),
      "---",
      "",
      "Body.",
      "",
    ].join("\n"),
  );
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-costs-availability-"));
  process.env.CONTENT_DIR = dir;
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "Fernscout", url: "https://example.test", defaultUser: "budgeted" },
      users: { reserved: [] },
      features: {},
    }),
  );
  writeUser("budgeted");
  writeTrip("budgeted", "trip-a", true);
  writeUser("unbudgeted");
  writeTrip("unbudgeted", "trip-a", false);
  writeUser("off");
  writeTrip("off", "trip-a", true);
  // B328: a trip with a day's spend logged and no `costs.md` at all.
  writeUser("daycosts");
  writeTrip("daycosts", "trip-a", false);
  writeDayCostEntry("daycosts", "trip-a", false);
  // Written after the others so `writeUser` above can stay the one place
  // that sets the ordinary feature block.
  fs.writeFileSync(
    path.join(dir, "off", "config.json"),
    JSON.stringify({
      title: "off's journal",
      tagline: "A tagline",
      owner: { name: "A B", nickname: "A" },
      startLocation: "X",
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      displayCurrencies: ["CHF"],
      units: "metric",
      features: { costs: { enabled: false } },
    }),
  );
  clearConfigCache();
  clearUserCache();
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("costsAvailable", () => {
  test("true when the capability is on and a trip has a costs.md", () => {
    expect(costsAvailable("budgeted")).toBe(true);
  });

  test("false when the capability is on but no trip has written one", () => {
    expect(costsAvailable("unbudgeted")).toBe(false);
  });

  test("false when the capability itself is off, costs.md or not", () => {
    expect(costsAvailable("off")).toBe(false);
  });
});

describe("what the nav is told", () => {
  test("a journal with a costs.md: the tab stays", () => {
    const user = getUser("budgeted")!;
    expect(siteSummaryFor(user, false).costsEnabled).toBe(true);
  });

  test("a journal with no costs.md anywhere: the tab is gone", () => {
    const user = getUser("unbudgeted")!;
    expect(siteSummaryFor(user, false).costsEnabled).toBe(false);
  });
});

/**
 * B328 — the trip that had fifteen days of logged spend and no `costs.md`,
 * and no page to show for it. `hasCostsData` asked only about the file;
 * these pin the fix, that it also asks the days.
 */
describe("hasCostsData, once it also asks the days", () => {
  test("true for a trip with a published day's costs and no costs.md at all", () => {
    expect(hasCostsData(tripRef("daycosts", "trip-a"))).toBe(true);
  });

  test("its journal's nav gets the tab too, with nothing written by hand", () => {
    expect(costsAvailable("daycosts")).toBe(true);
    const user = getUser("daycosts")!;
    expect(siteSummaryFor(user, false).costsEnabled).toBe(true);
  });

  test("false for a trip with nothing costed anywhere — neither a file nor a day", () => {
    expect(hasCostsData(tripRef("unbudgeted", "trip-a"))).toBe(false);
    expect(costsAvailable("unbudgeted")).toBe(false);
  });
});
