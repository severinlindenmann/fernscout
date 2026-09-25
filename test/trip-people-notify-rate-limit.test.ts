import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { resetRateLimitsForTests } from "@/lib/rateLimit";
import { notifyNewPeople } from "@/lib/api/v2/trips";

/**
 * B1689 — `notifyNewPeople` mails whoever is newly named in a trip's
 * `people:`, and the address is chosen anew on every write. Nothing stopped
 * a write token toggling the same outside address on and off `people:` to
 * resend the "you've been added" mail as fast as writes allow. This pins the
 * bucket added to close it: repeated calls with the same `before: []` (as a
 * toggle-on-toggle-off write sequence would produce) stop sending fresh mail
 * to that address once the bucket is spent, without touching any other
 * address.
 */

const OWNER = "alex";
const OWNER_EMAIL = "alex@example.test";

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-notify-"));
  process.env.CONTENT_DIR = dir;
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "F", url: "https://example.test", defaultUser: OWNER },
      users: { reserved: [] },
      features: { mail: { enabled: true, transport: "file" } },
    }),
  );
  fs.mkdirSync(path.join(dir, OWNER, "trips"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title: "Two Backpacks",
      tagline: "t",
      owner: { name: "Alex B", nickname: "Alex", email: OWNER_EMAIL },
      startLocation: "X",
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      displayCurrencies: ["CHF"],
      units: "metric",
      features: { mail: { enabled: true } },
    }),
  );
  clearConfigCache();
  clearUserCache();
  resetRateLimitsForTests();
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  clearConfigCache();
  clearUserCache();
  resetRateLimitsForTests();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("notifyNewPeople rate limit", () => {
  test("stops mailing the same address once its bucket is spent, across repeated writes", async () => {
    const person = { name: "Robin", email: "robin@example.test" };

    // Four writes that each look like the address was just (re-)added —
    // exactly what toggling it on and off `people:` produces.
    const results = [];
    for (let i = 0; i < 4; i++) {
      results.push(await notifyNewPeople(OWNER, "Vietnam 2026", [person], []));
    }

    const sent = results.filter((r) => r.length === 1);
    const refused = results.filter((r) => r.length === 0);
    expect(sent).toHaveLength(3);
    expect(refused).toHaveLength(1);
  });

  test("does not throttle a different address sharing the same window", async () => {
    const robin = { name: "Robin", email: "robin2@example.test" };
    const dana = { name: "Dana", email: "dana2@example.test" };

    for (let i = 0; i < 3; i++) {
      await notifyNewPeople(OWNER, "Vietnam 2026", [robin], []);
    }
    expect(await notifyNewPeople(OWNER, "Vietnam 2026", [robin], [])).toEqual([]);

    // Dana's bucket is untouched by Robin spending hers.
    expect(await notifyNewPeople(OWNER, "Vietnam 2026", [dana], [])).toEqual([
      { email: "dana2@example.test", kind: "journal-invite" },
    ]);
  });
});
