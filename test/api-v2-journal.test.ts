import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

// `isOwner`/cookie helpers read through next/headers, which throws outside a
// request — every call here authenticates with a bearer token instead, so
// there is never a live cookie to hand back. Same guard api-v2-keys.test.ts
// uses.
import { vi } from "vitest";
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

/**
 * `GET/PATCH/DELETE /api/v2/{user}` — B1608, phase 2 step 3.
 *
 * End to end against a real temp content dir and a real sqlite db, the same
 * shape `test/api-v2-keys.test.ts` and `test/deletions.test.ts` use: real
 * sessions minted through `lib/auth`, real route handlers called directly.
 */

const OWNER_EMAIL = "ana@example.test";
const OWNER = "ana";
// A second, untouched journal — the T6 retraction test needs `tagline`
// genuinely unanswered when it starts, which `OWNER` no longer is once the
// echo-round-trip tests above have answered it.
const RETRACT_EMAIL = "bo@example.test";
const RETRACT_OWNER = "bo";

let dir: string;
let calls = 0;

function headers(extra: Record<string, string> = {}): Record<string, string> {
  calls += 1;
  return { "content-type": "application/json", "x-forwarded-for": `10.9.2.${calls % 250}`, ...extra };
}

async function ownerToken(): Promise<string> {
  const { issueCode, verifyCode } = await import("@/lib/auth");
  const { code } = await issueCode(OWNER, OWNER_EMAIL, "agent");
  const result = await verifyCode(OWNER, OWNER_EMAIL, code, "agent");
  if (!result.ok) throw new Error("no owner token");
  return result.token;
}

type JournalBody = Record<string, unknown> & { error?: string; message?: string };

async function getJournal(token?: string, ifMatch?: string) {
  const { GET } = await import("@/app/api/v2/[user]/route");
  const response = await GET(
    new Request(`https://example.test/api/v2/${OWNER}`, {
      headers: headers({
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(ifMatch ? { "if-match": ifMatch } : {}),
      }),
    }),
    { params: Promise.resolve({ user: OWNER }) },
  );
  return { status: response.status, etag: response.headers.get("etag"), body: (await response.json()) as JournalBody };
}

async function patchJournal(
  token: string | undefined,
  body: unknown,
  opts: { ifMatch?: string; dryRun?: boolean } = {},
) {
  const { PATCH } = await import("@/app/api/v2/[user]/route");
  const url = new URL(`https://example.test/api/v2/${OWNER}`);
  if (opts.dryRun !== undefined) url.searchParams.set("dryRun", String(opts.dryRun));
  const response = await PATCH(
    new Request(url, {
      method: "PATCH",
      headers: headers({
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(opts.ifMatch ? { "if-match": opts.ifMatch } : {}),
      }),
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ user: OWNER }) },
  );
  return { status: response.status, etag: response.headers.get("etag"), body: (await response.json()) as JournalBody };
}

async function deleteJournal(token?: string) {
  const { DELETE } = await import("@/app/api/v2/[user]/route");
  const response = await DELETE(
    new Request(`https://example.test/api/v2/${OWNER}`, {
      method: "DELETE",
      headers: headers(token ? { authorization: `Bearer ${token}` } : {}),
    }),
    { params: Promise.resolve({ user: OWNER }) },
  );
  return { status: response.status, body: (await response.json()) as JournalBody };
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-api-v2-journal-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.SESSION_SECRET = "88".repeat(32);

  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test" },
      users: { reserved: [] },
      features: { auth: { enabled: true }, mail: { enabled: true, transport: "file" } },
    }),
  );

  const { clearConfigCache } = await import("@/lib/config");
  const { clearUserCache } = await import("@/lib/users");
  const { migrateToLatest } = await import("@/lib/db/migrate");
  const { getDatabase } = await import("@/lib/db");
  const { createJournal } = await import("@/lib/journals");

  clearConfigCache();
  clearUserCache();
  await migrateToLatest(await getDatabase());

  // No tagline, no figures — a journal exactly as `createJournal` (v1's own
  // door) leaves it, which is precisely the "migrated from before v2, never
  // answered the new questions" state the 422 `incomplete` test below needs.
  const created = createJournal({
    username: OWNER,
    title: "Two Backpacks",
    ownerEmail: OWNER_EMAIL,
    ownerName: "Ana Traveller",
    ownerNickname: "Ana",
  });
  if (!created.ok) throw new Error(created.message);

  const created2 = createJournal({
    username: RETRACT_OWNER,
    title: "Bo's Journal",
    ownerEmail: RETRACT_EMAIL,
    ownerName: "Bo Traveller",
    ownerNickname: "Bo",
  });
  if (!created2.ok) throw new Error(created2.message);
});

afterAll(async () => {
  const { closeDatabase } = await import("@/lib/db");
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATA_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.SESSION_SECRET;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("GET /api/v2/{user}", () => {
  test("returns the journal document with an ETag", async () => {
    const { status, etag, body } = await getJournal(await ownerToken());
    expect(status).toBe(200);
    expect(etag).toBeTruthy();
    expect(body.title).toBe("Two Backpacks");
    expect(body.username).toBe(OWNER);
    expect(body.tagline).toBeUndefined();
  });

  test("refuses a token for a different journal", async () => {
    // No such journal exists for this token to even attempt to prove — the
    // token itself belongs to no journal at all, so authentication fails
    // before ownership is even asked.
    const { status, body } = await getJournal("not-a-real-token");
    expect(status).toBe(401);
    expect(body.error).toBe("invalid_token");
  });
});

describe("PATCH /api/v2/{user} — the 422 incomplete body", () => {
  test("a journal missing a declinable answers 422 with every open section", async () => {
    const { status, body } = await patchJournal(await ownerToken(), { title: "Two Backpacks, Renamed" });
    expect(status).toBe(422);
    expect(body.error).toBe("incomplete");
    const missing = (body.details as { missing?: { field: string }[] })?.missing ?? [];
    const fields = missing.map((m) => m.field).sort();
    expect(fields).toEqual(["figures", "tagline"]);
  });
});

describe("PATCH /api/v2/{user} — echo-tolerant round trip (V2)", () => {
  test("GET, change one field, send the whole document back — it works", async () => {
    const token = await ownerToken();
    const { body: doc } = await getJournal(token);
    const round = {
      ...doc,
      title: doc.title,
      tagline: "Two of us, mostly by rail",
      declined: { figures: "owner prefers the plain map" },
    };
    delete round.error;
    delete round.message;

    const { status, body } = await patchJournal(token, round);
    expect(status, JSON.stringify(body)).toBe(200);
    expect(body.tagline).toBe("Two of us, mostly by rail");
    expect(body.username).toBe(OWNER);
    // `baseCurrency` and `username` were echoed back byte-identical and were
    // silently accepted rather than refused.
    expect(body.baseCurrency).toBe("CHF");
  });

  test("a CHANGED baseCurrency is refused", async () => {
    const token = await ownerToken();
    const { body: doc } = await getJournal(token);
    const attempt = { ...doc, baseCurrency: "EUR" };
    delete attempt.error;
    delete attempt.message;

    const { status, body } = await patchJournal(token, attempt);
    expect(status).toBe(400);
    expect(body.message).toMatch(/baseCurrency is not writable/);
  });

  test("a CHANGED owner.email is refused", async () => {
    const token = await ownerToken();
    const { body: doc } = await getJournal(token);
    const attempt = { ...doc, owner: { ...(doc.owner as Record<string, unknown>), email: "someone-else@example.test" } };
    delete attempt.error;
    delete attempt.message;

    const { status, body } = await patchJournal(token, attempt);
    expect(status).toBe(400);
    expect(body.message).toMatch(/owner\.email is not writable/);
  });
});

describe("PATCH /api/v2/{user} — T6 decline retraction", () => {
  async function retractToken(): Promise<string> {
    const { issueCode, verifyCode } = await import("@/lib/auth");
    const { code } = await issueCode(RETRACT_OWNER, RETRACT_EMAIL, "agent");
    const result = await verifyCode(RETRACT_OWNER, RETRACT_EMAIL, code, "agent");
    if (!result.ok) throw new Error("no token");
    return result.token;
  }

  async function patchRetract(token: string, body: unknown) {
    const { PATCH } = await import("@/app/api/v2/[user]/route");
    const response = await PATCH(
      new Request(`https://example.test/api/v2/${RETRACT_OWNER}`, {
        method: "PATCH",
        headers: headers({ authorization: `Bearer ${token}` }),
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ user: RETRACT_OWNER }) },
    );
    return { status: response.status, body: (await response.json()) as JournalBody };
  }

  test("declining tagline, then supplying it, clears the stored decline", async () => {
    const token = await retractToken();

    const declined = await patchRetract(token, {
      declined: { tagline: "the title says it all already", figures: "owner prefers the plain map" },
    });
    expect(declined.status, JSON.stringify(declined.body)).toBe(200);
    expect(declined.body.declined).toEqual({
      tagline: "the title says it all already",
      figures: "owner prefers the plain map",
    });

    const supplied = await patchRetract(token, { tagline: "Two of us, mostly by rail" });
    expect(supplied.status, JSON.stringify(supplied.body)).toBe(200);
    expect(supplied.body.tagline).toBe("Two of us, mostly by rail");
    // The stored decline for tagline is gone; figures' decline survives.
    expect(supplied.body.declined).toEqual({ figures: "owner prefers the plain map" });
  });
});

describe("PATCH /api/v2/{user} — dryRun (T1)", () => {
  test("previews without writing", async () => {
    const token = await ownerToken();
    const before = await getJournal(token);

    const preview = await patchJournal(token, { title: "A Title Nobody Should Keep" }, { dryRun: true });
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    expect(preview.body.title).toBe("A Title Nobody Should Keep");

    const after = await getJournal(token);
    expect(after.body.title).toBe(before.body.title);
    expect(after.body.title).not.toBe("A Title Nobody Should Keep");
  });
});

describe("PATCH /api/v2/{user} — ETag / If-Match (V11)", () => {
  test("a stale If-Match answers 409 with the current document", async () => {
    const token = await ownerToken();
    const { status, body } = await patchJournal(token, { title: "Whatever" }, { ifMatch: '"not-the-real-one"' });
    expect(status).toBe(409);
    expect(body.error).toBe("stale_document");
    expect((body.details as { username?: string })?.username).toBe(OWNER);
  });

  test("the current ETag is accepted", async () => {
    const token = await ownerToken();
    const { etag } = await getJournal(token);
    const { status } = await patchJournal(token, { title: "Two Backpacks" }, { ifMatch: etag ?? undefined });
    expect(status).toBe(200);
  });
});

describe("DELETE /api/v2/{user}", () => {
  test("answers 202 and writes nothing", async () => {
    const token = await ownerToken();
    const { status, body } = await deleteJournal(token);
    expect(status).toBe(202);
    expect(body.deleted).toBe(false);
    expect(body.status).toBe("confirmation_sent");

    const { getUser } = await import("@/lib/users");
    expect(getUser(OWNER)).toBeTruthy();
  });

  test("refuses a trip-scoped token — journal deletion is the owner's alone", async () => {
    const { issueCode, verifyCode } = await import("@/lib/auth");
    const { tripWriteScope } = await import("@/lib/tripPeople");
    const { code } = await issueCode(OWNER, "buddy@example.test", "agent", { trip: "some-trip" });
    const scoped = await verifyCode(OWNER, "buddy@example.test", code, "agent", tripWriteScope("some-trip"));
    if (!scoped.ok) throw new Error("no scoped token");
    const { status, body } = await deleteJournal(scoped.token);
    expect(status).toBe(403);
    expect(body.error).toBe("forbidden");
  });
});
