import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import { writeTripFixture, writeDayFixture } from "./fixtures/content";
import { readTripFile, writeTripFile } from "@/lib/api/v2/store";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { earliestTodayISO } from "@/lib/tripTime";
import { patchTripReminder, readTripReminder } from "@/lib/api/tripReminder";
import { dueTrips, sweepReminders } from "@/lib/digest/reminder";

/**
 * B1219, D46 — the evening reminder: the on/off switch (`trip/reminder`,
 * `lib/api/tripReminder.ts`) and the nightly sweep that actually sends one
 * (`lib/digest/reminder.ts`, run by `scripts/reminders.mts`).
 *
 * Dates are computed off `earliestTodayISO()` rather than hardcoded, so the
 * suite keeps meaning the same thing on the day it happens to run.
 */

const TODAY = earliestTodayISO();

function addDays(iso: string, delta: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

const YESTERDAY = addDays(TODAY, -1);
const TOMORROW = addDays(TODAY, 1);

let dir: string;
let data: string;

function writeSiteConfig() {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "Testbed", url: "https://example.test" },
      features: { mail: { enabled: true }, helper: { enabled: true } },
    }),
  );
}

function writeJournal(username: string) {
  fs.mkdirSync(path.join(dir, username, "trips"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, username, "config.json"),
    JSON.stringify({
      title: username,
      owner: { name: "Owner", nickname: "O", email: `${username}@example.test` },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
    }),
  );
}

/**
 * A trip, opted into a reminder or not, running the dates given.
 *
 * Goes through the shared fixture and then merges `reminder` onto the written
 * document — D18 gave the setting a home on the trip (`reminder: {channel}`,
 * where presence is the switch), but `createTrip` still has no argument for
 * it, so this is the same door `test/costs-projection.test.tsx` uses for a
 * trip's budget. What it must not do is hand-roll the file: this file's whole
 * subject is a setting that was, until D18, written into a `trip.md` nothing
 * read, and a fixture writing its own bytes is exactly how that went unnoticed.
 */
function writeTrip(
  username: string,
  id: string,
  start: string,
  end: string,
  reminder?: "mail" | "whatsapp",
) {
  writeTripFixture(username, {
    id,
    title: id,
    start,
    end,
    visibility: "private",
    intro: "Intro.",
  });
  if (reminder) {
    const stored = readTripFile(username, id);
    writeTripFile(username, id, { ...stored!, reminder: { channel: reminder } });
  }
  fs.mkdirSync(path.join(dir, username, "trips", id, "entries"), { recursive: true });
}

function writeEntry(username: string, tripId: string, date: string, status: "draft" | "published") {
  writeDayFixture(dir, username, tripId, {
    slug: "day",
    date,
    title: "A day",
    content: "Words.",
    ...(status === "draft" ? { status: "draft" as const } : {}),
  });
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-reminders-"));
  data = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-reminders-data-"));
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

describe("the on/off switch (lib/api/tripReminder.ts)", () => {
  test("turns on with a channel, and reads back", () => {
    writeJournal("ana");
    writeTrip("ana", "spain", YESTERDAY, TOMORROW);
    const result = patchTripReminder("ana/spain", { enabled: true, channel: "mail" });
    expect(result).toMatchObject({ ok: true, enabled: true, channel: "mail" });
    expect(readTripReminder("ana/spain")).toEqual({ enabled: true, channel: "mail" });
  });

  test("turns off, clearing the channel too", () => {
    writeJournal("ana");
    writeTrip("ana", "spain", YESTERDAY, TOMORROW, "mail");
    const result = patchTripReminder("ana/spain", { enabled: false });
    expect(result).toMatchObject({ ok: true, enabled: false, channel: null });
    expect(readTripReminder("ana/spain")).toEqual({ enabled: false, channel: null });
    expect(readTripFile("ana", "spain")?.reminder).toBeUndefined();
    // Turning it off leaves nothing behind on disk either. v1 cleared two
    // scalars and could strand one; D18's single field cannot be half-cleared,
    // and this reads the written bytes rather than the parsed document so a
    // stranded key would still be caught.
    const onDisk = fs.readFileSync(path.join(dir, "ana", "trips", "spain", "trip.json"), "utf8");
    expect(onDisk).not.toContain("reminder");
  });

  test("refuses whatsapp on an instance with no reminder template configured", () => {
    writeJournal("ana");
    writeTrip("ana", "spain", YESTERDAY, TOMORROW);
    const result = patchTripReminder("ana/spain", { enabled: true, channel: "whatsapp" });
    expect(result).toMatchObject({ ok: false, error: "channel_unavailable" });
    expect(readTripReminder("ana/spain")).toEqual({ enabled: false, channel: null });
  });

  test("refuses an unknown trip", () => {
    writeJournal("ana");
    expect(patchTripReminder("ana/nowhere", { enabled: true })).toMatchObject({
      ok: false,
      error: "unknown_trip",
    });
  });
});

describe("the nightly sweep (lib/digest/reminder.ts)", () => {
  test("a running trip with nothing written today is due", () => {
    writeJournal("ana");
    writeTrip("ana", "spain", YESTERDAY, TOMORROW, "mail");
    const due = dueTrips("ana", TODAY);
    expect(due.map((t) => t.id)).toEqual(["spain"]);
  });

  test("a day already written today is not due, draft included", () => {
    writeJournal("ana");
    writeTrip("ana", "spain", YESTERDAY, TOMORROW, "mail");
    writeEntry("ana", "spain", TODAY, "draft");
    expect(dueTrips("ana", TODAY)).toEqual([]);
  });

  test("a trip outside its own date range is not due", () => {
    writeJournal("ana");
    writeTrip("ana", "spain", addDays(TODAY, -10), addDays(TODAY, -2), "mail");
    expect(dueTrips("ana", TODAY)).toEqual([]);
  });

  test("a trip that never opted in is not due", () => {
    writeJournal("ana");
    writeTrip("ana", "spain", YESTERDAY, TOMORROW);
    expect(dueTrips("ana", TODAY)).toEqual([]);
  });

  test("sends exactly one mail for a missing day, and marks the journal nudged", async () => {
    writeJournal("ana");
    writeTrip("ana", "spain", YESTERDAY, TOMORROW, "mail");

    const result = await sweepReminders({ dryRun: false });
    expect(result.sent).toBe(1);
    expect(result.notified).toEqual([["ana", "ana/spain", "mail"]]);

    const mailFiles = fs.readdirSync(path.join(data, "mail", "ana"));
    expect(mailFiles).toHaveLength(1);
  });

  test("never sends twice in one day, even run again immediately", async () => {
    writeJournal("ana");
    writeTrip("ana", "spain", YESTERDAY, TOMORROW, "mail");

    await sweepReminders({ dryRun: false });
    const second = await sweepReminders({ dryRun: false });
    expect(second.sent).toBe(0);

    const mailFiles = fs.readdirSync(path.join(data, "mail", "ana"));
    expect(mailFiles).toHaveLength(1);
  });

  test("one journal running two due trips still gets one nudge, not two", async () => {
    writeJournal("ana");
    writeTrip("ana", "spain", YESTERDAY, TOMORROW, "mail");
    writeTrip("ana", "italy", YESTERDAY, TOMORROW, "mail");

    const result = await sweepReminders({ dryRun: false });
    expect(result.sent).toBe(1);
    const mailFiles = fs.readdirSync(path.join(data, "mail", "ana"));
    expect(mailFiles).toHaveLength(1);
  });

  test("a written day sends nothing", async () => {
    writeJournal("ana");
    writeTrip("ana", "spain", YESTERDAY, TOMORROW, "mail");
    writeEntry("ana", "spain", TODAY, "published");

    const result = await sweepReminders({ dryRun: false });
    expect(result.sent).toBe(0);
    expect(fs.existsSync(path.join(data, "mail", "ana"))).toBe(false);
  });

  test("--dry-run sends nothing and does not mark the journal nudged", async () => {
    writeJournal("ana");
    writeTrip("ana", "spain", YESTERDAY, TOMORROW, "mail");

    const dry = await sweepReminders({ dryRun: true });
    expect(dry.sent).toBe(0);
    expect(dry.notified).toEqual([["ana", "ana/spain", "mail"]]);
    expect(fs.existsSync(path.join(data, "mail", "ana"))).toBe(false);

    // A real run right after behaves as though the dry run never happened.
    const real = await sweepReminders({ dryRun: false });
    expect(real.sent).toBe(1);
  });
});
