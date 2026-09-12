import { describe, expect, test, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  storeInboxFile,
  findInboxFile,
  dayInboxDir,
  inboxDir,
  listDayInbox,
  moveInboxFileToDay,
  moveInboxFileFromDay,
  findDayInboxFile,
  removeDayInboxFile,
  updateInboxMeta,
} from "@/lib/inbox";

const SERVER_CFG =
  '{"site":{"name":"F","url":"https://example.test","defaultUser":"u"},"users":{"reserved":[]},"features":{}}';
const USER_CFG =
  '{"title":"F","tagline":"t","owner":{"name":"A B","nickname":"A"},"startLocation":"X","defaultLocale":"en","locales":["en"],"baseCurrency":"CHF","displayCurrencies":["CHF"],"units":"metric","features":{}}';

function journal(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "inbox-days-"));
  fs.writeFileSync(path.join(dir, "config.json"), SERVER_CFG);
  fs.mkdirSync(path.join(dir, "u"), { recursive: true });
  fs.writeFileSync(path.join(dir, "u", "config.json"), USER_CFG);
  process.env.CONTENT_DIR = dir;
  return dir;
}

afterEach(() => {
  delete process.env.CONTENT_DIR;
});

describe("moveInboxFileToDay", () => {
  test("moves a flat-bucket file's bytes and sidecar into the date folder, keeping its id", () => {
    journal();
    const { entry } = storeInboxFile("u", "media", "sunset.jpg", Buffer.from("bytes"), { lat: 1, lon: 2 });
    const moved = moveInboxFileToDay("u", entry.id, "2026-05-04");
    expect(moved?.entry.id).toBe(entry.id);
    expect(moved?.entry.lat).toBe(1); // the sidecar's facts survive the move

    // Gone from the flat bucket.
    expect(findInboxFile("u", entry.id)).toBeNull();
    // Present in the date folder.
    const there = findDayInboxFile("u", "2026-05-04", entry.id);
    expect(there?.entry.id).toBe(entry.id);
    expect(fs.existsSync(path.join(dayInboxDir("u", "2026-05-04", "media"), entry.id))).toBe(true);
  });

  test("an id already dated, or never staged, moves nothing and answers null", () => {
    journal();
    expect(moveInboxFileToDay("u", "no-such-id.jpg", "2026-05-04")).toBeNull();
  });
});

describe("listDayInbox", () => {
  test("lists only what has been moved into this date, grouped by kind", () => {
    journal();
    const { entry: a } = storeInboxFile("u", "media", "a.jpg", Buffer.from("a"), {});
    storeInboxFile("u", "media", "b.jpg", Buffer.from("b"), {}); // stays undated
    moveInboxFileToDay("u", a.id, "2026-05-04");
    const day = listDayInbox("u", "2026-05-04");
    expect(day.media.map((e) => e.id)).toEqual([a.id]);
    expect(day.files).toEqual([]);
  });

  test("an unknown date reads as empty, not as an error", () => {
    journal();
    expect(listDayInbox("u", "2099-01-01").media).toEqual([]);
  });
});

describe("removeDayInboxFile", () => {
  test("takes a file out of the date folder, bytes and sidecar both", () => {
    journal();
    const { entry } = storeInboxFile("u", "media", "c.jpg", Buffer.from("c"), {});
    moveInboxFileToDay("u", entry.id, "2026-05-04");
    expect(removeDayInboxFile("u", "2026-05-04", entry.id)).toBe(true);
    expect(findDayInboxFile("u", "2026-05-04", entry.id)).toBeNull();
    expect(removeDayInboxFile("u", "2026-05-04", entry.id)).toBe(false); // already gone
  });
});

describe("moveInboxFileFromDay", () => {
  test("moves a staged file back to the flat bucket, bytes and sidecar both — the inverse of moveInboxFileToDay", () => {
    journal();
    const { entry } = storeInboxFile("u", "contact", "friend.vcf", Buffer.from("BEGIN:VCARD"), {});
    moveInboxFileToDay("u", entry.id, "2026-05-04");
    expect(findDayInboxFile("u", "2026-05-04", entry.id)).not.toBeNull();

    const back = moveInboxFileFromDay("u", "2026-05-04", entry.id);
    expect(back?.entry.id).toBe(entry.id);
    expect(findDayInboxFile("u", "2026-05-04", entry.id)).toBeNull();
    expect(findInboxFile("u", entry.id)).not.toBeNull();
    expect(fs.existsSync(path.join(inboxDir("u", "contact"), entry.id))).toBe(true);
  });

  test("an id not staged for that date moves nothing and answers null", () => {
    journal();
    expect(moveInboxFileFromDay("u", "2026-05-04", "no-such-id.jpg")).toBeNull();
  });
});

describe("updateInboxMeta", () => {
  test("merges a patch into a date-folder sidecar without moving the file", () => {
    journal();
    const { entry } = storeInboxFile("u", "media", "a.jpg", Buffer.from("a"), {});
    moveInboxFileToDay("u", entry.id, "2026-05-04");
    expect(updateInboxMeta("u", entry.id, { caption: "The pass" }, "2026-05-04")).toBe(true);
    const found = findDayInboxFile("u", "2026-05-04", entry.id);
    expect(found?.entry.caption).toBe("The pass");
    expect(found?.entry.filename).toBe("a.jpg"); // the rest of the sidecar survives
  });

  test("merges a patch into a flat-bucket sidecar when no date is given", () => {
    journal();
    const { entry } = storeInboxFile("u", "media", "b.jpg", Buffer.from("b"), {});
    expect(updateInboxMeta("u", entry.id, { descriptionAsked: true })).toBe(true);
    expect(findInboxFile("u", entry.id)?.entry.descriptionAsked).toBe(true);
  });

  test("an id nowhere in the place named answers false", () => {
    journal();
    expect(updateInboxMeta("u", "no-such-id.jpg", { caption: "x" }, "2026-05-04")).toBe(false);
  });
});
