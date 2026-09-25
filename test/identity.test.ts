import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import {
  NO_JOURNAL,
  SESSION_SCOPE,
  SESSION_TTL_MS,
  issueCode,
  listIdentities,
  openIdentitySession,
  resolveSession,
  revokeSession,
  verifyCode,
} from "@/lib/auth";

/**
 * B410 — the credential that belongs to an address rather than to a journal.
 *
 * Most of this file is about the wall rather than the feature. An identity
 * lasts a year and is handed out on every ordinary sign-in, so the property
 * that has to hold is that it opens **nothing**: `lookUpSession` compares
 * `kind` against what the caller asked for, and every gate in the codebase
 * asks for `"guest"` or `"agent"`. If that check ever softens, this becomes a
 * year-long skeleton key for every journal on the instance.
 */

let dir: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-identity-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "identity.db")}`;
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
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("the wall between an identity and everything else", () => {
  /**
   * The one that matters. An identity is the widest-reaching credential this
   * codebase issues — a year, every journal, handed out automatically — and
   * the only reason that is safe is that no gate accepts it.
   */
  test("an identity token is refused to every caller that asks for another kind", async () => {
    const { token } = await openIdentitySession("ana@example.test");

    expect(await resolveSession(token, "guest")).toBeNull();
    expect(await resolveSession(token, "agent")).toBeNull();
    expect(await resolveSession(token, "signup")).toBeNull();
    expect(await resolveSession(token, "handover")).toBeNull();

    // And it does resolve as what it is, so the nulls above are the kind check
    // rather than a token that never worked at all.
    expect(await resolveSession(token, "identity")).toMatchObject({
      email: "ana@example.test",
      owner: NO_JOURNAL,
      scope: SESSION_SCOPE.identity,
    });
  });

  test("a guest session is refused to a caller asking for an identity", async () => {
    await issueCode("ana", "bea@example.test", "guest");
    const { code } = await issueCode("ana", "bea@example.test", "guest");
    const guest = await verifyCode("ana", "bea@example.test", code, "guest");
    expect(guest.ok).toBe(true);
    if (!guest.ok) return;

    // The direction that would matter most if it broke: a journal cookie
    // standing in for proof about the whole instance.
    expect(await resolveSession(guest.token, "identity")).toBeNull();
  });

  test("an identity is filed under no journal, so it can never own one", async () => {
    const { token } = await openIdentitySession("ana@example.test");
    const session = await resolveSession(token, "identity");
    // `USERNAME_RE` has no `*`, so this can never collide with a real journal.
    expect(session?.owner).toBe(NO_JOURNAL);
  });
});

describe("issuing", () => {
  test("it lasts a year", async () => {
    const { expiresAt } = await openIdentitySession("ana@example.test");
    const life = new Date(expiresAt).getTime() - Date.now();
    // Within a minute of a year; the clock moves between the two calls.
    expect(Math.abs(life - SESSION_TTL_MS.identity)).toBeLessThan(60_000);
  });

  test("the address is normalised, so one person is one identity", async () => {
    const { token } = await openIdentitySession("  ANA@Example.Test ");
    expect((await resolveSession(token, "identity"))?.email).toBe("ana@example.test");
  });

  test("every identity carries an opaque public id, and no other kind does", async () => {
    const { publicId } = await openIdentitySession("ana@example.test");
    expect(publicId).toMatch(/^[0-9a-f]{32}$/);

    const { code } = await issueCode("ana", "bea@example.test", "guest");
    const guest = await verifyCode("ana", "bea@example.test", code, "guest");
    expect(guest.ok && guest.publicId).toBeNull();
  });

  test("the public id is not derived from the address", async () => {
    const first = await openIdentitySession("ana@example.test");
    const second = await openIdentitySession("ana@example.test");
    // Two devices, one address, two names. A hash of the email would collide
    // here — and would be the email, to anybody holding candidates to hash.
    expect(first.publicId).not.toBe(second.publicId);
  });

  test("the code flow mints exactly one identity, not one per step", async () => {
    const { code } = await issueCode(NO_JOURNAL, "ana@example.test", "identity");
    const result = await verifyCode(NO_JOURNAL, "ana@example.test", code, "identity");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.publicId).toMatch(/^[0-9a-f]{32}$/);
    // `verifyCode` opens the session itself; a route that minted a second one
    // beside it would leave an unreachable row in this list forever.
    expect(await listIdentities("ana@example.test")).toHaveLength(1);
  });

  test("a wrong code mints nothing", async () => {
    await issueCode(NO_JOURNAL, "ana@example.test", "identity");
    const result = await verifyCode(NO_JOURNAL, "ana@example.test", "000000", "identity");
    expect(result.ok).toBe(false);
    expect(await listIdentities("ana@example.test")).toHaveLength(0);
  });
});

describe("the device list", () => {
  test("lists this address's identities and nobody else's", async () => {
    await openIdentitySession("ana@example.test");
    await openIdentitySession("ana@example.test");
    await openIdentitySession("bea@example.test");

    expect(await listIdentities("ana@example.test")).toHaveLength(2);
    expect(await listIdentities("bea@example.test")).toHaveLength(1);
  });

  test("never returns a token", async () => {
    await openIdentitySession("ana@example.test");
    const [row] = await listIdentities("ana@example.test");
    expect(Object.keys(row)).not.toContain("token");
    expect(JSON.stringify(row)).not.toContain("fs_identity_");
  });

  test("a journal session is not a device", async () => {
    const { code } = await issueCode("ana", "ana@example.test", "guest");
    await verifyCode("ana", "ana@example.test", code, "guest");
    // Same address, but a guest session for one journal is not a statement
    // about this address across the instance and must not be listed as one.
    expect(await listIdentities("ana@example.test")).toHaveLength(0);
  });

  test("a revoked identity drops off the list and stops resolving", async () => {
    const { token } = await openIdentitySession("ana@example.test");
    const session = await resolveSession(token, "identity");
    expect(session).not.toBeNull();
    if (!session) return;

    await revokeSession(session.id);

    expect(await listIdentities("ana@example.test")).toHaveLength(0);
    expect(await resolveSession(token, "identity")).toBeNull();
  });

  test("revoking one device leaves the others alone", async () => {
    const first = await openIdentitySession("ana@example.test");
    const second = await openIdentitySession("ana@example.test");
    const session = await resolveSession(first.token, "identity");
    if (!session) throw new Error("no session");

    await revokeSession(session.id);

    expect(await resolveSession(first.token, "identity")).toBeNull();
    expect(await resolveSession(second.token, "identity")).not.toBeNull();
    expect(await listIdentities("ana@example.test")).toHaveLength(1);
  });
});
