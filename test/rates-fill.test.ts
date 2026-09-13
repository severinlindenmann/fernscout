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
import { readTripFile, writeTripFile } from "@/lib/api/v2/store";
import { writeTripFixture, writeDayFixture } from "./fixtures/content";

/**
 * B543 — a trip's local→base rates could only ever be typed by hand, and
 * until they were, every cost in that currency vanished from every total.
 *
 * The tests that matter here are the same shape as B325's own: the rule this
 * rests on is that nothing here invents a number. What makes a *lookup*
 * compatible with that rule is that it only ever fills a gap — never a
 * currency already rated, hand-typed or otherwise — and always says where it
 * got the answer.
 *
 * B1630/B1598 repoint: every `writeTrip`/`writeDay` here now writes v2
 * `trip.json`/`entries/*.json` through the production serialiser
 * (`writeTripFixture`, `writeDayFixture`), rather than v1's `trip.md` and a
 * `costs:` frontmatter block that `lib/entries.ts`/`lib/trips.ts` no longer
 * read at all post-B1606. `rates` itself moved storage convention too — v1
 * wrote a flat code→base-per-unit map; v2 stores `rates.manual` as units per
 * 1 EUR (`eurManualRates`, `lib/tripWrite.ts`), which `fillTripRates`
 * (`lib/api/tripRates.ts`) reads back through the same conversion. The
 * "hand-typed rate" fixture below reproduces that conversion directly
 * (`setHandTypedRate`) rather than pretending v1's flat number still means
 * anything on disk.
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

function writeInstance(costsOn = true) {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "Fernscout", url: "https://example.test", defaultUser: "ana" },
      users: { reserved: [] },
      features: { costs: { enabled: costsOn } },
    }),
  );
}

function writeJournal(costsOn: boolean) {
  fs.mkdirSync(path.join(dir, "ana"), { recursive: true });
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

function writeTrip() {
  writeTripFixture("ana", {
    id: "alps",
    title: "Alps",
    start: "2026-08-20",
    end: "2026-09-10",
    visibility: "public",
    intro: "Intro.",
  });
}

/**
 * Simulates a rate already sitting on the trip document, in v1's own
 * convention — `basePerCode.THB = 0.03` reads "1 THB = 0.03 CHF". Not on
 * `writeTripFixture` (B1630): "a hand-typed rate is never overwritten"
 * (below) needs to set this *after* the trip already exists, an in-place
 * rewrite `createTrip` (the fixture's writer) refuses — same resistance as
 * test/write-revocation.test.ts. Writes through the store directly
 * (`readTripFile`/`writeTripFile`), converting through `eurManualRates`'s
 * own convention by hand: with no ECB cache in this test's `DATA_DIR`, both
 * halves of the cross-division have to be supplied, so the base currency's
 * own euro-quoted rate is invented here too (`1`, an arbitrary anchor — the
 * fixture only cares that the cross-division lands back on `basePerCode`,
 * never what either half is worth in the real world).
 */
function setHandTypedRate(basePerCode: Record<string, number>) {
  const stored = readTripFile("ana", "alps")!;
  const baseEur = 1;
  const manual: Record<string, number> = { CHF: baseEur };
  for (const [code, rate] of Object.entries(basePerCode)) manual[code] = baseEur / rate;
  writeTripFile("ana", "alps", {
    ...stored,
    rates: { currencies: Object.keys(basePerCode), manual },
  });
}

function reload() {
  clearConfigCache();
  clearUserCache();
  clearMatterCache();
  forgetEntries(ref);
}

function writeDay(slug: string, date: string, costCurrency: string, amount = 100) {
  writeDayFixture(dir, "ana", "alps", {
    slug,
    date,
    title: slug,
    content: "The prose.",
    costs: [{ label: "Something", amount, currency: costCurrency, category: "food" }],
  });
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
    // B1092: `costs` is operator-only, so only the server's own switch turns
    // it off — a journal's `features.costs` is never read any more.
    writeInstance(false);
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
    // Six significant figures, not the full cross-division — see `readable`.
    expect(trip.rates.THB).toBeCloseTo(0.935 / 40.5, 7);
    // v2 has no home for a per-rate citation any more (`writeRatesFrom`,
    // lib/api/tripRates.ts, is a documented no-op): a filled rate is written
    // into `rates.manual` — the very field a hand-typed rate lives in too —
    // so `lib/trips.ts`'s reader can no longer tell them apart and credits
    // both alike as "the trip's own rate". The specific day the archive was
    // read on is not recoverable from the trip after the write.
    expect(trip.ratesFrom.THB).toBe("the trip's own rate");

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

  test("a filled rate is written at a precision a person can read", async () => {
    writeDay("dinner", "2026-08-24", "THB", 800);
    reload();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      historyAnswer({ "2026-08-21": { THB: 38.1234, CHF: 0.936421 } }),
    );

    expect(await fillTripRates(ref)).toEqual({ THB: "filled" });
    // The cross-division itself is 0.02456287…; trip.md is a file somebody
    // opens, and six figures is already more than the rate is knowable to.
    expect(getTrip(ref)!.rates.THB).toBe(0.0245629);
  });

  test("a hand-typed rate is never overwritten", async () => {
    setHandTypedRate({ THB: 0.03 });
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
    const stored = readTripFile("ana", "alps")!;
    writeTripFile("ana", "alps", {
      ...stored,
      costs: {
        items: [{ label: "Visa", amount: 50, currency: "THB", category: "preparation" }],
      } as (typeof stored)["costs"],
    });
    reload();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      historyAnswer({ "2026-08-20": { THB: 40.2, CHF: 0.93 } }),
    );

    // The mock only answers for 2026-08-20 — if the fill had frozen at any
    // other date, `ecbRatesOnOrBefore` would have found nothing and the
    // outcome would not be "filled" at all, so this is still a real pin of
    // "the trip's own start" being the date used, even with no per-rate
    // citation left to read it back from (see the note in the first test in
    // this describe block).
    expect(await fillTripRates(ref)).toEqual({ THB: "filled" });
    expect(getTrip(ref)!.ratesFrom.THB).toBe("the trip's own rate");
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

    // Each currency's own mock-only-answers-on-its-date proves it froze at
    // its own first-seen day rather than the trip's or the other
    // currency's — same reasoning as the test above.
    const outcomes = await fillTripRates(ref);
    expect(outcomes).toEqual({ THB: "filled", VND: "filled" });
    expect(getTrip(ref)!.ratesFrom.THB).toBe("the trip's own rate");
    expect(getTrip(ref)!.ratesFrom.VND).toBe("the trip's own rate");
  });
});
