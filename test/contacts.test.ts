import { afterEach, beforeEach, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { issueCode } from "@/lib/auth";
import {
  approveContact,
  confirmContact,
  deleteContact,
  deleteContactSelf,
  listContacts,
  manageTokenFor,
  requestContact,
  resolveManageToken,
  revokeContact,
  unsubscribeContact,
  updateContactSelf,
} from "@/lib/contacts";
import {
  ContactsKeyError,
  addressAad,
  contactsKey,
  decryptAddress,
  encryptAddress,
  isPostable,
  normaliseAddress,
} from "@/lib/contacts/crypto";
import { createInvite, listInvites, resolveInvite, revokeInvite } from "@/lib/contacts/invites";
import { fromAcceptLanguage, pickLocale } from "@/lib/contacts/locale";

/**
 * The contact record, end to end, with no mail account and no Postgres.
 *
 * Three of these are the ones that matter, and they are the three that would
 * be embarrassing to get wrong: a forwarded personal link must never become an
 * impersonation, a home address must be unreadable in a database dump, and one
 * owner must never see another's list.
 */

const KEY = "11".repeat(32);

const ADDRESS = {
  name: "A Reader",
  line1: "Bahnhofstrasse 1",
  line2: "",
  postcode: "8001",
  city: "Zurich",
  country: "Switzerland",
};

let dir: string;

async function signUp(
  owner: string,
  email: string,
  overrides: Partial<Parameters<typeof requestContact>[1]> = {},
) {
  return requestContact(owner, {
    name: "A Reader",
    email,
    locale: "de",
    address: null,
    wantsEmailDigest: true,
    wantsPostcard: false,
    createdVia: "open",
    ...overrides,
  });
}

/** Sign up and redeem the code, the way the two routes do in sequence. */
async function signUpAndConfirm(
  owner: string,
  email: string,
  overrides: Partial<Parameters<typeof requestContact>[1]> = {},
) {
  await signUp(owner, email, overrides);
  const { code } = await issueCode(owner, email, "guest");
  const result = await confirmContact(owner, email, code);
  if (!result.ok) throw new Error("expected the confirmation to succeed");
  return result;
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-contacts-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "contacts.db")}`;
  process.env.CONTACTS_ENCRYPTION_KEY = KEY;
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
  delete process.env.CONTACTS_ENCRYPTION_KEY;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("the encryption key", () => {
  test("takes 64 hex characters or 32 bytes of base64", () => {
    expect(contactsKey()).toHaveLength(32);
    process.env.CONTACTS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    expect(contactsKey()).toHaveLength(32);
  });

  test("refuses a key that is the wrong length rather than padding it", () => {
    process.env.CONTACTS_ENCRYPTION_KEY = "too-short";
    expect(() => contactsKey()).toThrow(ContactsKeyError);
  });

  test("refuses to work with no key at all", () => {
    delete process.env.CONTACTS_ENCRYPTION_KEY;
    expect(() => contactsKey()).toThrow(ContactsKeyError);
  });
});

describe("postal addresses", () => {
  test("survive a round trip", () => {
    const aad = addressAad("ana", "c1");
    expect(decryptAddress(encryptAddress(ADDRESS, aad), aad)).toEqual(ADDRESS);
  });

  test("cannot be moved from one contact to another", () => {
    const cipher = encryptAddress(ADDRESS, addressAad("ana", "c1"));
    expect(decryptAddress(cipher, addressAad("ana", "c2"))).toBeNull();
    expect(decryptAddress(cipher, addressAad("bea", "c1"))).toBeNull();
  });

  test("are unreadable with a different key", () => {
    const aad = addressAad("ana", "c1");
    const cipher = encryptAddress(ADDRESS, aad);
    process.env.CONTACTS_ENCRYPTION_KEY = "22".repeat(32);
    expect(decryptAddress(cipher, aad)).toBeNull();
  });

  test("a tampered ciphertext does not decrypt to something plausible", () => {
    const aad = addressAad("ana", "c1");
    const cipher = encryptAddress(ADDRESS, aad);
    const parts = cipher.split(".");
    parts[3] = `${parts[3].slice(0, -2)}AA`;
    expect(decryptAddress(parts.join("."), aad)).toBeNull();
  });

  test("an address needs a street, a town and a country to be postable", () => {
    expect(isPostable(normaliseAddress(ADDRESS))).toBe(true);
    expect(isPostable(normaliseAddress({ ...ADDRESS, city: "  " }))).toBe(false);
    expect(isPostable(normaliseAddress(null))).toBe(false);
  });

  /** The acceptance criterion: unreadable in the database without the key. */
  test("are not in the database in the clear", async () => {
    await signUp("ana", "oma@example.test", {
      address: ADDRESS,
      wantsPostcard: true,
    });

    const { db } = await getDatabase();
    const rows = await db.selectFrom("contacts").selectAll().execute();
    const dump = JSON.stringify(rows);

    expect(dump).not.toContain("Bahnhofstrasse");
    expect(dump).not.toContain("Zurich");
    expect(dump).not.toContain("8001");
    expect(rows[0].postal_cipher).toMatch(/^v1\./);

    // …and perfectly readable with it.
    const [contact] = await listContacts("ana");
    expect(contact.postalAddress).toEqual(ADDRESS);
    expect(contact.wantsPostcard).toBe(true);
  });

  test("asking for a postcard with nowhere to send it is not recorded as a yes", async () => {
    await signUp("ana", "oma@example.test", {
      address: { line1: "", city: "", country: "" },
      wantsPostcard: true,
    });
    const [contact] = await listContacts("ana");
    expect(contact.wantsPostcard).toBe(false);
    expect(contact.hasPostalAddress).toBe(false);
  });
});

describe("signing the guestbook", () => {
  test("creates a pending, unconfirmed contact and grants nothing", async () => {
    await signUp("ana", "oma@example.test");
    const [contact] = await listContacts("ana");
    expect(contact.status).toBe("pending");
    expect(contact.confirmedAt).toBeNull();

    const { db } = await getDatabase();
    expect(await db.selectFrom("access_grants").selectAll().execute()).toHaveLength(0);
  });

  test("filling it in twice corrects the first answer rather than making a twin", async () => {
    await signUp("ana", "oma@example.test");
    await signUp("ana", "OMA@Example.test", { name: "Oma Grete" });
    const contacts = await listContacts("ana");
    expect(contacts).toHaveLength(1);
    expect(contacts[0].name).toBe("Oma Grete");
  });

  test("a wrong code confirms nothing", async () => {
    await signUp("ana", "oma@example.test");
    await issueCode("ana", "oma@example.test", "guest");
    expect((await confirmContact("ana", "oma@example.test", "000000")).ok).toBe(false);
    expect((await listContacts("ana"))[0].confirmedAt).toBeNull();
  });

  test("confirming proves the address but does not let anybody in", async () => {
    const result = await signUpAndConfirm("ana", "oma@example.test");
    expect(result.contact.confirmedAt).not.toBeNull();
    expect(result.contact.status).toBe("pending");
    expect(result.firstConfirmation).toBe(true);

    const { db } = await getDatabase();
    expect(await db.selectFrom("access_grants").selectAll().execute()).toHaveLength(0);
  });

  test("confirming is not signing in: the session it mints is revoked at once", async () => {
    await signUpAndConfirm("ana", "oma@example.test");
    const { db } = await getDatabase();
    const sessions = await db.selectFrom("sessions").selectAll().execute();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].revoked_at).not.toBeNull();
  });

  test("an address the owner blocked cannot request its way back in", async () => {
    const { contact } = await signUpAndConfirm("ana", "oma@example.test");
    await revokeContact("ana", contact.id);
    expect(await signUp("ana", "oma@example.test")).toEqual({
      outcome: "ignored",
      contactId: null,
    });
    expect((await listContacts("ana"))[0].status).toBe("blocked");
  });
});

describe("approval", () => {
  test("is refused for an address nobody has proved they can read", async () => {
    await signUp("ana", "oma@example.test");
    const [contact] = await listContacts("ana");
    expect(await approveContact("ana", contact.id)).toBeNull();
    expect((await listContacts("ana"))[0].status).toBe("pending");
  });

  test("makes the contact active and writes exactly one grant", async () => {
    const { contact } = await signUpAndConfirm("ana", "oma@example.test");
    const approved = await approveContact("ana", contact.id);
    expect(approved?.status).toBe("active");
    expect(approved?.approvedAt).not.toBeNull();

    // Approving twice must not stack up grants.
    await approveContact("ana", contact.id);
    const { db } = await getDatabase();
    expect(await db.selectFrom("access_grants").selectAll().execute()).toHaveLength(1);
  });

  test("revoking blocks the contact and takes the grants away", async () => {
    const { contact } = await signUpAndConfirm("ana", "oma@example.test");
    await approveContact("ana", contact.id);
    const revoked = await revokeContact("ana", contact.id);
    expect(revoked?.status).toBe("blocked");

    const { db } = await getDatabase();
    expect(await db.selectFrom("access_grants").selectAll().execute()).toHaveLength(0);
  });
});

describe("the personal link", () => {
  test("carries a name and a language, and no address of any kind", async () => {
    const { token } = await createInvite("ana", { name: "Oma", locale: "de" });
    const invite = await resolveInvite("ana", token);
    expect(invite?.name).toBe("Oma");
    expect(invite?.locale).toBe("de");
    expect(JSON.stringify(invite)).not.toContain("@");
  });

  test("is stored hashed, so a database dump is not a list of who was invited", async () => {
    const { token } = await createInvite("ana", { name: "Oma", locale: "de" });
    const { db } = await getDatabase();
    const rows = await db.selectFrom("contact_invites").selectAll().execute();
    expect(rows[0].token_hash).not.toBe(token);
    expect(rows[0].token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  /**
   * Decision 19, and the acceptance criterion for it.
   *
   * Oma is sent a personal link and forwards it to her nephew. He fills the
   * same form in with his own address. What must happen: two separate pending
   * contacts, his marked as having come through her link — and *not* Oma's row
   * quietly acquiring his email, or his request inheriting whatever Oma had
   * been granted.
   */
  test("forwarding it makes a separate pending contact, never an impersonation", async () => {
    const { id, token } = await createInvite("ana", { name: "Oma", locale: "de" });

    const oma = await signUpAndConfirm("ana", "oma@example.test", {
      name: "Oma",
      createdVia: `invite:${id}`,
      inviteId: id,
    });
    await approveContact("ana", oma.contact.id);

    // The nephew opens the forwarded link. All it gave him is a greeting.
    const invite = await resolveInvite("ana", token);
    expect(invite?.name).toBe("Oma");

    const nephew = await signUpAndConfirm("ana", "nephew@example.test", {
      name: "Neffe",
      createdVia: `invite:${id}`,
      inviteId: id,
    });

    const contacts = await listContacts("ana");
    expect(contacts).toHaveLength(2);
    expect(nephew.contact.id).not.toBe(oma.contact.id);

    // He is his own person, pending, with no grant.
    expect(nephew.contact.email).toBe("nephew@example.test");
    expect(nephew.contact.status).toBe("pending");
    expect(nephew.contact.createdVia).toBe(`invite:${id}`);

    // And Oma is untouched: same address, same standing.
    const omaNow = contacts.find((c) => c.id === oma.contact.id);
    expect(omaNow?.email).toBe("oma@example.test");
    expect(omaNow?.status).toBe("active");

    const { db } = await getDatabase();
    const grants = await db.selectFrom("access_grants").selectAll().execute();
    expect(grants).toHaveLength(1);
    expect(grants[0].contact_id).toBe(oma.contact.id);

    // The link records that it travelled, which is the point of counting uses.
    expect((await listInvites("ana"))[0].uses).toBe(2);
  });

  test("cannot confirm somebody else's address with somebody else's code", async () => {
    const { id, token } = await createInvite("ana", { name: "Oma", locale: "de" });
    expect(await resolveInvite("ana", token)).not.toBeNull();

    await signUp("ana", "oma@example.test", { createdVia: `invite:${id}`, inviteId: id });
    await signUp("ana", "stranger@example.test", { createdVia: `invite:${id}`, inviteId: id });

    // The stranger asks for a code and tries it against Oma's address.
    const { code } = await issueCode("ana", "stranger@example.test", "guest");
    expect((await confirmContact("ana", "oma@example.test", code)).ok).toBe(false);

    const contacts = await listContacts("ana");
    expect(contacts.every((c) => c.confirmedAt === null)).toBe(true);
  });

  test("a revoked link resolves to nothing, and the open form still works", async () => {
    const { id, token } = await createInvite("ana", { name: "Oma", locale: "de" });
    await revokeInvite("ana", id);
    expect(await resolveInvite("ana", token)).toBeNull();
    expect(await resolveInvite("ana", "fs_inv_invented")).toBeNull();
  });

  test("an expired link resolves to nothing", async () => {
    const { token } = await createInvite("ana", {
      name: "Oma",
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    expect(await resolveInvite("ana", token)).toBeNull();
  });
});

describe("the self-serve page", () => {
  test("opens with a token and no login, and records the visit", async () => {
    const { contact, manageToken } = await signUpAndConfirm("ana", "oma@example.test");
    const self = await resolveManageToken("ana", manageToken);
    expect(self?.id).toBe(contact.id);
    expect(self?.lastSeenAt).not.toBeNull();
  });

  test("the token is derived, so every later mail can carry the same link", async () => {
    const { contact, manageToken } = await signUpAndConfirm("ana", "oma@example.test");
    expect(manageTokenFor("ana", contact.id)).toBe(manageToken);
    expect(await resolveManageToken("ana", manageTokenFor("ana", contact.id))).not.toBeNull();
  });

  test("only its sha-256 is stored", async () => {
    const { manageToken } = await signUpAndConfirm("ana", "oma@example.test");
    const { db } = await getDatabase();
    const rows = await db.selectFrom("contacts").selectAll().execute();
    expect(rows[0].manage_token_hash).not.toBe(manageToken);
    expect(rows[0].manage_token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("changes the language and the address", async () => {
    const { manageToken } = await signUpAndConfirm("ana", "oma@example.test");
    const updated = await updateContactSelf("ana", manageToken, {
      locale: "hu",
      address: ADDRESS,
      wantsPostcard: true,
    });
    expect(updated?.locale).toBe("hu");
    expect(updated?.postalAddress).toEqual(ADDRESS);

    const cleared = await updateContactSelf("ana", manageToken, { address: null });
    expect(cleared?.postalAddress).toBeNull();
    expect(cleared?.wantsPostcard).toBe(false);
  });

  test("one click stops every kind of message", async () => {
    const { manageToken } = await signUpAndConfirm("ana", "oma@example.test", {
      address: ADDRESS,
      wantsPostcard: true,
    });
    expect(await unsubscribeContact("ana", manageToken)).toBe(true);
    const self = await resolveManageToken("ana", manageToken);
    expect(self?.wantsEmailDigest).toBe(false);
    expect(self?.wantsPostcard).toBe(false);
  });

  test("delete me removes the contact and every grant with it", async () => {
    const { contact, manageToken } = await signUpAndConfirm("ana", "oma@example.test", {
      address: ADDRESS,
      wantsPostcard: true,
    });
    await approveContact("ana", contact.id);

    expect(await deleteContactSelf("ana", manageToken)).toBe(true);
    expect(await listContacts("ana")).toHaveLength(0);

    const { db } = await getDatabase();
    expect(await db.selectFrom("access_grants").selectAll().execute()).toHaveLength(0);
    expect(await resolveManageToken("ana", manageToken)).toBeNull();
  });

  test("an invented token resolves to nothing", async () => {
    await signUpAndConfirm("ana", "oma@example.test");
    expect(await resolveManageToken("ana", "fs_manage_nonsense")).toBeNull();
    expect(await resolveManageToken("ana", "")).toBeNull();
  });
});

describe("one owner cannot reach another's contacts", () => {
  test("listing, reading, approving and deleting all stop at the boundary", async () => {
    const ana = await signUpAndConfirm("ana", "oma@example.test", {
      address: ADDRESS,
      wantsPostcard: true,
    });
    await approveContact("ana", ana.contact.id);
    await signUpAndConfirm("bea", "someone@example.test");

    expect(await listContacts("ana")).toHaveLength(1);
    expect(await listContacts("bea")).toHaveLength(1);
    expect((await listContacts("bea"))[0].email).toBe("someone@example.test");

    // Bea holds Ana's contact id and Ana's manage token, and neither helps.
    expect(await resolveManageToken("bea", ana.manageToken)).toBeNull();
    expect(await approveContact("bea", ana.contact.id)).toBeNull();
    expect(await revokeContact("bea", ana.contact.id)).toBeNull();
    expect(await deleteContact("bea", ana.contact.id)).toBe(false);

    const stillThere = await listContacts("ana");
    expect(stillThere[0].status).toBe("active");
    expect(stillThere[0].postalAddress).toEqual(ADDRESS);
  });

  test("the same address may follow two journals as two separate records", async () => {
    await signUp("ana", "oma@example.test");
    await signUp("bea", "oma@example.test");
    const [forAna] = await listContacts("ana");
    const [forBea] = await listContacts("bea");
    expect(forAna.id).not.toBe(forBea.id);
  });

  test("invites do not cross either", async () => {
    const { token } = await createInvite("ana", { name: "Oma", locale: "de" });
    expect(await resolveInvite("bea", token)).toBeNull();
    expect(await listInvites("bea")).toHaveLength(0);
  });
});

describe("choosing a language", () => {
  test("honours the quality values a browser sends", () => {
    expect(fromAcceptLanguage("hu,en;q=0.9")).toBe("hu");
    expect(fromAcceptLanguage("en;q=0.4,de;q=0.9")).toBe("de");
    expect(fromAcceptLanguage("fr-FR,fr;q=0.9")).toBeNull();
    expect(fromAcceptLanguage(null)).toBeNull();
  });

  test("takes the first candidate this site actually speaks", () => {
    expect(pickLocale("de-CH", "en")).toBe("de");
    expect(pickLocale(null, undefined, "hu")).toBe("hu");
    expect(pickLocale("fr", "jp")).toBe("en");
  });
});

/**
 * One name on the wire.
 *
 * The join endpoint took `wantsDigest` while the record, the admin API, the
 * manage page and every response said `wantsEmailDigest` — so anything that
 * read a contact back and posted the same field name got a reader silently
 * opted out of the digest, with nothing to notice. Both are read now; the
 * canonical one wins.
 */
describe("the digest preference's name", () => {
  // The route checks the journal exists and has contacts switched on; the
  // library calls above do not, which is why these tests build a real one.
  beforeEach(() => {
    fs.mkdirSync(path.join(dir, "ana", "trips"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "ana", "config.json"),
      JSON.stringify({
        title: "Ana's journal",
        tagline: "t",
        owner: { name: "Ana B", nickname: "Ana" },
        startLocation: "X",
        defaultLocale: "de",
        locales: ["de"],
        baseCurrency: "CHF",
        displayCurrencies: ["CHF"],
        units: "metric",
        features: { contacts: { enabled: true } },
      }),
    );
    fs.writeFileSync(
      path.join(dir, "config.json"),
      JSON.stringify({
        site: { name: "R", url: "https://example.test", defaultUser: "ana" },
        users: { reserved: [] },
        features: { contacts: { enabled: true } },
      }),
    );
    clearConfigCache();
    clearUserCache();
  });

  async function post(body: Record<string, unknown>) {
    const { POST } = await import("@/app/api/contacts/request/route");
    const response = await POST(
      new Request("https://example.test/api/contacts/request", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ user: "ana", name: "A Reader", ...body }),
      }),
    );
    expect(response.status).toBe(202);
    const [contact] = (await listContacts("ana")).filter((c) => c.email === body.email);
    return contact;
  }

  test("wantsEmailDigest is read, as everything else spells it", async () => {
    const contact = await post({ email: "canonical@example.test", wantsEmailDigest: true });
    expect(contact.wantsEmailDigest).toBe(true);
  });

  test("wantsDigest still works, for the links and scripts already sending it", async () => {
    const contact = await post({ email: "legacy@example.test", wantsDigest: true });
    expect(contact.wantsEmailDigest).toBe(true);
  });

  test("neither means no", async () => {
    const contact = await post({ email: "quiet@example.test" });
    expect(contact.wantsEmailDigest).toBe(false);
  });
});
