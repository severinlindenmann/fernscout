import { describe, expect, test, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  readDayReadiness,
  writeDayReadiness,
  readWords,
  appendWords,
} from "@/lib/dayReadiness";

const SERVER_CFG =
  '{"site":{"name":"F","url":"https://example.test","defaultUser":"u"},"users":{"reserved":[]},"features":{}}';
const USER_CFG =
  '{"title":"F","tagline":"t","owner":{"name":"A B","nickname":"A"},"startLocation":"X","defaultLocale":"en","locales":["en"],"baseCurrency":"CHF","displayCurrencies":["CHF"],"units":"metric","features":{}}';

function journal(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "day-readiness-"));
  fs.writeFileSync(path.join(dir, "config.json"), SERVER_CFG);
  fs.mkdirSync(path.join(dir, "u"), { recursive: true });
  fs.writeFileSync(path.join(dir, "u", "config.json"), USER_CFG);
  process.env.CONTENT_DIR = dir;
  return dir;
}

afterEach(() => {
  delete process.env.CONTENT_DIR;
});

describe("readDayReadiness", () => {
  test("a date nobody has touched reads as nothing decided yet", () => {
    journal();
    const r = readDayReadiness("u", "2026-05-04");
    expect(r.without).toEqual([]);
    expect(r.unrecorded).toEqual([]);
    expect(r.weatherAsked).toBe(false);
    expect(r.location).toBeUndefined();
  });

  test("round-trips through writeDayReadiness", () => {
    journal();
    writeDayReadiness("u", "2026-05-04", { without: ["costs"], weatherAsked: true });
    const r = readDayReadiness("u", "2026-05-04");
    expect(r.without).toEqual(["costs"]);
    expect(r.weatherAsked).toBe(true);
  });

  test("a patch merges rather than replaces — a second write does not erase the first", () => {
    journal();
    writeDayReadiness("u", "2026-05-04", { without: ["costs"] });
    writeDayReadiness("u", "2026-05-04", { weatherAsked: true });
    const r = readDayReadiness("u", "2026-05-04");
    expect(r.without).toEqual(["costs"]);
    expect(r.weatherAsked).toBe(true);
  });

  test("location carries its source, same vocabulary as InboxMeta", () => {
    journal();
    writeDayReadiness("u", "2026-05-04", { location: { lat: 46.02, lon: 7.75, source: "browser" } });
    expect(readDayReadiness("u", "2026-05-04").location?.source).toBe("browser");
  });
});

describe("words.md", () => {
  test("starts empty, and each appendWords call adds a paragraph", () => {
    journal();
    expect(readWords("u", "2026-05-04")).toBe("");
    appendWords("u", "2026-05-04", "We arrived late.");
    appendWords("u", "2026-05-04", "The hotel was full of cats.");
    expect(readWords("u", "2026-05-04")).toBe("We arrived late.\n\nThe hotel was full of cats.");
  });
});
