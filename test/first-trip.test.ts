import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { earliestTodayISO } from "@/lib/tripTime";
import { writeTripFixture } from "./fixtures/content";
import { firstTripCandidates, sweepFirstTrip } from "@/lib/digest/firstTrip";

/**
 * B2447 (W44 D5) — the first-trip nudge: a journal that opted into
 * getting-started tips at signup and never adds a trip hears about it once,
 * ever. B2448 item 4's push branch is covered by
 * `test/message-registry.test.ts` (the id has a real call site) — it never
 * actually fires today, since an owner's own push subscription cannot yet be
 * told apart from a reader's (see `ownerPushSubscription`'s own comment).
 */

const TODAY = earliestTodayISO();

function addDays(iso: string, delta: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

let dir: string;
let data: string;

function writeSiteConfig() {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "Testbed", url: "https://example.test" },
      features: { mail: { enabled: true } },
    }),
  );
}

function writeJournal(username: string, tips?: { optIn: boolean; at: string; sentAt?: string }) {
  fs.mkdirSync(path.join(dir, username, "trips"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, username, "config.json"),
    JSON.stringify({
      title: username,
      owner: {
        name: "Owner",
        nickname: "O",
        email: `${username}@example.test`,
        ...(tips ? { tips } : {}),
      },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
    }),
  );
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-firsttrip-"));
  data = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-firsttrip-data-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = data;
  writeSiteConfig();
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  delete process.env.DATA_DIR;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(data, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("candidates (lib/digest/firstTrip.ts)", () => {
  test("a 4-day-old journal with tips and no trip is a candidate", () => {
    writeJournal("ana", { optIn: true, at: addDays(TODAY, -4) });
    const candidates = firstTripCandidates(TODAY);
    expect(candidates.map((c) => c.username)).toEqual(["ana"]);
    expect(candidates[0].ageDays).toBe(4);
  });

  test("without tips, not a candidate", () => {
    writeJournal("ana");
    expect(firstTripCandidates(TODAY)).toEqual([]);
  });

  test("with a trip, not a candidate even with tips on", () => {
    writeJournal("ana", { optIn: true, at: addDays(TODAY, -4) });
    writeTripFixture("ana", { id: "spain", title: "Spain", start: TODAY, end: TODAY, visibility: "private", intro: "Intro." });
    expect(firstTripCandidates(TODAY)).toEqual([]);
  });

  test("already sent, not a candidate again", () => {
    writeJournal("ana", { optIn: true, at: addDays(TODAY, -10), sentAt: addDays(TODAY, -5) });
    expect(firstTripCandidates(TODAY)).toEqual([]);
  });
});

describe("the nightly sweep (sweepFirstTrip)", () => {
  test("a 4-day-old journal with tips and no trip gets exactly one mail across two sweeps", async () => {
    writeJournal("ana", { optIn: true, at: addDays(TODAY, -4) });

    const first = await sweepFirstTrip({ dryRun: false });
    expect(first.mailed).toBe(1);
    expect(first.acted).toEqual([["ana", "mail"]]);
    expect(fs.readdirSync(path.join(data, "mail", "ana"))).toHaveLength(1);

    const second = await sweepFirstTrip({ dryRun: false });
    expect(second.mailed).toBe(0);
    expect(fs.readdirSync(path.join(data, "mail", "ana"))).toHaveLength(1);
  });

  test("without tips, none", async () => {
    writeJournal("ana");
    const result = await sweepFirstTrip({ dryRun: false });
    expect(result.mailed).toBe(0);
    expect(fs.existsSync(path.join(data, "mail", "ana"))).toBe(false);
  });

  test("with a trip, none", async () => {
    writeJournal("ana", { optIn: true, at: addDays(TODAY, -4) });
    writeTripFixture("ana", { id: "spain", title: "Spain", start: TODAY, end: TODAY, visibility: "private", intro: "Intro." });
    const result = await sweepFirstTrip({ dryRun: false });
    expect(result.mailed).toBe(0);
    expect(fs.existsSync(path.join(data, "mail", "ana"))).toBe(false);
  });

  test("too young (day 2), nothing yet", async () => {
    writeJournal("ana", { optIn: true, at: addDays(TODAY, -2) });
    const result = await sweepFirstTrip({ dryRun: false });
    expect(result.mailed).toBe(0);
    expect(fs.existsSync(path.join(data, "mail", "ana"))).toBe(false);
  });

  test("--dry-run sends nothing and does not mark the journal sent", async () => {
    writeJournal("ana", { optIn: true, at: addDays(TODAY, -4) });
    const dry = await sweepFirstTrip({ dryRun: true });
    expect(dry.mailed).toBe(0);
    expect(dry.acted).toEqual([["ana", "mail"]]);
    expect(fs.existsSync(path.join(data, "mail", "ana"))).toBe(false);

    const real = await sweepFirstTrip({ dryRun: false });
    expect(real.mailed).toBe(1);
  });

  test("the mail's manage line points at the studio journal settings", async () => {
    writeJournal("ana", { optIn: true, at: addDays(TODAY, -4) });
    await sweepFirstTrip({ dryRun: false });
    const folder = path.join(data, "mail", "ana");
    const eml = fs.readFileSync(path.join(folder, fs.readdirSync(folder)[0]), "utf8");
    const text = [...eml.matchAll(/Content-Transfer-Encoding: base64\r?\n(?:[^\r\n]+\r?\n)*\r?\n([A-Za-z0-9+/=\r\n]+)/g)]
      .map((part) => Buffer.from(part[1].replace(/\s+/g, ""), "base64").toString("utf8"))
      .join("\n");
    expect(text).toContain("https://example.test/ana/studio/journal");
    expect(text).toContain("https://example.test/ana/studio/trip/new");
  });
});
