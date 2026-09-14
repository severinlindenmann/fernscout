import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache, getUser } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";

/**
 * B1733 — `owner.email` IS ownership (`lib/api/auth.ts`'s `mayActAsOwner`
 * compares a session's address against it), so an owner token moving it
 * with nothing sent to the new address was a permanent takeover riding on
 * a seven-day token: the attacker's address could mint fresh owner tokens
 * for ever, and the real owner's could not.
 *
 * `owner.tel` (B1654) already answers the analogous question with "prove
 * it, like a passcode" rather than "write it and hope". This is the same
 * shape for the field that actually grants access: `PATCH
 * /api/v2/{user}` with a CHANGED `owner.email` starts a verification
 * (`202`) instead of writing, `.../owner/email/redeem` finishes it, and a
 * successful redeem revokes every session and agent token the OLD address
 * held for this journal and mails that address the fact.
 */

const OWNER = "ana";
const OWNER_EMAIL = "ana@example.test";
const NEW_EMAIL = "beatrix@example.test";
const CODE = "654321";

let dir: string;
let calls = 0;

function writeJournal(email: string = OWNER_EMAIL) {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "F", url: "https://example.test", defaultUser: OWNER },
      users: { reserved: [] },
      features: { auth: { enabled: true }, mail: { enabled: true, transport: "file" } },
    }),
  );
  fs.mkdirSync(path.join(dir, OWNER, "trips"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title: "The Solo Journal",
      owner: { name: "Ana B", nickname: "Ana", email },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      displayCurrencies: ["CHF"],
      units: "metric",
      visibility: "guest",
      declined: { tagline: "no tagline yet", figures: "not set up yet" },
    }),
  );
  clearConfigCache();
  clearUserCache();
}

function onDisk(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(dir, OWNER, "config.json"), "utf8")) as Record<string, unknown>;
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  calls += 1;
  return { "content-type": "application/json", "x-forwarded-for": `10.7.5.${calls % 250}`, ...extra };
}

async function ownerToken(email: string = OWNER_EMAIL): Promise<string> {
  const { issueCode, verifyCode } = await import("@/lib/auth");
  const { code } = await issueCode(OWNER, email, "agent");
  const result = await verifyCode(OWNER, email, code, "agent");
  if (!result.ok) throw new Error("no owner token");
  return result.token;
}

async function patchJournal(token: string, body: unknown) {
  const { PATCH } = await import("@/app/api/v2/[user]/route");
  const response = await PATCH(
    new Request(`https://example.test/api/v2/${OWNER}`, {
      method: "PATCH",
      headers: headers({ authorization: `Bearer ${token}` }),
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ user: OWNER }) },
  );
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : {}) as Record<string, unknown> };
}

async function getJournal(token: string) {
  const { GET } = await import("@/app/api/v2/[user]/route");
  const response = await GET(
    new Request(`https://example.test/api/v2/${OWNER}`, {
      method: "GET",
      headers: headers({ authorization: `Bearer ${token}` }),
    }),
    { params: Promise.resolve({ user: OWNER }) },
  );
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : {}) as Record<string, unknown> };
}

async function redeem(token: string, id: string, code: string) {
  const { POST } = await import("@/app/api/v2/[user]/owner/email/redeem/route");
  const response = await POST(
    new Request(`https://example.test/api/v2/${OWNER}/owner/email/redeem`, {
      method: "POST",
      headers: headers({ authorization: `Bearer ${token}` }),
      body: JSON.stringify({ id, code }),
    }),
    { params: Promise.resolve({ user: OWNER }) },
  );
  const text = await response.text();
  return { status: response.status, body: (text ? JSON.parse(text) : {}) as Record<string, unknown> };
}

function mailFiles(): string[] {
  const d = path.join(dir, "mail", OWNER);
  return fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith(".eml")) : [];
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-owner-email-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.SESSION_SECRET = "77".repeat(32);
  process.env.AUTH_DEV_CODE = CODE;
  writeJournal();
  const { migrateToLatest } = await import("@/lib/db/migrate");
  await migrateToLatest(await getDatabase());
});

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATA_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.SESSION_SECRET;
  delete process.env.AUTH_DEV_CODE;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("an unchanged owner.email is a mirror's ordinary save", () => {
  test("the whole document, echoed back byte-identical, is accepted and starts nothing", async () => {
    const token = await ownerToken();
    const { body: doc } = await getJournal(token);
    const round = { ...doc };

    const { status, body } = await patchJournal(token, round);
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.owner).toMatchObject({ email: OWNER_EMAIL });
    expect(mailFiles()).toHaveLength(0);
  });
});

describe("a CHANGED owner.email starts a verification instead of writing", () => {
  test("PATCH answers 202 with a pending id, and the file is untouched", async () => {
    const token = await ownerToken();
    const { body: doc } = await getJournal(token);
    const attempt = { ...doc, owner: { ...(doc.owner as Record<string, unknown>), email: NEW_EMAIL } };

    const { status, body } = await patchJournal(token, attempt);
    expect(status, JSON.stringify(body)).toBe(202);
    expect(body).toMatchObject({ pending: "owner_email", next: `POST /api/v2/${OWNER}/owner/email/redeem` });
    expect(typeof body.id).toBe("string");

    // Nothing was written.
    expect(onDisk().owner).toMatchObject({ email: OWNER_EMAIL });
    expect(getUser(OWNER)?.owner.email).toBe(OWNER_EMAIL);

    // The code went to the NEW address, not the owner's mailbox.
    const mails = mailFiles();
    expect(mails.some((f) => f.includes("beatrix-example-test"))).toBe(true);
  });

  test("a malformed address is refused outright, the same as before this ticket", async () => {
    const token = await ownerToken();
    const { body: doc } = await getJournal(token);
    const attempt = { ...doc, owner: { ...(doc.owner as Record<string, unknown>), email: "not-an-address" } };

    const { status, body } = await patchJournal(token, attempt);
    expect(status).toBe(400);
    expect(body.message).toMatch(/owner\.email is not writable/);
  });

  test("the wrong code at redeem changes nothing", async () => {
    const token = await ownerToken();
    const { body: doc } = await getJournal(token);
    const attempt = { ...doc, owner: { ...(doc.owner as Record<string, unknown>), email: NEW_EMAIL } };
    const started = await patchJournal(token, attempt);
    expect(started.status).toBe(202);

    const redeemed = await redeem(token, started.body.id as string, "000000");
    expect(redeemed.status).toBe(401);
    expect(onDisk().owner).toMatchObject({ email: OWNER_EMAIL });
    expect(getUser(OWNER)?.owner.email).toBe(OWNER_EMAIL);

    // The old token is still live — nothing was revoked over a failed guess.
    const stillGood = await getJournal(token);
    expect(stillGood.status).toBe(200);
  });

  test("the right code writes the address, kills the old owner's credentials, and mails the old address", async () => {
    const token = await ownerToken();
    const { body: doc } = await getJournal(token);
    const attempt = { ...doc, owner: { ...(doc.owner as Record<string, unknown>), email: NEW_EMAIL } };
    const started = await patchJournal(token, attempt);
    expect(started.status).toBe(202);

    const redeemed = await redeem(token, started.body.id as string, CODE);
    expect(redeemed.status, JSON.stringify(redeemed.body)).toBe(200);
    expect(redeemed.body.owner).toMatchObject({ email: NEW_EMAIL });

    // The write landed.
    expect(onDisk().owner).toMatchObject({ email: NEW_EMAIL });
    expect(getUser(OWNER)?.owner.email).toBe(NEW_EMAIL);

    // The OLD address's token is dead — the same one that started and
    // redeemed the change a moment ago.
    const dead = await getJournal(token);
    expect(dead.status).toBe(401);

    // The NEW address can mint its own owner token now.
    const newToken = await ownerToken(NEW_EMAIL);
    const alive = await getJournal(newToken);
    expect(alive.status).toBe(200);

    // The old address heard about it.
    const mails = mailFiles();
    expect(mails.some((f) => f.includes("ana-example-test") && f.includes("owner"))).toBe(true);
  });

  test("a stale, already-redeemed id cannot be replayed", async () => {
    const token = await ownerToken();
    const { body: doc } = await getJournal(token);
    const attempt = { ...doc, owner: { ...(doc.owner as Record<string, unknown>), email: NEW_EMAIL } };
    const started = await patchJournal(token, attempt);
    const first = await redeem(token, started.body.id as string, CODE);
    expect(first.status).toBe(200);

    const replay = await redeem(token, started.body.id as string, CODE);
    expect(replay.status).toBe(401);
  });
});
