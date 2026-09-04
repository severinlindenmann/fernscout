import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { approveContact, confirmContact, requestContact } from "@/lib/contacts";
import { issueCode } from "@/lib/auth";
import { postcardRecipientsFromContacts } from "@/lib/postcard/contacts";

/**
 * B273 — `send-postcards` finding a recipient from a contact rather than
 * being handed one, which is the half of the pipeline `scripts/postcard.ts`
 * had promised since it was written ("Once the contacts work lands, this
 * reads from the contacts table instead").
 *
 * Three gates a row has to clear, tested against three rows that each clear
 * only two of them: an address with nobody's consent to post to it, a
 * consenting reader with no address, and a consenting, postable reader who is
 * still only `pending`.
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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-postcard-contacts-"));
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

/** A contact taken all the way to `active`, with whatever address and consent
 * the caller asks for. */
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
  if (!approved || approved.status !== "active") throw new Error(`approve failed for ${email}`);
  return contactId!;
}

describe("postcardRecipientsFromContacts", () => {
  test("a contact with both fields — postable and consenting — is a recipient", async () => {
    await activeContact("postable@example.test", {
      name: "Postable Person",
      address: ADDRESS,
      wantsPostcard: true,
    });

    const recipients = await postcardRecipientsFromContacts(OWNER);
    expect(recipients).toHaveLength(1);
    expect(recipients[0]).toEqual({
      name: "A Reader",
      line1: "Bahnhofstrasse 1",
      line2: undefined,
      postcode: "8001",
      city: "Zurich",
      country: "Switzerland",
    });
    // The phone number never crosses into a postcard recipient.
    expect(JSON.stringify(recipients[0])).not.toContain("+41");
  });

  test("a contact with neither field is not a recipient, and breaks nothing", async () => {
    await activeContact("neither@example.test", { address: null, wantsPostcard: false });
    expect(await postcardRecipientsFromContacts(OWNER)).toEqual([]);
  });

  test("an address with no consent is not a recipient", async () => {
    await activeContact("noconsent@example.test", { address: ADDRESS, wantsPostcard: false });
    expect(await postcardRecipientsFromContacts(OWNER)).toEqual([]);
  });

  test("consent with no postable address is not a recipient", async () => {
    // A tel-only address: not enough to put on an envelope, per `isPostable`.
    await activeContact("phoneonly@example.test", {
      address: { name: "", line1: "", line2: "", postcode: "", city: "", country: "", tel: "+41 1" },
      wantsPostcard: true,
    });
    expect(await postcardRecipientsFromContacts(OWNER)).toEqual([]);
  });

  test("a postable, consenting contact who is still pending is not a recipient", async () => {
    await requestContact(OWNER, {
      name: "Pending Person",
      email: "pending@example.test",
      locale: "en",
      address: ADDRESS,
      wantsEmailDigest: false,
      wantsPostcard: true,
      createdVia: "owner",
    });
    // Confirmed, but never approved — still `pending`, never `active`.
    const { code } = await issueCode(OWNER, "pending@example.test", "guest");
    await confirmContact(OWNER, "pending@example.test", code);

    expect(await postcardRecipientsFromContacts(OWNER)).toEqual([]);
  });

  test("the envelope name falls back to the contact's name, then their email", async () => {
    await activeContact("noname@example.test", {
      name: "",
      address: { ...ADDRESS, name: "" },
      wantsPostcard: true,
    });
    const [recipient] = await postcardRecipientsFromContacts(OWNER);
    // No name was ever given anywhere, `requestContact` refuses an empty one
    // (`name || existing.name`) only when there is something to fall back to
    // — here there is not, so the email is what is left.
    expect(recipient.name).toBe("noname@example.test");
  });

  test("one owner's recipients never include another's", async () => {
    await activeContact("mine@example.test", { address: ADDRESS, wantsPostcard: true });
    expect(await postcardRecipientsFromContacts("somebody-else")).toEqual([]);
  });
});
