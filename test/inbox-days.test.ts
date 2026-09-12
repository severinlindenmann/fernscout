import { describe, expect, test, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  storeInboxFile,
  findInboxFile,
  dayInboxDir,
  listDayInbox,
  moveInboxFileToDay,
  findDayInboxFile,
  removeDayInboxFile,
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
