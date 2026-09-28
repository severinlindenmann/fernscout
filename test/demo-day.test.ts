import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { writeDayFixture, writeTripFixture } from "./fixtures/content";

/**
 * B2550 — the signed-out landing's own demo card (`lib/demoDay.ts`) links
 * into a real day of a real public journal, same as the signed-in home's
 * "latest day" card (`lib/viewer.ts`). Both go through the same 307 when the
 * day belongs to the current trip and the link still spells out
 * `/trips/<id>/day/<slug>`, so both get the same bare-address fix.
 */

const USER = "dana";

let dir: string;

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "demo-day-"));
  process.env.CONTENT_DIR = dir;

  fs.mkdirSync(path.join(dir, USER), { recursive: true });
  fs.writeFileSync(
    path.join(dir, USER, "config.json"),
    JSON.stringify({
      title: "Dana's journal",
      tagline: "A tagline.",
      owner: { name: "Dana", nickname: "Dana", email: "dana@example.test" },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      visibility: "public",
    }),
  );

  writeTripFixture(USER, { id: "now-2026", start: "2020-01-01", end: "2099-01-01", status: "current" });

  const media = path.join(dir, USER, "trips", "now-2026", "media");
  fs.mkdirSync(media, { recursive: true });
  fs.writeFileSync(path.join(media, "today.jpg"), "x");

  writeDayFixture(dir, USER, "now-2026", {
    slug: "today",
    date: "2026-09-27",
    title: "Today",
    content: "Something worth reading, long enough to be an excerpt.",
    media: [{ src: "media/today.jpg" }],
  });

  const { clearConfigCache } = await import("@/lib/config");
  const { clearUserCache } = await import("@/lib/users");
  clearConfigCache();
  clearUserCache();
});

afterAll(() => {
  delete process.env.CONTENT_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("demoDay", () => {
  test("a current trip's day links at the bare address, not the one that 307s", async () => {
    const { demoDay } = await import("@/lib/demoDay");
    const demo = demoDay("en");
    expect(demo?.href).toBe(`/@${USER}/day/today`);
  });
});
