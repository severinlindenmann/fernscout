import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { getTrip } from "@/lib/trips";
import { createTrip } from "@/lib/tripWrite";

/**
 * B553 — `people[]` tolerated an unknown key and silently dropped it, while
 * `travellers[]` right beside it refuses one with `invalid_travellers`. Same
 * call, two answers to the same mistake. `people[]` now refuses an unknown
 * key by name too, the same way `travellersBlock` already does for a figure.
 */

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-trip-people-"));
  process.env.CONTENT_DIR = dir;
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({ site: { name: "T", url: "https://t.test", defaultUser: "alex" }, features: {} }),
  );
  fs.mkdirSync(path.join(dir, "alex"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "alex", "config.json"),
    JSON.stringify({
      title: "Alex",
      tagline: "t",
      owner: { name: "A B", nickname: "A" },
      defaultLocale: "en",
      locales: ["en"],
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

describe("createTrip refuses an unknown key inside a people[] entry", () => {
  test("an unknown key is refused, named, rather than dropped", () => {
    const made = createTrip("alex", {
      id: "reise",
      title: "Reise",
      start: "2026-08-24",
      end: "2026-08-26",
      visibility: "public",
      people: [{ name: "Ana Meyer", email: "ana@example.test", role: "guide" }],
    });
    expect(made.ok, JSON.stringify(made)).toBe(false);
    if (!made.ok) {
      expect(made.error).toBe("invalid_people");
      expect(made.message).toMatch(/"role"/);
    }
    // Nothing was written — the old bug's whole danger was that the entry
    // was accepted with the key silently thrown away.
    expect(getTrip("alex/reise")).toBeUndefined();
  });

  test("name and email alone are still accepted", () => {
    const made = createTrip("alex", {
      id: "reise2",
      title: "Reise 2",
      start: "2026-08-24",
      end: "2026-08-26",
      visibility: "public",
      people: [{ name: "Ana Meyer", email: "ana@example.test" }],
    });
    expect(made.ok, JSON.stringify(made)).toBe(true);
  });

  test("name, email and nickname are still accepted", () => {
    const made = createTrip("alex", {
      id: "reise3",
      title: "Reise 3",
      start: "2026-08-24",
      end: "2026-08-26",
      visibility: "public",
      people: [{ name: "Ana Meyer", email: "ana@example.test", nickname: "Ana" }],
    });
    expect(made.ok, JSON.stringify(made)).toBe(true);
  });
});
