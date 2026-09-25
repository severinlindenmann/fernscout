import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

import { confirmContactByOwner, getContact, grantContactAccess, listContacts, revokeContact } from "@/lib/contacts";
import { hasReadGrant } from "@/lib/grants";

/**
 * B1833, D11 — "an owner grants a named address direct access."
 *
 * `grantContactAccess` is the one call this ticket's invite flow makes, and
 * it has to do all three things D11 promises in one step: the row exists,
 * it is `active` with no code ever having been sent to the address, and a
 * live `access_grants` row backs it — the same thing `isJournalGuest`
 * actually checks (`lib/contacts/session.ts`).
 */

const KEY = "22".repeat(32);
let dir: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-grant-access-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "grants.db")}`;
  process.env.CONTACTS_ENCRYPTION_KEY = KEY;
  process.env.SESSION_SECRET = "grant-access-test-secret-b1833";
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({ site: { name: "R", url: "https://example.test" }, users: { reserved: [] }, features: {} }),
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
  delete process.env.CONTACTS_ENCRYPTION_KEY;
  delete process.env.SESSION_SECRET;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("grantContactAccess", () => {
  test("the address reads immediately: active status, confirmed with no code, a live grant", async () => {
    const result = await grantContactAccess("owner", { name: "Priya", email: "priya@example.test", locale: "en" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.contact.status).toBe("active");
    expect(result.contact.confirmedAt).not.toBeNull();
    expect(result.contact.approvedAt).not.toBeNull();

    const live = await hasReadGrant("owner", result.contact.id);
    expect(live).toBe(true);
  });

  test("createdVia records an owner grant, not the ordinary invite door", async () => {
    const result = await grantContactAccess("owner", { name: "Priya", email: "priya@example.test", locale: "en" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.contact.createdVia).toBe("owner-grant");
  });

  test("a blocked address is refused, not silently re-granted", async () => {
    const first = await grantContactAccess("owner", { name: "Priya", email: "priya@example.test", locale: "en" });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    await revokeContact("owner", first.contact.id);

    const second = await grantContactAccess("owner", { name: "Priya", email: "priya@example.test", locale: "en" });
    expect(second).toEqual({ ok: false, error: "blocked_contact" });
  });

  test("one owner's grant never crosses into another owner's list", async () => {
    await grantContactAccess("owner-a", { name: "Priya", email: "priya@example.test", locale: "en" });
    const listB = await listContacts("owner-b");
    expect(listB).toHaveLength(0);
  });
});

describe("confirmContactByOwner", () => {
  test("never overwrites a confirmation the address already proved itself", async () => {
    const result = await grantContactAccess("owner", { name: "Priya", email: "priya@example.test", locale: "en" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const before = result.contact.confirmedAt;

    // Calling it again on an already-confirmed row must be a no-op — the
    // `where confirmed_at is null` guard is what keeps a genuine proof from
    // ever being silently replaced by this door.
    await confirmContactByOwner("owner", result.contact.id);
    const after = await getContact("owner", result.contact.id);
    expect(after?.confirmedAt).toBe(before);
  });
});
