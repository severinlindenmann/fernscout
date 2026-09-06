import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { getTrip } from "@/lib/trips";
import { createTrip } from "@/lib/tripWrite";

/**
 * B540 — `listed` (and, by the same class of bug, `test`) accepted a string
 * and read it with `=== true` / `=== false`, so a value that was neither —
 * `"false"`, the shape a templating or serialisation bug plausibly produces —
 * fell through every branch as if the field had never been mentioned. On
 * `listed` that is dangerous in one direction only: an absent `listed` on a
 * public trip reads back as `listed: true` (`lib/trips.ts`), so
 * `"listed": "false"` produced a trip advertised in the sitemap, the feed and
 * the switcher — the opposite of what was asked, with no refusal.
 *
 * `checkTest` in lib/validate/entry.ts already refuses a non-boolean `test` on
 * a day rather than reading it as absent; `createTrip` now takes the same line
 * for both booleans on the trip-create path.
 */

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-trip-bool-"));
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

describe("createTrip refuses a non-boolean listed/test rather than coercing it", () => {
  test("a string \"false\" for listed is refused, not read as absent", () => {
    const made = createTrip("alex", {
      id: "reise",
      title: "Reise",
      start: "2026-08-24",
      end: "2026-08-26",
      visibility: "public",
      // @ts-expect-error — exactly the malformed shape a caller can send.
      listed: "false",
    });
    expect(made.ok, JSON.stringify(made)).toBe(false);
    if (!made.ok) expect(made.error).toBe("invalid_listed");
    // Nothing was written — the old bug's whole danger was that it fell
    // through silently and produced a trip that reads back listed anyway.
    expect(getTrip("alex/reise")).toBeUndefined();
  });

  test("a string \"true\" for test is refused, not read as absent", () => {
    const made = createTrip("alex", {
      id: "reise2",
      title: "Reise 2",
      start: "2026-08-24",
      end: "2026-08-26",
      // @ts-expect-error — exactly the malformed shape a caller can send.
      test: "true",
    });
    expect(made.ok, JSON.stringify(made)).toBe(false);
    if (!made.ok) expect(made.error).toBe("invalid_test");
    expect(getTrip("alex/reise2")).toBeUndefined();
  });

  test("the real booleans still work exactly as before", () => {
    const made = createTrip("alex", {
      id: "reise3",
      title: "Reise 3",
      start: "2026-08-24",
      end: "2026-08-26",
      visibility: "public",
      listed: false,
      test: true,
    });
    expect(made.ok, JSON.stringify(made)).toBe(true);
    const file = fs.readFileSync(path.join(dir, "alex", "trips", "reise3", "trip.md"), "utf8");
    expect(file).toContain("listed: false");
    expect(file).toContain("test: true");
  });
});
