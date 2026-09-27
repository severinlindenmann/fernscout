import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { writeTripFixture } from "./fixtures/content";
import { readTripFile, writeTripFile } from "@/lib/api/v2/store";
import { clearConfigCache } from "@/lib/config";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { sweepReminders } from "@/lib/digest/reminder";
import { listMessages } from "@/lib/messages/log";
import { isSwitchedOff, listSwitches, setSwitch, SwitchRefused } from "@/lib/messages/switches";
import { earliestTodayISO } from "@/lib/tripTime";
import { clearUserCache } from "@/lib/users";

/**
 * B2446 — the operator's per-message-kind switch, and the gate every real
 * send path now consults (`lib/mail/index.ts` `sendMail`, `lib/sms/index.ts`
 * `sendSms`, `lib/push/send.ts` `sendPush`). Exercised end to end through
 * the nightly reminder sweep — the ticket's own acceptance line — rather
 * than by mocking the gate: `sweepReminders` calling `sendMail` is the real
 * path from a trigger to a skip.
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
  clearConfigCache();
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
  clearConfigCache();
  clearUserCache();
}

function writeTrip(username: string, id: string, start: string, end: string) {
  writeTripFixture(username, { id, title: id, start, end, visibility: "private", intro: "Intro." });
  const stored = readTripFile(username, id);
  writeTripFile(username, id, { ...stored!, reminder: { channel: "mail" } });
  fs.mkdirSync(path.join(dir, username, "trips", id, "entries"), { recursive: true });
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-msgswitch-"));
  data = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-msgswitch-data-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = data;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "test-secret-for-message-switches";
  writeSiteConfig();
  await migrateToLatest(await getDatabase());
  vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATA_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.SESSION_SECRET;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(data, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("message switches", () => {
  test("a required template refuses to be switched off", async () => {
    await expect(setSwitch("code.mail", true, "admin@example.test")).rejects.toThrow(SwitchRefused);
    expect(await isSwitchedOff("code.mail")).toBe(false);
  });

  test("an optional/service template can be switched off and back on, and is listed while off", async () => {
    await setSwitch("nudge.evening", true, "admin@example.test");
    expect(await isSwitchedOff("nudge.evening")).toBe(true);
    expect((await listSwitches()).map((r) => r.key)).toContain("nudge.evening");

    await setSwitch("nudge.evening", false, "admin@example.test");
    expect(await isSwitchedOff("nudge.evening")).toBe(false);
    expect((await listSwitches()).map((r) => r.key)).not.toContain("nudge.evening");
  });

  test("switching nudge.evening off makes the reminder sweep log a skip and send nothing", async () => {
    writeJournal("ana");
    writeTrip("ana", "spain", YESTERDAY, TOMORROW);
    await setSwitch("nudge.evening", true, "admin@example.test");

    const result = await sweepReminders({ dryRun: false });
    expect(result.sent).toBe(0);
    expect(fs.existsSync(path.join(data, "mail", "ana"))).toBe(false);

    const rows = await listMessages({ template: "nudge.evening" });
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("skipped");
    expect(rows[0].reason).toBe("switched_off:operator");
  });

  test("with the switch back on, the same trip is nudged normally", async () => {
    writeJournal("ana");
    writeTrip("ana", "spain", YESTERDAY, TOMORROW);
    await setSwitch("nudge.evening", true, "admin@example.test");
    await setSwitch("nudge.evening", false, "admin@example.test");

    const result = await sweepReminders({ dryRun: false });
    expect(result.sent).toBe(1);
  });
});
