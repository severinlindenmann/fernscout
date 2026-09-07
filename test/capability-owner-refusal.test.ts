import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

/**
 * B340 — a disabled capability answers a proven owner honestly, and answers
 * everybody else exactly as a journal that does not exist.
 *
 * `invites`, `invites/{id}` and `keys` used to check the capability before
 * ownership: `!getUser(user) || !isEnabled(…)` → `404`, for anyone at all,
 * before an agent token or guest cookie was even read. That made a `403`
 * (reached only once the capability check passed) into a second, narrower
 * oracle — a fake journal and a real one with the capability off both
 * answered `404`, but a real journal with the capability *on* and a caller
 * who is not its owner answered `403`. So the shape of the refusal already
 * told a caller with no credential at all whether the capability was on,
 * which is not "absent" in the sense AGENTS.md means it (B165).
 *
 * The fix checks ownership first. `isOwner` refuses a nonexistent journal
 * and one that exists but is not this caller's identically, so **that**
 * check is now the only one an uninvolved caller — including one with no
 * credential — ever reaches, and it is the same `403 forbidden` regardless
 * of the capability. Only once ownership is proven (which, by construction,
 * means the journal is real) is the capability checked, and a real owner is
 * told the actual reason with a `409` rather than folded into `404` — they
 * are not a stranger an existence oracle could help.
 */

const OWNER = "ana";
const OWNER_EMAIL = "ana@example.test";

let dir: string;

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => {} }),
}));

let calls = 0;
function headers(extra: Record<string, string> = {}): Record<string, string> {
  calls += 1;
  return { "content-type": "application/json", "x-forwarded-for": `10.9.2.${calls % 250}`, ...extra };
}

function writeConfig(features: Record<string, { enabled: boolean }>) {
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title: "Two Backpacks",
      owner: { name: "Ana B", nickname: "Ana", email: OWNER_EMAIL },
      startLocation: "X",
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      displayCurrencies: ["CHF"],
      units: "metric",
      features,
    }),
  );
}

async function clearCaches() {
  const { clearConfigCache } = await import("@/lib/config");
  const { clearUserCache } = await import("@/lib/users");
  clearConfigCache();
  clearUserCache();
}

async function ownerToken(): Promise<string> {
  const { issueCode, verifyCode } = await import("@/lib/auth");
  const { code } = await issueCode(OWNER, OWNER_EMAIL, "agent");
  const result = await verifyCode(OWNER, OWNER_EMAIL, code, "agent");
  if (!result.ok) throw new Error("no owner token");
  return result.token;
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-cap-owner-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.SESSION_SECRET = "99".repeat(32);
  process.env.CONTACTS_ENCRYPTION_KEY = "55".repeat(32);

  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", defaultUser: OWNER },
      users: { reserved: [] },
      features: { auth: { enabled: true }, contacts: { enabled: true } },
    }),
  );
  fs.mkdirSync(path.join(dir, OWNER, "trips"), { recursive: true });
  writeConfig({ auth: { enabled: true }, contacts: { enabled: true } });
  await clearCaches();

  const { migrateToLatest } = await import("@/lib/db/migrate");
  const { getDatabase } = await import("@/lib/db");
  await migrateToLatest(await getDatabase());
});

afterAll(async () => {
  const { closeDatabase } = await import("@/lib/db");
  await closeDatabase();
  for (const key of ["CONTENT_DIR", "DATABASE_URL", "SESSION_SECRET", "CONTACTS_ENCRYPTION_KEY"]) {
    delete process.env[key];
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

type Body = { error?: string; message?: string };

async function invites(user: string, token?: string): Promise<{ status: number; body: Body }> {
  const { GET } = await import("@/app/api/v1/[user]/invites/route");
  const response = await GET(
    new Request(`https://example.test/api/v1/${user}/invites`, {
      headers: headers(token ? { authorization: `Bearer ${token}` } : {}),
    }),
    { params: Promise.resolve({ user }) },
  );
  return { status: response.status, body: (await response.json()) as Body };
}

async function keys(user: string, token?: string): Promise<{ status: number; body: Body }> {
  const { GET } = await import("@/app/api/v1/[user]/keys/route");
  const response = await GET(
    new Request(`https://example.test/api/v1/${user}/keys`, {
      headers: headers(token ? { authorization: `Bearer ${token}` } : {}),
    }),
    { params: Promise.resolve({ user }) },
  );
  return { status: response.status, body: (await response.json()) as Body };
}

describe("invites: ownership is checked before the capability", () => {
  test("the owner, with contacts off, is told the real reason", async () => {
    writeConfig({ auth: { enabled: true }, contacts: { enabled: false } });
    await clearCaches();
    try {
      const result = await invites(OWNER, await ownerToken());
      expect(result.status).toBe(409);
      expect(result.body.error).toBe("contacts_disabled");
    } finally {
      writeConfig({ auth: { enabled: true }, contacts: { enabled: true } });
      await clearCaches();
    }
  });

  test("a journal with contacts off answers a non-owner exactly as one that does not exist", async () => {
    writeConfig({ auth: { enabled: true }, contacts: { enabled: false } });
    await clearCaches();
    try {
      const noToken = await invites(OWNER);
      const fakeJournal = await invites("no-such-journal");
      expect(noToken.status).toBe(403);
      expect(noToken).toEqual(fakeJournal);
    } finally {
      writeConfig({ auth: { enabled: true }, contacts: { enabled: true } });
      await clearCaches();
    }
  });

  test("a real journal with contacts on still answers a non-owner the same 403 as a fake one — no second oracle", async () => {
    const real = await invites(OWNER);
    const fake = await invites("no-such-journal");
    expect(real.status).toBe(403);
    expect(real).toEqual(fake);
  });
});

describe("keys: the same order", () => {
  test("the owner, with auth off, is told the real reason", async () => {
    const token = await ownerToken();
    writeConfig({ auth: { enabled: false }, contacts: { enabled: true } });
    await clearCaches();
    try {
      const result = await keys(OWNER, token);
      expect(result.status).toBe(409);
      expect(result.body.error).toBe("auth_disabled");
    } finally {
      writeConfig({ auth: { enabled: true }, contacts: { enabled: true } });
      await clearCaches();
    }
  });

  test("a non-owner and a nonexistent journal answer identically, whatever the capability", async () => {
    writeConfig({ auth: { enabled: false }, contacts: { enabled: true } });
    await clearCaches();
    try {
      const noToken = await keys(OWNER);
      const fakeJournal = await keys("no-such-journal");
      expect(noToken.status).toBe(403);
      expect(noToken).toEqual(fakeJournal);
    } finally {
      writeConfig({ auth: { enabled: true }, contacts: { enabled: true } });
      await clearCaches();
    }
  });
});
