import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import {
  MAX_CODE_ATTEMPTS,
  SESSION_TTL_MS,
  generateCode,
  issueCode,
  listSessions,
  resolveSession,
  revokeSession,
  verifyCode,
} from "@/lib/auth";

/**
 * The whole flow, with no mail account and no database server: SQLite in a temp
 * file, codes read straight from the return value the mail would have carried.
 */

let dir: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-auth-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "auth.db")}`;
  delete process.env.AUTH_DEV_CODE;

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
  delete process.env.AUTH_DEV_CODE;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("codes", () => {
  test("are six digits", () => {
    for (let i = 0; i < 50; i++) expect(generateCode()).toMatch(/^\d{6}$/);
  });

  test("AUTH_DEV_CODE fixes the code, so end-to-end tests need no inbox", () => {
    process.env.AUTH_DEV_CODE = "123456";
    expect(generateCode()).toBe("123456");
  });

  test("a correct code produces a session", async () => {
    const { code } = await issueCode("ana", "reader@example.test", "guest");
    const result = await verifyCode("ana", "reader@example.test", code, "guest");
    expect(result.ok).toBe(true);
  });

  test("the address is matched case-insensitively", async () => {
    const { code } = await issueCode("ana", "Reader@Example.test", "guest");
    const result = await verifyCode("ana", "reader@EXAMPLE.test", code, "guest");
    expect(result.ok).toBe(true);
  });

  test("a code is single use", async () => {
    const { code } = await issueCode("ana", "r@example.test", "guest");
    expect((await verifyCode("ana", "r@example.test", code, "guest")).ok).toBe(true);
    expect((await verifyCode("ana", "r@example.test", code, "guest")).ok).toBe(false);
  });

  test("requesting a new code invalidates the previous one", async () => {
    const first = await issueCode("ana", "r@example.test", "guest");
    await issueCode("ana", "r@example.test", "guest");
    const result = await verifyCode("ana", "r@example.test", first.code, "guest");
    expect(result.ok).toBe(false);
  });

  test("a wrong code five times burns it, and the right one then fails too", async () => {
    const { code } = await issueCode("ana", "r@example.test", "guest");
    for (let i = 0; i < MAX_CODE_ATTEMPTS; i++) {
      expect((await verifyCode("ana", "r@example.test", "000000", "guest")).ok).toBe(false);
    }
    const result = await verifyCode("ana", "r@example.test", code, "guest");
    expect(result.ok).toBe(false);
  });

  test("a code for one user does not work for another", async () => {
    const { code } = await issueCode("ana", "r@example.test", "guest");
    expect((await verifyCode("bea", "r@example.test", code, "guest")).ok).toBe(false);
  });

  /** A read code must never be redeemable for a token that writes. */
  test("a guest code cannot be redeemed as an agent code", async () => {
    const { code } = await issueCode("ana", "r@example.test", "guest");
    expect((await verifyCode("ana", "r@example.test", code, "agent")).ok).toBe(false);
  });

  test("an expired code is refused", async () => {
    const { code } = await issueCode("ana", "r@example.test", "guest");
    const { db } = await getDatabase();
    await db
      .updateTable("login_codes")
      .set({ expires_at: new Date(Date.now() - 1000).toISOString() })
      .execute();
    expect((await verifyCode("ana", "r@example.test", code, "guest")).ok).toBe(false);
  });

  test("the code is never stored in the clear", async () => {
    const { code } = await issueCode("ana", "r@example.test", "guest");
    const { db } = await getDatabase();
    const rows = await db.selectFrom("login_codes").selectAll().execute();
    expect(rows[0].code_hash).not.toBe(code);
    expect(rows[0].code_hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("sessions", () => {
  async function login(kind: "guest" | "agent") {
    const { code } = await issueCode("ana", "r@example.test", kind);
    const result = await verifyCode("ana", "r@example.test", code, kind);
    if (!result.ok) throw new Error("expected the login to succeed");
    return result;
  }

  test("a guest session lasts about a year, an agent token seven days", async () => {
    const guest = await login("guest");
    const agent = await login("agent");
    const days = (iso: string) => (new Date(iso).getTime() - Date.now()) / 86_400_000;
    expect(days(guest.expiresAt)).toBeGreaterThan(360);
    expect(days(agent.expiresAt)).toBeGreaterThan(6);
    expect(days(agent.expiresAt)).toBeLessThan(8);
    expect(SESSION_TTL_MS.agent).toBeLessThan(SESSION_TTL_MS.guest);
  });

  test("scopes differ: agents write, guests read", async () => {
    expect((await login("agent")).scope).toBe("write:content");
    expect((await login("guest")).scope).toBe("read");
  });

  test("a token resolves to its session", async () => {
    const { token } = await login("guest");
    const session = await resolveSession(token, "guest");
    expect(session?.email).toBe("r@example.test");
    expect(session?.owner).toBe("ana");
  });

  /** The crossover guard: two classes, two channels, no interchange. */
  test("an agent token is refused where a guest cookie is expected", async () => {
    const { token } = await login("agent");
    expect(await resolveSession(token, "guest")).toBeNull();
    expect(await resolveSession(token, "agent")).not.toBeNull();
  });

  test("a guest cookie is refused where a bearer token is expected", async () => {
    const { token } = await login("guest");
    expect(await resolveSession(token, "agent")).toBeNull();
  });

  test("an unknown or empty token resolves to nothing", async () => {
    expect(await resolveSession("fs_guest_nonsense", "guest")).toBeNull();
    expect(await resolveSession(undefined, "guest")).toBeNull();
    expect(await resolveSession("", "guest")).toBeNull();
  });

  test("revoking stops the very next request", async () => {
    const { token } = await login("guest");
    const session = await resolveSession(token, "guest");
    await revokeSession(session!.id);
    expect(await resolveSession(token, "guest")).toBeNull();
  });

  test("an expired session is refused", async () => {
    const { token } = await login("guest");
    const { db } = await getDatabase();
    await db
      .updateTable("sessions")
      .set({ expires_at: new Date(Date.now() - 1000).toISOString() })
      .execute();
    expect(await resolveSession(token, "guest")).toBeNull();
  });

  test("the token is never stored in the clear", async () => {
    const { token } = await login("guest");
    const { db } = await getDatabase();
    const rows = await db.selectFrom("sessions").selectAll().execute();
    expect(rows[0].token_hash).not.toBe(token);
    expect(rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("the admin listing shows sessions and never a token", async () => {
    await login("guest");
    const rows = await listSessions("ana");
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain("fs_guest_");
  });

  test("sessions are scoped to their owner", async () => {
    await login("guest");
    expect(await listSessions("bea")).toHaveLength(0);
  });
});
