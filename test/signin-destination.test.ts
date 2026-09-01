import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";

/**
 * B69, end to end: the button in the mail, and where the browser is sent.
 *
 * `test/auth.test.ts` covers the rule — a destination is stored beside the
 * link and re-checked when the link is redeemed. This file asserts the thing a
 * reader would actually notice, which is the `Location` header on
 * `/<user>/s/<token>`. The two halves are worth keeping apart: the unit tests
 * would still pass if the route ignored `result.destination` altogether, which
 * is exactly the bug being fixed.
 */

/** The route sets a cookie. Nothing here reads one. */
vi.mock("next/headers", () => ({
  cookies: async () => ({ set: () => {}, get: () => undefined }),
}));

const OWNER = "ana";
const OTHER = "bea";
const READER = "reader@example.test";
const SITE = "https://example.test";

let dir: string;

function writeJournal(username: string, tripIds: string[]) {
  fs.mkdirSync(path.join(dir, username), { recursive: true });
  fs.writeFileSync(
    path.join(dir, username, "config.json"),
    JSON.stringify({
      title: "Two Backpacks",
      owner: { name: "Ana Meyer", nickname: "Ana", email: `${username}@example.test` },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      features: { auth: { enabled: true } },
    }),
  );
  for (const id of tripIds) {
    const root = path.join(dir, username, "trips", id);
    fs.mkdirSync(path.join(root, "entries"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "trip.md"),
      [
        "---",
        `id: "${id}"`,
        `title: "${id}"`,
        'start: "2026-08-25"',
        'end: "2026-08-26"',
        'status: "past"',
        'visibility: "private"',
        "---",
        "",
        "Intro.",
        "",
      ].join("\n"),
    );
  }
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-signin-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "auth.db")}`;
  // `auth` is a capability, and capabilities are absent rather than broken
  // when their environment is missing — without this the route is a 404.
  process.env.SESSION_SECRET = "test-secret-for-signin-destination";

  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: SITE, defaultUser: OWNER },
      users: { reserved: [] },
      features: { auth: { enabled: true } },
    }),
  );
  writeJournal(OWNER, ["vietnam-2026"]);
  writeJournal(OTHER, ["theirs-2026"]);
  clearConfigCache();
  clearUserCache();

  const { migrateToLatest } = await import("@/lib/db/migrate");
  await migrateToLatest(await getDatabase());
});

afterEach(async () => {
  await closeDatabase();
  fs.rmSync(dir, { recursive: true, force: true });
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.SESSION_SECRET;
  clearConfigCache();
  clearUserCache();
});

/** Follow the link, and say where the browser was told to go. */
async function follow(linkToken: string): Promise<string | null> {
  const route = await import("@/app/[user]/s/[token]/route");
  const response = await route.GET(new Request(`${SITE}/${OWNER}/s/${linkToken}`), {
    params: Promise.resolve({ user: OWNER, token: linkToken }),
  });
  return response.headers.get("location");
}

/** A code for the reader, optionally asked for from a particular page. */
async function askFrom(destination?: string): Promise<string> {
  const { issueCode } = await import("@/lib/auth");
  const { linkToken } = await issueCode(OWNER, READER, "guest", destination);
  if (!linkToken) throw new Error("a guest code should carry a link");
  return linkToken;
}

/** Puts a value in the row that the check on the way in would have refused. */
async function forceStored(value: string) {
  const { db } = await getDatabase();
  await db.updateTable("login_codes").set({ link_dest: value }).execute();
}

describe("the one-tap sign-in link", () => {
  test("signing in from a trip lands back on that trip", async () => {
    const token = await askFrom(`/${OWNER}/trips/vietnam-2026`);
    expect(await follow(token)).toBe(`${SITE}/${OWNER}/trips/vietnam-2026`);
  });

  test("a day inside a gated trip is kept, not rounded up to the trip", async () => {
    // The gate renders in place of whatever page was asked for, so the reader
    // who clicked a link to one day should get that day back.
    const token = await askFrom(`/${OWNER}/day/2026-08-25-hanoi`);
    expect(await follow(token)).toBe(`${SITE}/${OWNER}/day/2026-08-25-hanoi`);
  });

  test("signing in from /<user>/me still lands on the journal", async () => {
    // `/me` sends no destination at all — it is the page whose whole question
    // is "what can I see?", and the journal is the answer.
    const token = await askFrom();
    expect(await follow(token)).toBe(`${SITE}/${OWNER}`);
  });

  test.each([
    ["off-site", "https://evil.test/phish"],
    ["protocol-relative, so still off-site", "//evil.test/phish"],
    ["another journal on this instance", `/${OTHER}/trips/theirs-2026`],
    ["a climb out of the journal", `/${OWNER}/../${OTHER}/trips/theirs-2026`],
  ])(
    "a stored destination pointing %s is refused and lands on the journal",
    async (_label, crafted) => {
      const token = await askFrom();
      await forceStored(crafted);
      expect(await follow(token)).toBe(`${SITE}/${OWNER}`);
    },
  );

  test("a trip deleted while the mail sat unread lands on the journal, not a 404", async () => {
    const token = await askFrom(`/${OWNER}/trips/vietnam-2026`);
    fs.rmSync(path.join(dir, OWNER, "trips", "vietnam-2026"), { recursive: true, force: true });
    clearUserCache();
    expect(await follow(token)).toBe(`${SITE}/${OWNER}`);
  });

  test("a spent link still goes to the page that can issue a new one", async () => {
    const token = await askFrom(`/${OWNER}/trips/vietnam-2026`);
    expect(await follow(token)).toBe(`${SITE}/${OWNER}/trips/vietnam-2026`);
    // Second time: the link is burned, and the destination must not turn an
    // expired-link message into a silent bounce to the trip.
    expect(await follow(token)).toBe(`${SITE}/${OWNER}/me?signin=expired`);
  });
});
