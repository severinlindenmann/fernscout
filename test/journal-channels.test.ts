import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

/**
 * B463 — the two mute switches on the credits card.
 *
 * Two doors now onto the same `setJournalFeatures` write, split by credential
 * (B1595): `PATCH /api/v2/{user}/channels` (bearer, an agent) and its cookie
 * proxy `PATCH /api/web/{user}/channels` (cookie, the owner's own browser) —
 * one route used to answer both. The two things worth pinning are unchanged:
 * it writes `mail` and `whatsapp` and refuses every other key, and it can no
 * more switch on a capability this server does not have than `PATCH /config`
 * could.
 *
 * The non-owner cases (nobody signed in, a guest signed into the journal)
 * only make sense against the cookie door — there is no bearer-shaped
 * equivalent of "a guest cookie" — so those go through `webPatch`; the
 * owner's own writes go through `apiPatch` with a bearer token, the same as
 * every other v2 write.
 */

const jar = vi.hoisted(() => ({ cookies: {} as Record<string, string> }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      jar.cookies[name] === undefined ? undefined : { value: jar.cookies[name] },
  }),
}));

const OWNER = "ana";
const OWNER_EMAIL = "ana@example.test";
const GUEST_EMAIL = "guest@example.test";

let dir: string;
/** One IP per call — `lib/rateLimit.ts` is a module-level map shared by the
 * whole file. */
let calls = 0;

function as(token: string | null) {
  jar.cookies = {};
  if (token) jar.cookies.fs_session = token;
}

async function ownerToken(): Promise<string> {
  const { issueCode, verifyCode } = await import("@/lib/auth");
  const { code } = await issueCode(OWNER, OWNER_EMAIL, "agent");
  const result = await verifyCode(OWNER, OWNER_EMAIL, code, "agent");
  if (!result.ok) throw new Error("no owner token");
  return result.token;
}

async function guestSession(): Promise<string> {
  const { issueCode, verifyCode } = await import("@/lib/auth");
  const { code } = await issueCode(OWNER, GUEST_EMAIL, "guest");
  const result = await verifyCode(OWNER, GUEST_EMAIL, code, "guest");
  if (!result.ok) throw new Error("no guest session");
  return result.token;
}

/** The cookie door — `jar.cookies` (set by `as()`) or nothing. */
async function webPatch(
  body: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const { PATCH } = await import("@/app/api/web/[user]/channels/route");
  calls += 1;
  const response = await PATCH(
    new Request(`https://example.test/api/web/${OWNER}/channels`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": `10.0.2.${calls % 250}`,
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ user: OWNER }) },
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

/** The bearer door — an agent holding the owner's own token. */
async function apiPatch(
  body: Record<string, unknown>,
  bearer: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const { PATCH } = await import("@/app/api/v2/[user]/channels/route");
  calls += 1;
  const response = await PATCH(
    new Request(`https://example.test/api/v2/${OWNER}/channels`, {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": `10.0.2.${calls % 250}`,
        authorization: `Bearer ${bearer}`,
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ user: OWNER }) },
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

/** What the journal's own file says now, read back from disk rather than from
 * the response: the point of the route is the write. */
async function fileSays(name: "mail" | "whatsapp"): Promise<boolean | undefined> {
  const raw = JSON.parse(fs.readFileSync(path.join(dir, OWNER, "config.json"), "utf8"));
  return raw.features?.[name]?.enabled;
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-channels-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.SESSION_SECRET = "77".repeat(32);
  delete process.env.AUTH_DEV_CODE;

  // The server offers mail and not WhatsApp — which is the interesting
  // shape: one channel an owner may switch, one they may not.
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", defaultUser: OWNER },
      users: { reserved: [] },
      features: {
        auth: { enabled: true },
        mail: { enabled: true, transport: "file" },
      },
    }),
  );
  fs.mkdirSync(path.join(dir, OWNER, "trips"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title: "Ana's journal",
      tagline: "t",
      owner: { name: "Ana A", nickname: "Ana", email: OWNER_EMAIL },
      startLocation: "X",
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      displayCurrencies: ["CHF"],
      units: "metric",
      features: { auth: { enabled: true }, mail: { enabled: true } },
    }),
  );

  const { clearConfigCache } = await import("@/lib/config");
  const { clearUserCache } = await import("@/lib/users");
  clearConfigCache();
  clearUserCache();

  const { migrateToLatest } = await import("@/lib/db/migrate");
  const { getDatabase } = await import("@/lib/db");
  await migrateToLatest(await getDatabase());
});

afterAll(async () => {
  const { closeDatabase } = await import("@/lib/db");
  await closeDatabase();
  for (const key of ["CONTENT_DIR", "DATABASE_URL", "SESSION_SECRET", "AUTH_DEV_CODE"]) {
    delete process.env[key];
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("who may switch a channel", () => {
  test("an unauthenticated caller cannot, and nothing is written", async () => {
    as(null);
    const result = await webPatch({ mail: false });
    expect(result.status).toBe(403);
    expect(await fileSays("mail")).toBe(true);
  });

  test("a guest signed into the journal cannot", async () => {
    as(await guestSession());
    const result = await webPatch({ mail: false });
    expect(result.status).toBe(403);
    expect(await fileSays("mail")).toBe(true);
    as(null);
  });
});

describe("what the owner may do with it", () => {
  test("muting mail writes the file, and un-muting puts it back", async () => {
    const token = await ownerToken();

    expect((await apiPatch({ mail: false }, token)).status).toBe(200);
    expect(await fileSays("mail")).toBe(false);

    expect((await apiPatch({ mail: true }, token)).status).toBe(200);
    expect(await fileSays("mail")).toBe(true);
  });

  /** The ceiling, and the reason the answer is not a silent success: a write
   * that cannot take effect must not report that it did. */
  test("a channel this server does not offer cannot be switched on", async () => {
    const result = await apiPatch({ whatsapp: true }, await ownerToken());
    expect(result.status).toBe(409);
    expect(result.body.error).toBe("capability_unavailable");
  });

  /** The window is two named channels. Anything else is a different decision
   * with different consequences, and belongs to `PATCH /config`. */
  test("no other capability can be reached through this route", async () => {
    const token = await ownerToken();
    for (const channel of ["auth", "contacts", "credits", "postcards"]) {
      const result = await apiPatch({ [channel]: false }, token);
      expect(result.status).toBe(400);
    }
    const { getUser, clearUserCache } = await import("@/lib/users");
    clearUserCache();
    expect(getUser(OWNER)?.features.auth.enabled).toBe(true);
  });

  test("a body with no boolean in it is refused", async () => {
    const result = await apiPatch({ mail: "off" }, await ownerToken());
    expect(result.status).toBe(400);
  });
});
