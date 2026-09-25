import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { issueCode } from "@/lib/auth";
import {
  addSelfContact,
  approveContact,
  confirmContact,
  grantContactAccess,
  requestContact,
  revokeContact,
} from "@/lib/contacts";
import { readersModel } from "@/lib/readers/model";
import { buildStudioHubModel } from "@/lib/studio/hub";
import { writeTripFixture } from "./fixtures/content";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => ({ get: () => null }),
}));

/**
 * B2133 — one model of who reads a journal, split by whose turn it is. The
 * hub's chip, the readers page and the invite section all read it; the chip
 * once counted every pending row while the page counted only confirmed ones.
 */
const OWNER = "alex";
const OWNER_EMAIL = "alex@example.test";
let dir: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-readers-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "readers.db")}`;
  process.env.CONTACTS_ENCRYPTION_KEY = "11".repeat(32);
  process.env.SESSION_SECRET = "readers-model-test-secret";
  delete process.env.AUTH_DEV_CODE;
  const features = { auth: { enabled: true }, contacts: { enabled: true } };
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({ site: { name: "R", url: "https://example.test", defaultUser: OWNER }, users: { reserved: [] }, features }),
  );
  fs.mkdirSync(path.join(dir, OWNER), { recursive: true });
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title: "T",
      owner: { name: "Alex B", nickname: "Alex", email: OWNER_EMAIL },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      displayCurrencies: ["CHF"],
      units: "metric",
      features,
    }),
  );
  clearConfigCache();
  clearUserCache();
  const { migrateToLatest } = await import("@/lib/db/migrate");
  await migrateToLatest(await getDatabase());
  writeTripFixture(OWNER, { id: "alps", start: "2026-09-01", end: "2026-09-10", status: "current", visibility: "guest" });
});

afterEach(async () => {
  await closeDatabase();
  for (const key of ["CONTENT_DIR", "DATABASE_URL", "CONTACTS_ENCRYPTION_KEY", "SESSION_SECRET"]) delete process.env[key];
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function ask(email: string, confirm: boolean) {
  const result = await requestContact(OWNER, {
    name: email.split("@")[0],
    email,
    locale: "en",
    address: null,
    wantsEmailDigest: false,
    wantsPostcard: false,
    createdVia: "asked",
  });
  if (confirm) {
    const { code } = await issueCode(OWNER, email, "guest");
    const confirmed = await confirmContact(OWNER, email, code);
    if (!confirmed.ok) throw new Error("expected confirmation");
  }
  return result.contactId!;
}

async function seed() {
  await ask("unconfirmed@example.test", false);
  await ask("confirmed@example.test", true);
  const granted = await grantContactAccess(OWNER, { name: "Granted", email: "granted@example.test", locale: "en" });
  if (!granted.ok) throw new Error("expected the grant");
  const gone = await ask("gone@example.test", true);
  await approveContact(OWNER, gone);
  await revokeContact(OWNER, gone);
  await addSelfContact(OWNER);
}

const emails = (rows: { email: string }[]) => rows.map((r) => r.email).sort();

describe("readersModel splits every contact by whose turn it is", () => {
  test("pending, confirmed, direct grant and revoked each land in one bucket; the owner in none", async () => {
    await seed();
    const model = await readersModel(OWNER);
    expect(emails(model.waitingOnThem)).toEqual(["unconfirmed@example.test"]);
    expect(emails(model.waitingOnYou)).toEqual(["confirmed@example.test"]);
    expect(emails(model.readingNow)).toEqual(["granted@example.test"]);
    expect(model.readingNow[0].createdVia).toBe("owner-grant");
    expect(emails(model.revoked)).toEqual(["gone@example.test"]);
    expect(model.own?.email).toBe(OWNER_EMAIL);
    expect(model.asking).toBe(1);
  });

  test("the hub's asking chip is the model's count, not every pending row", async () => {
    await seed();
    const hub = await buildStudioHubModel(OWNER);
    if (hub.kind !== "full") throw new Error("expected a full hub");
    expect(hub.facts.readersAsking).toBe((await readersModel(OWNER)).asking);
    expect(hub.facts.readersAsking).toBe(1);
  });
});
