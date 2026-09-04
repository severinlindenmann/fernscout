import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { POST } from "@/app/api/v1/journals/route";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache, getUser } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { SIGNUP_OWNER, issueCode, verifyCode } from "@/lib/auth";

/**
 * B55 — "it can create one journal, once".
 *
 * That is what the mail carrying a signup code says, and it was not true: the
 * route never revoked the session, so the token lived its full twenty minutes
 * and created journals until the per-address cap stopped it. Three, not one.
 *
 * The care in the fix is *when* the token is spent, and both halves are here:
 * a success must spend it, and a refusal must not. A token burned on a
 * mistyped username would strand somebody with a dead credential and no way
 * back except another round through their email.
 */

let dir: string;

async function signupToken(email: string): Promise<string> {
  const { code } = await issueCode(SIGNUP_OWNER, email, "signup");
  const result = await verifyCode(SIGNUP_OWNER, email, code, "signup");
  if (!result.ok) throw new Error("could not mint a signup token");
  return result.token;
}

/**
 * Each call from its own address.
 *
 * `journals-create` allows five per hour per address, and the limiter is a
 * module-level map that outlives a single test — so without this the file
 * exhausts one bucket partway through and later tests read 429 as though the
 * behaviour under test had changed. The header is what a proxy would set; see
 * B01 for why the first value is the one trusted.
 */
let caller = 0;
function create(token: string, body: Record<string, unknown>) {
  caller += 1;
  return POST(
    new Request("https://example.test/api/v1/journals", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-forwarded-for": `203.0.113.${caller}`,
      },
      body: JSON.stringify(body),
    }),
  );
}

const OWNER = "owner@example.test";
const GOOD = {
  title: "A journal",
  ownerName: "Robin Traveller",
  ownerNickname: "Robin",
  visibility: "public",
  defaultLocale: "en",
  locales: ["en"],
};

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-signup-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "auth.db")}`;
  process.env.SESSION_SECRET = "b55-test-secret-b55-test-secret";
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "T", url: "https://t.test" },
      users: { reserved: [] },
      features: { signup: { enabled: true }, auth: { enabled: true } },
    }),
  );
  clearConfigCache();
  clearUserCache();

  const { migrateToLatest } = await import("@/lib/db/migrate");
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

describe("a signup token", () => {
  test("creates a journal", async () => {
    const token = await signupToken(OWNER);
    const response = await create(token, { ...GOOD, username: "wanderer" });
    expect(response.status).toBe(201);
    expect(getUser("wanderer")?.title).toBe("A journal");
  });

  /** The promise the mail makes. */
  test("is spent by doing so, and cannot create a second", async () => {
    const token = await signupToken(OWNER);
    expect((await create(token, { ...GOOD, username: "first" })).status).toBe(201);

    const second = await create(token, { ...GOOD, username: "second" });
    expect(second.status).toBe(401);
    expect(getUser("second")).toBeNull();
  });

  test("and says the first one worked, so a retry is not reported as a failure", async () => {
    const token = await signupToken(OWNER);
    await create(token, { ...GOOD, username: "first" });

    const body = (await (await create(token, { ...GOOD, username: "second" })).json()) as {
      message?: string;
    };
    expect(body.message).toMatch(/already created one, that succeeded/i);
  });

  /**
   * The other half, and the reason the revoke sits after `createJournal`
   * rather than at the top of the route.
   */
  test("survives a username that is already taken", async () => {
    const token = await signupToken(OWNER);
    await create(token, { ...GOOD, username: "taken" });

    // Somebody else's token, so the name exists when ours arrives.
    const mine = await signupToken("second@example.test");
    expect((await create(mine, { ...GOOD, username: "taken" })).status).toBe(409);

    // Still usable: the mistake was correctable without another email.
    expect((await create(mine, { ...GOOD, username: "mine" })).status).toBe(201);
  });

  test("survives a username that is not a username", async () => {
    const token = await signupToken(OWNER);
    expect((await create(token, { ...GOOD, username: "Has Capitals" })).status).toBe(400);
    expect((await create(token, { ...GOOD, username: "corrected" })).status).toBe(201);
  });

  test("survives a missing required field", async () => {
    const token = await signupToken(OWNER);
    expect((await create(token, { username: "no-owner", title: "T" })).status).toBe(400);
    expect((await create(token, { ...GOOD, username: "no-owner" })).status).toBe(201);
  });

  test("one address's token is not spent by another's", async () => {
    const mine = await signupToken(OWNER);
    const theirs = await signupToken("other@example.test");
    expect((await create(mine, { ...GOOD, username: "mine" })).status).toBe(201);
    expect((await create(theirs, { ...GOOD, username: "theirs" })).status).toBe(201);
  });
});
