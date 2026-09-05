import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import {
  issueCode,
  openAgentSession,
  openIdentitySession,
  resolveSession,
  verifyCode,
} from "@/lib/auth";

/**
 * B459 — B410 shipped after everybody was already signed in.
 *
 * Identity is minted by the *act* of signing in, and a reader holding a
 * year-long journal cookie will not repeat it, so the ordinary reader of this
 * instance has `fs_session` and no `fs_identity` and is missing every surface
 * drawn from one. This route is the upgrade, and what has to hold is that it
 * upgrades a journal session and nothing else.
 */

const jar: { cookies: Record<string, string> } = { cookies: {} };
const written: Record<string, string> = {};

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      jar.cookies[name] === undefined ? undefined : { value: jar.cookies[name] },
    set: (name: string, value: string) => {
      written[name] = value;
    },
  }),
}));

let dir: string;
let calls = 0;

/** The ordinary way in, and the one every reader on this instance took: a
 * six-digit code for one journal, which mints `fs_session` and — before B410
 * shipped — nothing else. */
async function signIn(email: string): Promise<string> {
  const { code } = await issueCode("ana", email, "guest");
  const session = await verifyCode("ana", email, code, "guest");
  if (!session.ok) throw new Error(`sign-in failed: ${session.reason}`);
  return session.token;
}

/** A fresh client ip per call, so the route's own rate limit never decides a
 * test's outcome. */
function post(): Request {
  calls += 1;
  return new Request("https://example.test/api/auth/identity/upgrade", {
    method: "POST",
    headers: { "x-forwarded-for": `10.9.0.${calls % 250}`, "user-agent": "Test/1" },
  });
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-upgrade-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "upgrade.db")}`;
  jar.cookies = {};
  for (const key of Object.keys(written)) delete written[key];

  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test" },
      users: { reserved: [] },
      features: {},
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
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("upgrading a pre-B410 reader", () => {
  test("a journal session earns an identity for the address it proved", async () => {
    jar.cookies.fs_session = await signIn("oma@example.test");

    const { POST } = await import("@/app/api/auth/identity/upgrade/route");
    const res = await POST(post());

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ issued: true });
    expect(await resolveSession(written.fs_identity, "identity")).toMatchObject({
      email: "oma@example.test",
    });
  });

  test("a reader who already holds one is left alone, so two tabs cannot mint two", async () => {
    const identity = await openIdentitySession("oma@example.test");
    jar.cookies.fs_session = await signIn("oma@example.test");
    jar.cookies.fs_identity = identity.token;

    const { POST } = await import("@/app/api/auth/identity/upgrade/route");
    const res = await POST(post());

    expect(await res.json()).toMatchObject({ issued: false });
    expect(written.fs_identity).toBeUndefined();
  });

  test("nothing in the jar mints nothing", async () => {
    const { POST } = await import("@/app/api/auth/identity/upgrade/route");
    const res = await POST(post());

    expect(res.status).toBe(401);
    expect(written.fs_identity).toBeUndefined();
  });

  /**
   * The kind check is decision 24, and this route is a new place it has to
   * hold: an agent token is a *write* credential, and it arrives in a header
   * rather than a cookie. Presented down the cookie channel it must mint
   * nothing — otherwise a leaked bearer token becomes a browser credential.
   */
  test("an agent token in the cookie jar mints nothing", async () => {
    const { token } = await openAgentSession("ana", "ana@example.test");
    jar.cookies.fs_session = token;

    const { POST } = await import("@/app/api/auth/identity/upgrade/route");
    const res = await POST(post());

    expect(res.status).toBe(401);
    expect(written.fs_identity).toBeUndefined();
  });
});
