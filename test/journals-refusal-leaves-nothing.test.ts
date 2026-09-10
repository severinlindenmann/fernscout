import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { POST } from "@/app/api/v1/journals/route";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache, getUser } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { NO_JOURNAL, issueCode, markPhoneProven, resolveSession, verifyCode } from "@/lib/auth";
import { checkVerification, startVerification } from "@/lib/phoneVerify";

/**
 * B859 — one token, one journal, and a refusal is not the one.
 *
 * A tester reported that `POST /api/v1/journals` refused for a missing
 * `baseCurrency` **and still created the journal and spent the signup token**.
 * Reading the route says that cannot happen — every check returns well before
 * `createJournal`, and the file's own doc comment says a signup token survives
 * a refused creation deliberately. The likelier reading of her sequence is
 * that a later call succeeded and the one after it met `invalid_token` as it
 * should.
 *
 * "Probably not a bug" is the problem this file removes. B839 has just made
 * `baseCurrency` required, which puts a new refusal in front of a route whose
 * whole contract is one token and one journal, and a wrong answer here costs
 * somebody their only signup token and leaves a half-made journal with a
 * permanent currency.
 *
 * So: every reason the route can refuse, each asserted to leave **no journal
 * in the cache, no folder on disk, and a token still worth spending** — proved
 * at the end by spending that same token, once, successfully.
 */
let dir: string;
let caller = 0;

let phoneCounter = 0;

/** B1065 requires a proven number too — driven directly, as in
 * test/signup-token.test.ts, since this suite is not testing that step. */
async function signupToken(email: string): Promise<string> {
  const { code } = await issueCode(NO_JOURNAL, email, "signup");
  const result = await verifyCode(NO_JOURNAL, email, code, "signup");
  if (!result.ok) throw new Error("could not mint a signup token");

  const tel = `417603${String(phoneCounter++).padStart(5, "0")}`;
  process.env.AUTH_DEV_CODE = "424242";
  const { id } = await startVerification(tel, "en");
  const proof = await checkVerification(id, "424242");
  delete process.env.AUTH_DEV_CODE;
  if (proof.status !== "ok") throw new Error("could not prove a phone number");

  const session = await resolveSession(result.token, "signup");
  if (!session) throw new Error("no session for the token just minted");
  await markPhoneProven(session.id, proof.phone, "sms");

  return result.token;
}

/** Each call from its own address — the route is rate-limited per IP, and a
 *  test that met the limit would read as a refusal this file is asserting
 *  about. */
function create(token: string, body: Record<string, unknown>) {
  caller += 1;
  return POST(
    new Request("https://example.test/api/v1/journals", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-forwarded-for": `203.0.113.${100 + caller}`,
      },
      body: JSON.stringify(body),
    }),
  );
}

const GOOD = {
  title: "A journal",
  ownerName: "Robin Traveller",
  ownerNickname: "Robin",
  visibility: "public",
  defaultLocale: "en",
  locales: ["en"],
  baseCurrency: "CHF",
};

/** Nothing of this journal anywhere: not in the cache, not on disk. */
function nothingLeftBehind(username: string): void {
  clearUserCache();
  expect(getUser(username)).toBeNull();
  expect(fs.existsSync(path.join(dir, username))).toBe(false);
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-refusals-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "auth.db")}`;
  process.env.SESSION_SECRET = "b859-test-secret-b859-test-secret";
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "T", url: "https://t.test" },
      users: { reserved: ["admin"] },
      features: {
        signup: { enabled: true },
        auth: { enabled: true },
        mail: { enabled: true, transport: "file" },
      },
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
  delete process.env.DATA_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.SESSION_SECRET;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

test("every refusal leaves no journal behind, and the token is still spendable", async () => {
  const token = await signupToken("careful@example.test");

  // One row per reason the route can refuse before it reaches `createJournal`,
  // plus the one it refuses from inside it (a taken name). The username is
  // different each time so that "no journal called this" is a real assertion
  // and not one masked by an earlier row.
  const refusals: { why: string; username: string; body: Record<string, unknown> }[] = [
    { why: "no baseCurrency", username: "r-currency-missing", body: omit(GOOD, "baseCurrency") },
    {
      why: "a baseCurrency that is not a currency",
      username: "r-currency-bad",
      body: { ...GOOD, baseCurrency: "francs" },
    },
    {
      why: "displayCurrencies without the base",
      username: "r-currency-display",
      body: { ...GOOD, displayCurrencies: ["EUR", "USD"] },
    },
    { why: "no visibility", username: "r-visibility", body: omit(GOOD, "visibility") },
    { why: "no defaultLocale", username: "r-locale", body: omit(GOOD, "defaultLocale") },
    { why: "no title", username: "r-title", body: omit(GOOD, "title") },
    { why: "no ownerName", username: "r-owner", body: omit(GOOD, "ownerName") },
    { why: "a reserved name", username: "admin", body: GOOD },
    { why: "a name that is not a name", username: "Not A Name", body: GOOD },
  ];

  const seen: Record<string, number> = {};
  for (const { why, username, body } of refusals) {
    const response = await create(token, { ...body, username });
    seen[why] = response.status;
    nothingLeftBehind(username);
  }
  // Asserted as a whole rather than one `>= 400` at a time: a loop that
  // silently stopped refusing something would still pass a per-row check that
  // only says "not a success", and this way the file also records what each
  // refusal answers.
  expect(seen).toEqual({
    "no baseCurrency": 400,
    "a baseCurrency that is not a currency": 400,
    "displayCurrencies without the base": 400,
    "no visibility": 400,
    "no defaultLocale": 400,
    "no title": 400,
    "no ownerName": 400,
    "a reserved name": 400,
    "a name that is not a name": 400,
  });

  // A taken name is the one refusal that comes from inside `createJournal`,
  // so it is the one where "nothing was written" is least obvious. Somebody
  // else's journal has to exist first, which costs its own token.
  const first = await create(await signupToken("first@example.test"), {
    ...GOOD,
    username: "taken-already",
  });
  expect(first.status).toBe(201);

  const clash = await create(token, { ...GOOD, username: "taken-already" });
  expect(clash.status).toBe(409);
  expect(((await clash.json()) as { error?: string }).error).toBe("username_taken");
  // The journal that was already there is untouched, and still the first
  // owner's — a refused creation must not have edited it.
  clearUserCache();
  expect(getUser("taken-already")?.owner.email).toBe("first@example.test");

  // The proof: nine refusals and a clash later, the token has never been
  // spent, and spends now.
  const created = await create(token, { ...GOOD, username: "finally-mine" });
  expect(created.status).toBe(201);
  clearUserCache();
  expect(getUser("finally-mine")?.owner.email).toBe("careful@example.test");

  // And once. A signup token creates one journal and is then done.
  const second = await create(token, { ...GOOD, username: "one-too-many" });
  expect(second.status).toBe(401);
  nothingLeftBehind("one-too-many");
});

function omit(body: Record<string, unknown>, field: string): Record<string, unknown> {
  const copy = { ...body };
  delete copy[field];
  return copy;
}
