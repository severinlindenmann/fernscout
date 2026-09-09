import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { approveContact, confirmContact, requestContact, revokeContact } from "@/lib/contacts";
import { issueCode } from "@/lib/auth";
import { bookAddressFor, bookRecipients } from "@/lib/photobook/recipients";

/**
 * Task 4 of the Gelato photobook plan — who a book may be posted to.
 *
 * Same shape as `test/postcard-contacts.test.ts`, with the one deliberate
 * difference: a photobook does not require `wantsPostcard` consent, because a
 * book posted to yourself must not require having ticked a postcard box.
 * `status === "active"` and `isPostable` still both apply.
 */

const OWNER = "ana";
const KEY = "22".repeat(32);

const ADDRESS = {
  name: "A Reader",
  line1: "Bahnhofstrasse 1",
  line2: "",
  postcode: "8001",
  city: "Zurich",
  country: "Switzerland",
  tel: "+41 00 000 00 00",
};

let dir: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-photobook-recipients-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "contacts.db")}`;
  process.env.CONTACTS_ENCRYPTION_KEY = KEY;
  delete process.env.AUTH_DEV_CODE;

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
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function activeContact(
  email: string,
  overrides: Partial<Parameters<typeof requestContact>[1]> = {},
) {
  const { contactId } = await requestContact(OWNER, {
    name: "A Reader",
    email,
    locale: "en",
    address: null,
    wantsEmailDigest: false,
    wantsPostcard: false,
    createdVia: "owner",
    ...overrides,
  });
  const { code } = await issueCode(OWNER, email, "guest");
  const confirmed = await confirmContact(OWNER, email, code);
  if (!confirmed.ok) throw new Error(`confirm failed for ${email}`);
  const approved = await approveContact(OWNER, contactId!);
  if (!approved || approved.contact.status !== "active") throw new Error(`approve failed for ${email}`);
  return contactId!;
}

describe("bookRecipients", () => {
  test("offers an active contact with an address who never asked for postcards", async () => {
    const id = await activeContact("noconsent@example.test", {
      address: ADDRESS,
      wantsPostcard: false,
    });
    const rows = await bookRecipients(OWNER);
    expect(rows.map((r) => r.id)).toContain(id);
  });

  test("does not offer a pending or blocked contact", async () => {
    await requestContact(OWNER, {
      name: "Pending Person",
      email: "pending@example.test",
      locale: "en",
      address: ADDRESS,
      wantsEmailDigest: false,
      wantsPostcard: false,
      createdVia: "owner",
    });
    const { code } = await issueCode(OWNER, "pending@example.test", "guest");
    await confirmContact(OWNER, "pending@example.test", code);

    const blockedId = await activeContact("blocked@example.test", { address: ADDRESS });
    await revokeContact(OWNER, blockedId);

    const ids = (await bookRecipients(OWNER)).map((r) => r.id);
    expect(ids).not.toContain(blockedId);
    expect(ids).toEqual([]);
  });

  test("does not offer somebody with no postable address", async () => {
    const id = await activeContact("emailonly@example.test", { address: null });
    expect((await bookRecipients(OWNER)).map((r) => r.id)).not.toContain(id);
  });

  test("never returns a street to a caller listing recipients", async () => {
    await activeContact("postable@example.test", { address: ADDRESS });
    const rows = await bookRecipients(OWNER);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      // `self` joined these in B1093 so the order page can preselect the
      // owner. It is a boolean about which row this is, not another fact
      // about the person — the list is still a name and a town.
      expect(Object.keys(row)).toEqual(["id", "name", "city", "country", "self"]);
      // The address is resolved by `bookAddressFor`, server-side, at print
      // time. None of it — nor the email `eligible` now carries to work out
      // `self` — may ride along here.
      for (const leak of ["email", "line1", "line2", "postcode", "address", "to"]) {
        expect(row).not.toHaveProperty(leak);
      }
    }
  });

  test("marks the journal's owner, and nobody else, as self", async () => {
    // `self` is read from the journal's own `owner.email`, so the journal has
    // to exist for there to be an owner to match — B1093.
    fs.mkdirSync(path.join(dir, OWNER), { recursive: true });
    fs.writeFileSync(
      path.join(dir, OWNER, "config.json"),
      JSON.stringify({
        title: "A Journal",
        owner: { name: "Ana", nickname: "Ana", email: "ANA@example.test" },
      }),
    );
    clearUserCache();

    // Deliberately cased differently from the config above: an address is not
    // case-sensitive, and an owner who typed theirs in capitals is still the
    // owner.
    const mine = await activeContact("ana@example.test", { address: ADDRESS });
    const theirs = await activeContact("someone-else@example.test", { address: ADDRESS });
    const rows = await bookRecipients(OWNER);
    expect(rows.find((r) => r.id === mine)?.self).toBe(true);
    expect(rows.find((r) => r.id === theirs)?.self).toBe(false);
  });

  test("marks nobody as self when the journal names no owner address", async () => {
    const id = await activeContact("someone@example.test", { address: ADDRESS });
    const rows = await bookRecipients(OWNER);
    // An ownerless journal must not fall through to matching the empty string
    // against every contact, which would preselect the first person listed.
    expect(rows.find((r) => r.id === id)?.self).toBe(false);
  });
});

describe("bookAddressFor", () => {
  test("resolves an eligible contact's full address", async () => {
    const id = await activeContact("full@example.test", { address: ADDRESS });
    const address = await bookAddressFor(OWNER, id);
    expect(address).toEqual({
      name: "A Reader",
      line1: "Bahnhofstrasse 1",
      line2: undefined,
      postcode: "8001",
      city: "Zurich",
      country: "Switzerland",
    });
  });

  test("returns null for an id that is not eligible", async () => {
    expect(await bookAddressFor(OWNER, "nonexistent")).toBeNull();
  });
});
