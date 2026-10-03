import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { createJournal } from "@/lib/journals";
import { clearUserCache } from "@/lib/users";
import { earliestTodayISO } from "@/lib/tripTime";
import { writeTripFixture } from "./fixtures/content";
import { firstTripCandidates, sweepFirstTrip } from "@/lib/digest/firstTrip";
import { saveSubscription } from "@/lib/push";

// The push transport itself is B2448's (test/push-send.test.ts); here only
// who is pushed, and when, is the question.
const pushed = vi.hoisted(() => [] as Array<{ template: string; endpoints: string[] }>);
vi.mock("@/lib/push/send", async (original) => ({
  ...(await original<typeof import("@/lib/push/send")>()),
  sendPush: vi.fn(async (params: { template: string; subscriptions: unknown }) => {
    const subs = (Array.isArray(params.subscriptions) ? params.subscriptions : [params.subscriptions]) as Array<{ endpoint: string }>;
    pushed.push({ template: params.template, endpoints: subs.map((x) => x.endpoint) });
    return { sent: subs.length, pruned: 0 };
  }),
}));

/**
 * B2447, reworked in B2809 — the first-trip nudge: every new journal that
 * never adds a trip hears about it once, ever, as a service message (no
 * opt-in box; `optIn: false` means the owner stopped it). With the owner's
 * own device subscribed the push (day 2) is the whole reminder; otherwise one
 * mail at day 3. A reader's subscription never counts as the owner's.
 */

const TODAY = earliestTodayISO();

function addDays(iso: string, delta: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

let dir: string;
let data: string;
let savedDatabaseUrl: string | undefined;

function writeSiteConfig() {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "Testbed", url: "https://example.test" },
      features: { mail: { enabled: true } },
    }),
  );
}

function writeJournal(username: string, tips?: { optIn?: boolean; basis?: "service"; at: string; sentAt?: string }) {
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
  // Push subscriptions go to the database when DATABASE_URL is set (as CI
  // sets it), shared across files; pin the per-test DATA_DIR file store.
  savedDatabaseUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  writeSiteConfig();
  vi.spyOn(console, "log").mockImplementation(() => {});
  pushed.length = 0;
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  delete process.env.DATA_DIR;
  if (savedDatabaseUrl !== undefined) process.env.DATABASE_URL = savedDatabaseUrl;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(data, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("candidates (lib/digest/firstTrip.ts)", () => {
  test("a 4-day-old journal with tips and no trip is a candidate", () => {
    writeJournal("ana", { basis: "service", at: addDays(TODAY, -4) });
    const candidates = firstTripCandidates(TODAY);
    expect(candidates.map((c) => c.username)).toEqual(["ana"]);
    expect(candidates[0].ageDays).toBe(4);
  });

  test("without tips, not a candidate", () => {
    writeJournal("ana");
    expect(firstTripCandidates(TODAY)).toEqual([]);
  });

  test("with a trip, not a candidate even with tips on", () => {
    writeJournal("ana", { basis: "service", at: addDays(TODAY, -4) });
    writeTripFixture("ana", { id: "spain", title: "Spain", start: TODAY, end: TODAY, visibility: "private", intro: "Intro." });
    expect(firstTripCandidates(TODAY)).toEqual([]);
  });

  test("already sent, not a candidate again", () => {
    writeJournal("ana", { basis: "service", at: addDays(TODAY, -10), sentAt: addDays(TODAY, -5) });
    expect(firstTripCandidates(TODAY)).toEqual([]);
  });
});

describe("the nightly sweep (sweepFirstTrip)", () => {
  test("a 4-day-old journal with tips and no trip gets exactly one mail across two sweeps", async () => {
    writeJournal("ana", { basis: "service", at: addDays(TODAY, -4) });

    const first = await sweepFirstTrip({ dryRun: false });
    expect(first.mailed).toBe(1);
    expect(first.acted).toEqual([["ana", "mail"]]);
    expect(fs.readdirSync(path.join(data, "mail", "ana"))).toHaveLength(1);

    const second = await sweepFirstTrip({ dryRun: false });
    expect(second.mailed).toBe(0);
    expect(fs.readdirSync(path.join(data, "mail", "ana"))).toHaveLength(1);
  });

  test("an owner who stopped it (optIn false, old or new journal) gets none", async () => {
    writeJournal("ana", { optIn: false, at: addDays(TODAY, -10) });
    writeJournal("bo", { basis: "service", optIn: false, at: addDays(TODAY, -10) });
    expect(firstTripCandidates(TODAY)).toEqual([]);
    const result = await sweepFirstTrip({ dryRun: false });
    expect(result.acted).toEqual([]);
  });

  test("a journal from before the service message that ticked the box is still reminded", () => {
    writeJournal("ana", { optIn: true as boolean, at: addDays(TODAY, -4) });
    expect(firstTripCandidates(TODAY)).toHaveLength(1);
  });

  test("a journal created through createJournal is nudged with no opt-in, even if tips:false is passed", async () => {
    const made = createJournal({
      username: "newbie", title: "Newbie", ownerEmail: "newbie@example.test", ownerName: "N", ownerNickname: "N", tips: false,
    });
    expect(made.ok).toBe(true);
    const file = path.join(dir, "newbie", "config.json");
    const config = JSON.parse(fs.readFileSync(file, "utf8"));
    expect(config.owner.tips).toMatchObject({ basis: "service" });
    config.owner.tips.at = addDays(TODAY, -3);
    fs.writeFileSync(file, JSON.stringify(config));
    clearConfigCache();
    clearUserCache();
    const result = await sweepFirstTrip({ dryRun: false });
    expect(result.acted).toEqual([["newbie", "mail"]]);
  });

  test("without tips, none", async () => {
    writeJournal("ana");
    const result = await sweepFirstTrip({ dryRun: false });
    expect(result.mailed).toBe(0);
    expect(fs.existsSync(path.join(data, "mail", "ana"))).toBe(false);
  });

  test("with a trip, none", async () => {
    writeJournal("ana", { basis: "service", at: addDays(TODAY, -4) });
    writeTripFixture("ana", { id: "spain", title: "Spain", start: TODAY, end: TODAY, visibility: "private", intro: "Intro." });
    const result = await sweepFirstTrip({ dryRun: false });
    expect(result.mailed).toBe(0);
    expect(fs.existsSync(path.join(data, "mail", "ana"))).toBe(false);
  });

  test("too young (day 2), nothing yet", async () => {
    writeJournal("ana", { basis: "service", at: addDays(TODAY, -2) });
    const result = await sweepFirstTrip({ dryRun: false });
    expect(result.mailed).toBe(0);
    expect(fs.existsSync(path.join(data, "mail", "ana"))).toBe(false);
  });

  test("--dry-run sends nothing and does not mark the journal sent", async () => {
    writeJournal("ana", { basis: "service", at: addDays(TODAY, -4) });
    const dry = await sweepFirstTrip({ dryRun: true });
    expect(dry.mailed).toBe(0);
    expect(dry.acted).toEqual([["ana", "mail"]]);
    expect(fs.existsSync(path.join(data, "mail", "ana"))).toBe(false);

    const real = await sweepFirstTrip({ dryRun: false });
    expect(real.mailed).toBe(1);
  });

  test("the mail says why it came and how to stop it", async () => {
    writeJournal("ana", { basis: "service", at: addDays(TODAY, -4) });
    await sweepFirstTrip({ dryRun: false });
    const folder = path.join(data, "mail", "ana");
    const eml = fs.readFileSync(path.join(folder, fs.readdirSync(folder)[0]), "utf8");
    const text = [...eml.matchAll(/Content-Transfer-Encoding: base64\r?\n(?:[^\r\n]+\r?\n)*\r?\n([A-Za-z0-9+/=\r\n]+)/g)]
      .map((part) => Buffer.from(part[1].replace(/\s+/g, ""), "base64").toString("utf8"))
      .join("\n");
    expect(text).toContain("service message");
    expect(text).toContain("Stop these");
    expect(text).not.toContain("turned on");
  });

  test("the mail's manage line points at the studio journal settings", async () => {
    writeJournal("ana", { basis: "service", at: addDays(TODAY, -4) });
    await sweepFirstTrip({ dryRun: false });
    const folder = path.join(data, "mail", "ana");
    const eml = fs.readFileSync(path.join(folder, fs.readdirSync(folder)[0]), "utf8");
    const text = [...eml.matchAll(/Content-Transfer-Encoding: base64\r?\n(?:[^\r\n]+\r?\n)*\r?\n([A-Za-z0-9+/=\r\n]+)/g)]
      .map((part) => Buffer.from(part[1].replace(/\s+/g, ""), "base64").toString("utf8"))
      .join("\n");
    expect(text).toContain("https://example.test/@ana/studio/journal");
    expect(text).toContain("https://example.test/@ana/studio/trip/new");
  });
});

describe("the owner's own device first (B2448 item 4)", () => {
  function subscribe(username: string, endpoint: string, isOwner: boolean) {
    return saveSubscription({
      username,
      endpoint,
      keys: { p256dh: "p", auth: "a" },
      created: new Date().toISOString(),
      contactId: null,
      kind: "web",
      isOwner,
    });
  }

  test("an owner-subscribed journal is pushed at day 2 and never mailed after it", async () => {
    writeJournal("ana", { basis: "service", at: addDays(TODAY, -2) });
    await subscribe("ana", "https://push.example.test/owner", true);

    const dayTwo = await sweepFirstTrip({ dryRun: false });
    expect(dayTwo.acted).toEqual([["ana", "push"]]);
    expect(pushed).toEqual([{ template: "nudge.first.push", endpoints: ["https://push.example.test/owner"] }]);
    expect(fs.existsSync(path.join(data, "mail", "ana"))).toBe(false);

    // Three days later, still no trip: nothing — the push was the one reminder.
    const config = JSON.parse(fs.readFileSync(path.join(dir, "ana", "config.json"), "utf8"));
    config.owner.tips.at = addDays(TODAY, -5);
    fs.writeFileSync(path.join(dir, "ana", "config.json"), JSON.stringify(config));
    clearConfigCache();
    clearUserCache();
    const dayFive = await sweepFirstTrip({ dryRun: false });
    expect(dayFive.acted).toEqual([]);
    expect(pushed).toHaveLength(1);
    expect(fs.existsSync(path.join(data, "mail", "ana"))).toBe(false);
    const again = await sweepFirstTrip({ dryRun: false });
    expect(again.acted).toEqual([]);
  });

  test("a reader's subscription never counts as the owner's", async () => {
    writeJournal("ana", { basis: "service", at: addDays(TODAY, -3) });
    await subscribe("ana", "https://push.example.test/reader", false);

    const result = await sweepFirstTrip({ dryRun: false });
    expect(pushed).toEqual([]);
    expect(result.acted).toEqual([["ana", "mail"]]);
  });
});
