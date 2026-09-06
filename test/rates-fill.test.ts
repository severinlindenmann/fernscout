import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { clearMatterCache, forgetEntries } from "@/lib/entries";
import { fillTripRates } from "@/lib/api/tripRates";
import { getCostSummary } from "@/lib/costs";
import { getTrip } from "@/lib/trips";
import { clearEcbHistoryCache, parseEcbHistory } from "@/lib/ecbHistory";

/**
 * B543 — a trip's local→base rates could only ever be typed by hand, and
 * until they were, every cost in that currency vanished from every total.
 *
 * The tests that matter here are the same shape as B325's own: the rule this
 * rests on is that nothing here invents a number. What makes a *lookup*
 * compatible with that rule is that it only ever fills a gap — never a
 * currency already rated, hand-typed or otherwise — and always says where it
 * got the answer.
 */

let dir: string;
const ref = "ana/alps";

/** A 90-day ECB history document with exactly the days a test names. */
function historyXml(days: Record<string, Record<string, number>>) {
  const cubes = Object.entries(days)
    .map(
      ([date, rates]) =>
        `<Cube time="${date}">` +
        Object.entries(rates)
          .map(([code, rate]) => `<Cube currency="${code}" rate="${rate}"/>`)
          .join("") +
        `</Cube>`,
    )
    .join("");
  return `<?xml version="1.0"?><gesmes:Envelope><Cube>${cubes}</Cube></gesmes:Envelope>`;
}

function writeInstance() {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "Fernscout", url: "https://example.test", defaultUser: "ana" },
      users: { reserved: [] },
      features: { costs: { enabled: true } },
    }),
  );
}

function writeJournal(costsOn: boolean) {
  fs.mkdirSync(path.join(dir, "ana", "trips", "alps", "entries"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "ana", "config.json"),
    JSON.stringify({
      title: "Ana's journal",
      tagline: "t",
      owner: { name: "A B", nickname: "A" },
      startLocation: "X",
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      displayCurrencies: ["CHF"],
      units: "metric",
      features: { costs: { enabled: costsOn } },
    }),
  );
}

function writeTrip(front: string[] = []) {
  fs.writeFileSync(
    path.join(dir, "ana", "trips", "alps", "trip.md"),
    [
      "---",
      'id: "alps"',
      'title: "Alps"',
      'start: "2026-08-20"',
      'end: "2026-09-10"',
      'status: "current"',
      'visibility: "public"',
      ...front,
      "---",
      "",
      "Intro.",
      "",
    ].join("\n"),
  );
}

function reload() {
  clearConfigCache();
  clearUserCache();
  clearMatterCache();
  forgetEntries(ref);
}

function writeDay(slug: string, date: string, costCurrency: string, amount = 100) {
  const file = path.join(dir, "ana", "trips", "alps", "entries", `${date}-${slug}.md`);
  fs.writeFileSync(
    file,
    [
      "---",
      `title: "${slug}"`,
      `date: "${date}"`,
      "costs:",
      `  - { label: "Something", amount: ${amount}, currency: "${costCurrency}", category: "food" }`,
      "---",
      "",
      "The prose.",
      "",
    ].join("\n"),
  );
}

beforeEach(() => {
  // Each test hands over its own document; the process-lifetime memo in
  // lib/ecbHistory.ts would otherwise serve the previous test's.
  clearEcbHistoryCache();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-rates-fill-"));
  process.env.CONTENT_DIR = dir;
  writeInstance();
  writeJournal(true);
  writeTrip();
  reload();
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.CONTENT_DIR;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

/** One fetch answer for the whole 90-day document. */
function historyAnswer(days: Record<string, Record<string, number>>) {
  return { ok: true, text: async () => historyXml(days) } as unknown as Response;
}

describe("parsing the ECB's own document", () => {
  test("one block per day, newest or oldest first, either way", () => {
    const xml = historyXml({
      "2026-09-04": { THB: 40.8, USD: 1.08 },
      "2026-09-03": { THB: 40.5, USD: 1.07 },
    });
    expect(parseEcbHistory(xml)).toEqual([
      { date: "2026-09-04", rates: { THB: 40.8, USD: 1.08 } },
      { date: "2026-09-03", rates: { THB: 40.5, USD: 1.07 } },
    ]);
  });

  test("a document with nothing usable reads as absent, not empty", () => {
    expect(parseEcbHistory("<gesmes:Envelope><Cube></Cube></gesmes:Envelope>")).toBeUndefined();
  });
});

describe("the capability is off", () => {
  test("no request is made, and nothing is written", async () => {
    writeJournal(false);
    writeDay("dinner", "2026-08-24", "THB");
    reload();
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    expect(await fillTripRates(ref)).toEqual({});
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(getTrip(ref)!.rates).toEqual({});
  });
});

describe("filling a trip's rates", () => {
  test("one rate per currency, frozen at the nearest publication day, named in ratesFrom", async () => {
    // 2026-08-24 was a Monday; the weekend before has no publication, so the
    // nearest preceding day is the Friday, 2026-08-21.
    writeDay("dinner", "2026-08-24", "THB", 800);
    reload();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      historyAnswer({
        // The 24th itself is a Monday with no publication in this fixture —
        // a later, unrelated day is also in the document, to prove the
        // nearest *preceding* day is picked rather than merely the latest.
        "2026-08-25": { THB: 41.0, CHF: 0.945 },
        "2026-08-21": { THB: 40.5, CHF: 0.935 },
      }),
    );

    const outcomes = await fillTripRates(ref);
    expect(outcomes).toEqual({ THB: "filled" });

    const trip = getTrip(ref)!;
    // Trip convention: units of CHF for one THB, cross-divided through EUR —
    // (CHF per EUR) / (THB per EUR), at the day actually used.
    expect(trip.rates.THB).toBeCloseTo(0.935 / 40.5, 9);
    expect(trip.ratesFrom.THB).toContain("2026-08-21");
    expect(trip.ratesFrom.THB).toContain("European Central Bank");

    const summary = getCostSummary(ref);
    expect(summary.unconverted).toEqual([]);
    expect(summary.ratesFrom).toEqual(trip.ratesFrom);
  });

  test("re-running changes nothing", async () => {
    writeDay("dinner", "2026-08-24", "THB", 800);
    reload();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(historyAnswer({ "2026-08-21": { THB: 40.5, CHF: 0.935 } }));

    expect(await fillTripRates(ref)).toEqual({ THB: "filled" });
    reload();
    expect(await fillTripRates(ref)).toEqual({ THB: "already_rated" });
    // One fetch for the first run; the second never needed the network at
    // all, because every currency it looked at was already rated.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  test("a currency the ECB will never publish does not re-download the document on every write", async () => {
    // The repeated-failure path: `fillTripRates` runs on every day write, and
    // an unpublishable currency reaches the same answer each time. Fetching
    // the whole 90-day document to do it is the part worth not repeating.
    writeDay("dinner", "2026-08-24", "KIP", 800);
    reload();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(historyAnswer({ "2026-08-21": { THB: 40.5, CHF: 0.935 } }));

    expect(await fillTripRates(ref)).toEqual({ KIP: "not_published" });
    reload();
    expect(await fillTripRates(ref)).toEqual({ KIP: "not_published" });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  test("a hand-typed rate is never overwritten", async () => {
    writeTrip(["rates:", "  THB: 0.03"]);
    writeDay("dinner", "2026-08-24", "THB", 800);
    reload();
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    expect(await fillTripRates(ref)).toEqual({ THB: "already_rated" });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(getTrip(ref)!.rates.THB).toBe(0.03);
  });

  test("a date outside the 90-day window is left alone and reported", async () => {
    writeDay("dinner", "2026-08-24", "THB", 800);
    reload();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      historyAnswer({ "2026-09-01": { THB: 40.8, CHF: 0.94 } }),
    );

    expect(await fillTripRates(ref)).toEqual({ THB: "outside_window" });
    expect(getTrip(ref)!.rates).toEqual({});
  });

  test("a currency the ECB does not publish is left alone and reported", async () => {
    writeDay("dinner", "2026-08-24", "KIP", 800);
    reload();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      historyAnswer({ "2026-08-21": { THB: 40.5, CHF: 0.935 } }),
    );

    expect(await fillTripRates(ref)).toEqual({ KIP: "not_published" });
    expect(getTrip(ref)!.rates).toEqual({});
  });

  test("a provider that answers with nothing leaves every currency for next time", async () => {
    writeDay("dinner", "2026-08-24", "THB", 800);
    reload();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));

    expect(await fillTripRates(ref)).toEqual({ THB: "no_answer" });
    expect(getTrip(ref)!.rates).toEqual({});
  });

  test("a dry run stops before the network and reports what it would do", async () => {
    writeDay("dinner", "2026-08-24", "THB", 800);
    reload();
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    expect(await fillTripRates(ref, { dryRun: true })).toEqual({ THB: "would_fetch" });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(getTrip(ref)!.rates).toEqual({});
  });

  test("a currency at the site's base is never asked about", async () => {
    writeDay("dinner", "2026-08-24", "CHF", 800);
    reload();
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    expect(await fillTripRates(ref)).toEqual({});
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("a currency only in a preparation cost freezes at the trip's own start", async () => {
    fs.writeFileSync(
      path.join(dir, "ana", "trips", "alps", "costs.md"),
      [
        "---",
        "costs:",
        '  - { label: "Visa", amount: 50, currency: "THB", category: "preparation" }',
        "---",
        "",
      ].join("\n"),
    );
    reload();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      historyAnswer({ "2026-08-20": { THB: 40.2, CHF: 0.93 } }),
    );

    expect(await fillTripRates(ref)).toEqual({ THB: "filled" });
    expect(getTrip(ref)!.ratesFrom.THB).toContain("2026-08-20");
  });

  test("two currencies each freeze at their own first date, not the trip's", async () => {
    writeDay("day-one", "2026-08-24", "THB", 800);
    writeDay("day-two", "2026-08-26", "VND", 500000);
    reload();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      historyAnswer({
        "2026-08-24": { THB: 40.8, CHF: 0.94 },
        "2026-08-26": { THB: 40.9, VND: 26000, CHF: 0.941 },
      }),
    );

    const outcomes = await fillTripRates(ref);
    expect(outcomes).toEqual({ THB: "filled", VND: "filled" });
    expect(getTrip(ref)!.ratesFrom.THB).toContain("2026-08-24");
    expect(getTrip(ref)!.ratesFrom.VND).toContain("2026-08-26");
  });
});
