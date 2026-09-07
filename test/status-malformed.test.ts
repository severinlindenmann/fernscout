import { afterEach, beforeEach, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { issueCode, verifyCode } from "@/lib/auth";
import { tripWriteScope } from "@/lib/tripPeople";
import { GET as statusRoute } from "@/app/api/v1/[user]/status/route";

/**
 * B288 — `/status` did not carry a broken `trip.md`, though `GET .../trips`
 * already did (B83). An agent that had just written a trip and got a
 * malformed file back saw `/status` report the rest of the journal as though
 * nothing had gone wrong, and had no way to learn from the one call the guide
 * tells it to make first.
 */

let dir: string;
const OWNER_EMAIL = "robin@example.test";
const BUDDY_EMAIL = "buddy@example.test";

function journal() {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://t.test", defaultUser: "robin" },
      users: { reserved: [] },
      features: { auth: { enabled: true } },
    }),
  );
  fs.mkdirSync(path.join(dir, "robin"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "robin", "config.json"),
    JSON.stringify({
      title: "Robin",
      tagline: "t",
      owner: { name: "R", nickname: "R", email: OWNER_EMAIL },
      startLocation: "X",
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      displayCurrencies: ["CHF"],
      units: "metric",
      features: {},
    }),
  );
}

function writeGoodTrip(id: string, people: string[] = []) {
  fs.mkdirSync(path.join(dir, "robin", "trips", id, "entries"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "robin", "trips", id, "trip.md"),
    [
      "---",
      `id: "${id}"`,
      `title: "${id}"`,
      'start: "2026-01-01"',
      'end: "2026-01-05"',
      "status: past",
      "visibility: public",
      ...(people.length
        ? ["people:", ...people.flatMap((email) => [`  - name: "B"`, `    email: "${email}"`])]
        : []),
      "---",
      "",
      "Intro.",
      "",
    ].join("\n"),
  );
}

function writeBrokenTrip(folder: string) {
  fs.mkdirSync(path.join(dir, "robin", "trips", folder), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "robin", "trips", folder, "trip.md"),
    ["---", "id: [unterminated", "---", "", "x", ""].join("\n"),
  );
}

async function ownerToken(): Promise<string> {
  const { code } = await issueCode("robin", OWNER_EMAIL, "agent");
  const verified = await verifyCode("robin", OWNER_EMAIL, code, "agent");
  if (!verified.ok) throw new Error("no owner token");
  return verified.token;
}

async function scopedToken(trip: string): Promise<string> {
  const { code } = await issueCode("robin", BUDDY_EMAIL, "agent", { trip });
  const verified = await verifyCode("robin", BUDDY_EMAIL, code, "agent", tripWriteScope(trip));
  if (!verified.ok) throw new Error("no scoped token");
  return verified.token;
}

async function status(token: string) {
  const response = await statusRoute(
    new Request("https://t.test/api/v1/robin/status", {
      headers: { authorization: `Bearer ${token}` },
    }),
    { params: Promise.resolve({ user: "robin" }) },
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-status-malformed-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "status-malformed-test-secret-b288";
  journal();
  clearConfigCache();
  clearUserCache();
  await migrateToLatest(await getDatabase());
});

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.SESSION_SECRET;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("an owner token is told about a trip.md that failed to load, and next says to fix it first", async () => {
  writeGoodTrip("alps-2026", [BUDDY_EMAIL]);
  writeBrokenTrip("broken-2026");

  const { status: code, body } = await status(await ownerToken());
  expect(code).toBe(200);
  expect(body.malformed).toBeTruthy();
  expect((body.malformed as { folder: string }[])[0].folder).toBe("broken-2026");
  expect(body.next).toContain("broken trip.md");
});

test("a trip-scoped token sees nothing about it, matching GET .../trips", async () => {
  writeGoodTrip("alps-2026", [BUDDY_EMAIL]);
  writeBrokenTrip("broken-2026");

  const { status: code, body } = await status(await scopedToken("alps-2026"));
  expect(code).toBe(200);
  expect(body.malformed).toBeUndefined();
  expect(body.next).not.toContain("broken trip.md");
});

test("with nothing broken, the key is absent rather than an empty list", async () => {
  writeGoodTrip("alps-2026");
  const { body } = await status(await ownerToken());
  expect(body.malformed).toBeUndefined();
});
