import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { issueCode, openIdentitySession, resolveSession, verifyCode } from "@/lib/auth";

/**
 * B2522 — a signed-in guest starting a journal is not sent a second code for
 * the address their identity cookie already proves. What has to hold is that
 * only that cookie counts: not a journal cookie, not a bearer token, not a
 * number-only identity, and never past the invite list or the journal cap.
 */

const jar: { cookies: Record<string, string> } = { cookies: {} };
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.cookies[name] === undefined ? undefined : { value: jar.cookies[name] }),
    set: () => {},
  }),
}));

let dir: string;
let caller = 0;

function writeConfig(signup: Record<string, unknown>) {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({ site: { name: "T", url: "https://t.test" }, users: { reserved: [] }, features: { signup } }),
  );
  clearConfigCache();
}

async function ask(headers: Record<string, string> = {}) {
  caller += 1;
  const { POST } = await import("@/app/api/auth/signup/identity/route");
  return POST(
    new Request("https://t.test/api/auth/signup/identity", {
      method: "POST",
      headers: { "x-forwarded-for": `203.0.113.${caller}`, ...headers },
    }),
  );
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-signup-identity-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "auth.db")}`;
  process.env.SESSION_SECRET = "b2522-test-secret-b2522-test-secret";
  writeConfig({ inviteOnly: false });
  clearUserCache();
  jar.cookies = {};
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

describe("a signup token from the identity cookie", () => {
  test("a live identity earns a signup token for its own address", async () => {
    jar.cookies.fs_identity = (await openIdentitySession("oma@example.test")).token;
    const res = await ask();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, scope: "signup" });
    expect(await resolveSession(body.token, "signup")).toMatchObject({ email: "oma@example.test" });
  });

  test("an empty jar, a journal cookie alone or a bearer token earn nothing", async () => {
    expect((await ask()).status).toBe(401);

    fs.mkdirSync(path.join(dir, "ana"));
    const { code } = await issueCode("ana", "oma@example.test", "guest");
    const guest = await verifyCode("ana", "oma@example.test", code, "guest");
    if (!guest.ok) throw new Error(guest.reason);
    jar.cookies.fs_session = guest.token;
    expect((await ask()).status).toBe(401);

    const identity = (await openIdentitySession("oma@example.test")).token;
    expect((await ask({ authorization: `Bearer ${identity}` })).status).toBe(401);
  });

  test("a number-only identity has no address to sign up with", async () => {
    jar.cookies.fs_identity = (await openIdentitySession("+41790000000")).token;
    expect((await ask()).status).toBe(401);
  });

  test("the invite list still decides", async () => {
    writeConfig({});
    jar.cookies.fs_identity = (await openIdentitySession("stranger@example.test")).token;
    const res = await ask();
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("signup_not_invited");
  });

  test("an address that already owns a journal is told so", async () => {
    fs.mkdirSync(path.join(dir, "oma"));
    fs.writeFileSync(path.join(dir, "oma", "config.json"), JSON.stringify({ owner: { email: "oma@example.test" } }));
    clearUserCache();
    jar.cookies.fs_identity = (await openIdentitySession("oma@example.test")).token;
    const res = await ask();
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("too_many_journals");
  });

  test("a foreign page cannot ask", async () => {
    jar.cookies.fs_identity = (await openIdentitySession("oma@example.test")).token;
    expect((await ask({ origin: "https://evil.test" })).status).toBe(403);
  });
});
