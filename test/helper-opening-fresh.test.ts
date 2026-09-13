import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { openingFor } from "@/lib/helper/opening";
import { writeDayFixture, writeTripFixture } from "./fixtures/content";

/**
 * A trip with no days is `fresh`, never `clear` — B1188.
 *
 * The `clear` state formats its last date, and a journal whose one trip had
 * no days yet fell into it with no date at all: the very first thing a new
 * owner read after making their trip was "the last of it undefined, NaN
 * undefined", live, in a persona round.
 */

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-opening-"));
  process.env.CONTENT_DIR = dir;
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({ site: { name: "T", url: "https://t.test" } }),
  );
  fs.mkdirSync(path.join(dir, "alex"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "alex", "config.json"),
    JSON.stringify({
      title: "alex",
      tagline: "t",
      owner: { name: "A B", nickname: "A", email: "alex@example.test" },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
    }),
  );
  writeTripFixture("alex", {
    id: "alpine-crossing-2026",
    title: "Alpine crossing",
    start: "2026-09-09",
    end: "2026-09-14",
    visibility: "private",
  });
  clearConfigCache();
  clearUserCache();
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  fs.rmSync(dir, { recursive: true, force: true });
});

test("a trip with no days opens fresh, named, with no NaN anywhere", () => {
  const opening = openingFor("alex", "2026-09-09");
  expect(opening).toEqual({ state: "fresh", title: "Alpine crossing" });
});

test("one written day moves it out of fresh", () => {
  writeDayFixture(dir, "alex", "alpine-crossing-2026", {
    slug: "pass",
    date: "2026-09-09",
    title: "Pass",
    content: "Walked.",
  });
  const opening = openingFor("alex", "2026-09-20");
  expect(opening.state).not.toBe("fresh");
});
