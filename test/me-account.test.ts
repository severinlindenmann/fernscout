import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache, isReservedUsername } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import {
  issueCode,
  listIdentities,
  openAgentSession,
  openIdentitySession,
  resolveSession,
  revokeBrowserSessions,
  verifyCode,
} from "@/lib/auth";
import { writeTombstone } from "@/lib/tombstones";
import proxy from "@/proxy";

/**
 * `/me` — the account page that is about an address rather than a journal.
 *
 * Three properties: the name `me` belongs to the app now (and an old
 * tombstone cannot 410 the page), "sign out everywhere" ends every *browser*
 * sign-in of one address and nothing of anybody else's, and it leaves the
 * credentials a person minted on purpose for a machine alone.
 */

const jar: { cookies: Record<string, string> } = { cookies: {} };
const deleted: string[] = [];

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      jar.cookies[name] === undefined ? undefined : { value: jar.cookies[name] },
    set: () => {},
    delete: (name: string) => {
      deleted.push(name);
    },
  }),
}));

let dir: string;

async function journalSession(owner: string, email: string): Promise<string> {
  const { code } = await issueCode(owner, email, "guest");
  const session = await verifyCode(owner, email, code, "guest");
  if (!session.ok) throw new Error(`sign-in failed: ${session.reason}`);
  return session.token;
}

function del(origin?: string): Request {
  return new Request("https://example.test/api/v2/me/devices", {
    method: "DELETE",
    headers: origin ? { origin } : {},
  });
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-me-account-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "me.db")}`;
  process.env.SESSION_SECRET = "s".repeat(64);
  jar.cookies = {};
  deleted.length = 0;
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test" },
      users: { reserved: [] },
      features: { auth: { enabled: true } },
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

describe("the name me", () => {
  test("is reserved even with an empty operator list, so no journal can take /me", () => {
    expect(isReservedUsername("me")).toBe(true);
  });

  test("a tombstone left by a journal once called me does not 410 the account page", () => {
    writeTombstone({
      kind: "journal",
      username: "me",
      title: "Old",
      deletedAt: "2026-01-01T00:00:00.000Z",
      requestedBy: "old@example.test",
      held: { files: 0, bytes: 0 },
      notice: { lang: "en", title: "Gone", body: "Gone.", homeHref: "/", homeLabel: "Home" },
    });

    expect(proxy(new NextRequest(new Request("https://t.test/me")))?.status).not.toBe(410);
    // The guard is for that one name — any other tombstone still answers.
    writeTombstone({
      kind: "journal",
      username: "gone",
      title: "Old",
      deletedAt: "2026-01-01T00:00:00.000Z",
      requestedBy: "old@example.test",
      held: { files: 0, bytes: 0 },
      notice: { lang: "en", title: "Gone", body: "Gone.", homeHref: "/", homeLabel: "Home" },
    });
    expect(proxy(new NextRequest(new Request("https://t.test/@gone")))?.status).toBe(410);
  });
});

describe("revokeBrowserSessions", () => {
  test("ends every identity and every journal cookie of the address, and nothing else", async () => {
    const phone = await openIdentitySession("oma@example.test");
    const laptop = await openIdentitySession("oma@example.test");
    const inAna = await journalSession("ana", "oma@example.test");
    const inBea = await journalSession("bea", "oma@example.test");
    const agent = await openAgentSession("ana", "oma@example.test");
    const somebodyElse = await openIdentitySession("kim@example.test");

    expect(await revokeBrowserSessions("  OMA@example.test ")).toBe(4);

    expect(await resolveSession(phone.token, "identity")).toBeNull();
    expect(await resolveSession(laptop.token, "identity")).toBeNull();
    expect(await resolveSession(inAna, "guest")).toBeNull();
    expect(await resolveSession(inBea, "guest")).toBeNull();
    // A key minted on purpose for a machine is not a sign-in.
    expect(await resolveSession(agent.token, "agent")).not.toBeNull();
    // And another address is not this one.
    expect(await resolveSession(somebodyElse.token, "identity")).not.toBeNull();
    expect(await listIdentities("oma@example.test")).toEqual([]);
  });
});

describe("DELETE /api/v2/me/devices", () => {
  test("signs the address out everywhere and clears this browser's cookies", async () => {
    const here = await openIdentitySession("oma@example.test");
    const elsewhere = await openIdentitySession("oma@example.test");
    jar.cookies.fs_identity = here.token;

    const { DELETE } = await import("@/app/api/v2/me/devices/route");
    const res = await DELETE(del("https://example.test"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, revoked: 2 });
    expect(await resolveSession(elsewhere.token, "identity")).toBeNull();
    expect(deleted.sort()).toEqual(["fs_identity", "fs_session"]);
  });

  test("a foreign page cannot sign somebody out", async () => {
    const here = await openIdentitySession("oma@example.test");
    jar.cookies.fs_identity = here.token;

    const { DELETE } = await import("@/app/api/v2/me/devices/route");
    const res = await DELETE(del("https://evil.test"));

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "foreign_origin" });
    expect(await resolveSession(here.token, "identity")).not.toBeNull();
  });

  test("a journal cookie alone is not an identity, so it is refused", async () => {
    jar.cookies.fs_session = await journalSession("ana", "oma@example.test");

    const { DELETE } = await import("@/app/api/v2/me/devices/route");
    const res = await DELETE(del());

    expect(res.status).toBe(401);
    expect(await res.json()).toMatchObject({ error: "not_signed_in" });
    expect(await resolveSession(jar.cookies.fs_session, "guest")).not.toBeNull();
  });
});
