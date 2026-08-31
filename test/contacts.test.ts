import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { issueCode, verifyCode } from "@/lib/auth";

// `isOwner` (`lib/contacts/session.ts`) reads the guest cookie via
// `next/headers`'s `cookies()`, which throws outside a real Next.js request
// scope. The admin route tests below authenticate with an agent bearer token
// instead — a header on the `Request` they build by hand — so this stub only
// needs to hand back an empty jar and let that path through.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));
import {
  approveContact,
  confirmContact,
  deleteContact,
  deleteContactSelf,
  getContact,
  listContacts,
  manageTokenFor,
  requestContact,
  resolveManageToken,
  revokeContact,
  unsubscribeContact,
  updateContactByOwner,
  updateContactSelf,
} from "@/lib/contacts";
import {
  ContactsKeyError,
  EMPTY_ADDRESS,
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
  tel: "",
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

describe("a telephone number", () => {
  test("survives the round trip", () => {
    const aad = addressAad("u", "c1");
    const address = { ...EMPTY_ADDRESS, tel: "+41 79 000 00 00", line1: "1 Road", city: "Bern", country: "CH" };
    expect(decryptAddress(encryptAddress(address, aad), aad)?.tel).toBe("+41 79 000 00 00");
  });

  test("a tel alone does not make somebody postable", () => {
    expect(isPostable({ ...EMPTY_ADDRESS, tel: "+41 79 000 00 00" })).toBe(false);
  });

  test("a blob written before this field decrypts with an empty tel", () => {
    const aad = addressAad("u", "c2");
    // Encrypt a payload with no tel key at all, as existing rows hold. Built
    // via a JSON round trip rather than a type assertion, so the object
    // genuinely lacks the field instead of merely being told to pretend it
    // has one.
    const legacy = encryptAddress(
      JSON.parse(
        JSON.stringify({
          name: "",
          line1: "1 Road",
          line2: "",
          postcode: "",
          city: "Bern",
          country: "CH",
        }),
      ),
      aad,
    );
    expect(decryptAddress(legacy, aad)?.tel).toBe("");
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

  /**
   * The bug (second W37 followup round, IMPORTANT 2): the write that sets
   * `status: "active"` carried only `.where("id", "=", id)`, safe today only
   * because it is reached through an `owner_id`-scoped `getContact` a few
   * lines above — the same pattern item 3 fixed on `updateContactByOwner`'s
   * write, on the highest-stakes write in the file: this is the one that
   * grants read access to every `guest`-visibility trip. `revokeContact`'s
   * sibling write already carries the clause. As with `updateContactByOwner`,
   * there is no way to make this observably wrong through the exported
   * function today (the read and the write share the same `owner`
   * parameter, and `id` is globally unique), so this inspects the compiled
   * query rather than a data outcome — see the identical test above for
   * `updateContactByOwner`.
   */
  test("the approving write itself is scoped to the owner, not only the read that precedes it", async () => {
    const { contact } = await signUpAndConfirm("ana", "oma@example.test");

    const { db } = await getDatabase();
    const whereCalls: unknown[][] = [];
    function watch<T extends object>(builder: T): T {
      return new Proxy(builder, {
        get(target, prop, receiver) {
          const value = Reflect.get(target, prop, receiver) as unknown;
          if (typeof value !== "function") return value;
          return (...args: unknown[]) => {
            if (prop === "where") whereCalls.push(args);
            const result = (value as (...a: unknown[]) => unknown).apply(target, args);
            return result && typeof result === "object" && typeof (result as { then?: unknown }).then !== "function"
              ? watch(result as object)
              : result;
          };
        },
      });
    }
    const loose = db as unknown as { updateTable: (table: unknown) => object };
    const original = loose.updateTable.bind(loose);
    const spy = vi
      .spyOn(loose, "updateTable")
      .mockImplementation((table: unknown) =>
        table === "contacts" ? watch(original(table)) : original(table),
      );

    try {
      await approveContact("ana", contact.id);
    } finally {
      spy.mockRestore();
    }

    const scopedToOwner = whereCalls.some(
      (args) => args[0] === "owner_id" && args[1] === "=" && args[2] === "ana",
    );
    expect(scopedToOwner).toBe(true);
  });
});

describe("the owner adding a guest", () => {
  test("creates a pending contact, marked as the owner's doing", async () => {
    const { contactId } = await requestContact("u", {
      name: "Gran", email: "gran@example.com", locale: "en",
      address: { line1: "1 Road", city: "Bern", country: "CH", tel: "+41 79 000 00 00" },
      wantsEmailDigest: false, wantsPostcard: true, createdVia: "owner",
    });
    const contact = await getContact("u", contactId!);
    expect(contact?.status).toBe("pending");
    expect(contact?.createdVia).toBe("owner");
    expect(contact?.postalAddress?.tel).toBe("+41 79 000 00 00");
  });

  /**
   * The bug in this round: `isPostable()` governs the postcard consent, not
   * whether the encrypted blob gets written at all. Both write paths used to
   * decide "encrypt, or store null" off `isPostable`, which meant a contact
   * saved with only a phone number — no street, no city, no country — was
   * silently discarded on both `create` and `update`. `hasAnyDetail` fixes
   * that; `isPostable` still means exactly what it always has.
   */
  test("a phone number alone round-trips and does not make the contact postable", async () => {
    const { contactId } = await requestContact("u", {
      name: "Gran", email: "tel-only@example.com", locale: "en",
      address: { tel: "+41 79 000 00 00" },
      wantsEmailDigest: false, wantsPostcard: false, createdVia: "owner",
    });
    const created = await getContact("u", contactId!);
    expect(created?.postalAddress?.tel).toBe("+41 79 000 00 00");
    expect(created?.hasPostalAddress).toBe(true);
    expect(isPostable(created!.postalAddress!)).toBe(false);

    // The same predicate governs `updateContactByOwner`.
    const { contactId: id2 } = await requestContact("u", {
      name: "Gramps", email: "tel-only-2@example.com", locale: "en",
      wantsEmailDigest: false, wantsPostcard: false, createdVia: "owner",
    });
    const updated = await updateContactByOwner("u", id2!, {
      address: { tel: "+41 79 111 11 11" },
    });
    expect(updated?.postalAddress?.tel).toBe("+41 79 111 11 11");
    expect(updated?.hasPostalAddress).toBe(true);
    expect(isPostable(updated!.postalAddress!)).toBe(false);
  });

  test("a pending contact can still be posted to", async () => {
    const { contactId } = await requestContact("u", {
      name: "Gran", email: "gran2@example.com", locale: "en",
      address: { line1: "1 Road", city: "Bern", country: "CH" },
      wantsEmailDigest: false, wantsPostcard: true, createdVia: "owner",
    });
    const contact = await getContact("u", contactId!);
    expect(contact?.status).toBe("pending");
    expect(contact?.wantsPostcard).toBe(true);
    expect(contact?.hasPostalAddress).toBe(true);
  });

  test("update corrects the address and leaves the status alone", async () => {
    const { contactId } = await requestContact("u", {
      name: "Gran", email: "gran3@example.com", locale: "en",
      address: { line1: "1 Road", city: "Bern", country: "CH" },
      wantsEmailDigest: false, wantsPostcard: true, createdVia: "owner",
    });
    const before = await getContact("u", contactId!);
    const after = await updateContactByOwner("u", contactId!, {
      address: { line1: "2 Road", city: "Bern", country: "CH" },
    });
    expect(after?.postalAddress?.line1).toBe("2 Road");
    expect(after?.status).toBe(before?.status);
  });

  test("update returns null for a contact in another journal", async () => {
    const { contactId } = await requestContact("u", {
      name: "Gran", email: "gran4@example.com", locale: "en",
      wantsEmailDigest: false, wantsPostcard: false, createdVia: "owner",
    });
    expect(await updateContactByOwner("other", contactId!, { name: "X" })).toBeNull();
  });

  /**
   * The fix in this round: `updateContactByOwner` cannot *set* `status`, but
   * changing the email on an already-active row used to leave `status:
   * "active"`, `confirmed_at` set and the `access_grants` row untouched — an
   * address nobody has proved they can read, still let in behind a
   * `guest`-visibility trip. `resolveViewer` looks a contact up by email, so
   * that was `approveContact`'s refusal reached through a side door. An email
   * change now knocks the row back to `pending`, same shape `revokeContact`
   * already writes.
   */
  test("changing the email of an active, confirmed contact de-approves it", async () => {
    const { contact } = await signUpAndConfirm("u", "before@example.com", {
      createdVia: "owner",
    });
    expect((await approveContact("u", contact.id))?.status).toBe("active");

    const after = await updateContactByOwner("u", contact.id, { email: "after@example.com" });
    expect(after?.status).toBe("pending");
    expect(after?.confirmedAt).toBeNull();
    expect(after?.email).toBe("after@example.com");

    const { db } = await getDatabase();
    const grants = await db
      .selectFrom("access_grants")
      .selectAll()
      .where("contact_id", "=", contact.id)
      .execute();
    expect(grants).toHaveLength(0);
  });

  test("correcting something other than the email leaves status and confirmation alone", async () => {
    const { contact } = await signUpAndConfirm("u", "stays@example.com", {
      createdVia: "owner",
    });
    await approveContact("u", contact.id);

    const after = await updateContactByOwner("u", contact.id, {
      name: "New Name",
      email: "stays@example.com", // same address, re-sent as the form would
    });
    expect(after?.status).toBe("active");
    expect(after?.confirmedAt).not.toBeNull();
    expect(after?.name).toBe("New Name");

    const { db } = await getDatabase();
    const grants = await db
      .selectFrom("access_grants")
      .selectAll()
      .where("contact_id", "=", contact.id)
      .execute();
    expect(grants).toHaveLength(1);
  });

  /**
   * The bug: the write itself carried only `.where("id", "=", id)`, safe
   * today only because it is reached through an `owner_id`-scoped SELECT a
   * few lines above and `id` is the table's global primary key — one refactor
   * of either away from a cross-journal write. Defence in depth, on the write
   * itself: assert the compiled query actually carries `owner_id` as one of
   * its predicates, rather than relying on the read guard alone. There is no
   * way to make this observably wrong through the exported function today
   * (the SELECT and the write share the same `owner` parameter, and `id` is
   * globally unique), so this inspects the query Kysely builds rather than a
   * data outcome.
   */
  test("the write itself is scoped to the owner, not only the read that precedes it", async () => {
    const { contactId } = await requestContact("u", {
      name: "Gran", email: "scope-check@example.com", locale: "en",
      wantsEmailDigest: false, wantsPostcard: false, createdVia: "owner",
    });

    const { db } = await getDatabase();
    // Recursively wrap whatever `db.updateTable("contacts")` returns, so every
    // `.where(...)` call in the chain is recorded regardless of how many
    // immutable builder objects it passes through before `.execute()`.
    const whereCalls: unknown[][] = [];
    function watch<T extends object>(builder: T): T {
      return new Proxy(builder, {
        get(target, prop, receiver) {
          const value = Reflect.get(target, prop, receiver) as unknown;
          if (typeof value !== "function") return value;
          return (...args: unknown[]) => {
            if (prop === "where") whereCalls.push(args);
            const result = (value as (...a: unknown[]) => unknown).apply(target, args);
            return result && typeof result === "object" && typeof (result as { then?: unknown }).then !== "function"
              ? watch(result as object)
              : result;
          };
        },
      });
    }
    // Kysely's `updateTable` is generic over the table name in a way that
    // does not admit a loose mock signature; the query it returns is only
    // being watched here, not typed against, so the object is untyped for
    // the span of the spy.
    const loose = db as unknown as { updateTable: (table: unknown) => object };
    const original = loose.updateTable.bind(loose);
    const spy = vi
      .spyOn(loose, "updateTable")
      .mockImplementation((table: unknown) =>
        table === "contacts" ? watch(original(table)) : original(table),
      );

    try {
      await updateContactByOwner("u", contactId!, { name: "Corrected" });
    } finally {
      spy.mockRestore();
    }

    const scopedToOwner = whereCalls.some(
      (args) => args[0] === "owner_id" && args[1] === "=" && args[2] === "u",
    );
    expect(scopedToOwner).toBe(true);
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

  /**
   * The bug: the guest's own manage form (`ContactManage.tsx`) has no `tel`
   * field, so every save resends the address it knows about minus `tel` —
   * even a save that only changed a preference checkbox, because the form
   * posts the whole address state on every submit. `updateContactSelf` used
   * to re-encrypt straight from that object, so the phone number the owner
   * had recorded was gone after the guest's very next save.
   */
  test("a guest updating only their preferences keeps the tel", async () => {
    const withTel = { ...ADDRESS, tel: "+41 79 111 11 11" };
    const { manageToken } = await signUpAndConfirm("ana", "keeps-tel-1@example.test", {
      address: withTel,
    });

    // What `ContactManage.tsx` actually posts: every address field it has, and
    // no `tel` key at all.
    const updated = await updateContactSelf("ana", manageToken, {
      address: {
        name: withTel.name,
        line1: withTel.line1,
        line2: withTel.line2,
        postcode: withTel.postcode,
        city: withTel.city,
        country: withTel.country,
      },
      wantsEmailDigest: false,
    });
    expect(updated?.wantsEmailDigest).toBe(false);
    expect(updated?.postalAddress?.tel).toBe("+41 79 111 11 11");
  });

  test("a guest editing their postal address keeps the tel", async () => {
    const withTel = { ...ADDRESS, tel: "+41 79 222 22 22" };
    const { manageToken } = await signUpAndConfirm("ana", "keeps-tel-2@example.test", {
      address: withTel,
    });

    const updated = await updateContactSelf("ana", manageToken, {
      address: {
        name: withTel.name,
        line1: withTel.line1,
        line2: withTel.line2,
        postcode: withTel.postcode,
        city: "Basel",
        country: withTel.country,
      },
    });
    expect(updated?.postalAddress?.city).toBe("Basel");
    expect(updated?.postalAddress?.tel).toBe("+41 79 222 22 22");
  });

  test("a guest clearing their address to nothing does not resurrect a deleted one", async () => {
    // No tel was ever given here — ADDRESS's is "" — so there is nothing to
    // carry forward, and clearing every field must still delete the blob.
    const { manageToken } = await signUpAndConfirm("ana", "clears-address@example.test", {
      address: ADDRESS,
    });

    const cleared = await updateContactSelf("ana", manageToken, {
      address: { name: "", line1: "", line2: "", postcode: "", city: "", country: "" },
    });
    expect(cleared?.postalAddress).toBeNull();
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

/**
 * The admin route's own validation on `update`.
 *
 * `create` already runs the address through `isEmail`; `update` used to
 * accept any string and write it to both `email` and `email_key`. There is no
 * unique index on `(owner_id, email_key)` — `003-contacts.ts` creates only
 * `contacts_manage_token` and `contacts_owner_status` — so two rows sharing a
 * key would make `requestContact` and `confirmContact`'s `executeTakeFirst()`
 * lookups ambiguous rather than loud. Both checks now happen before
 * `updateContactByOwner` is ever called.
 */
describe("the admin route's update validation", () => {
  const OWNER_EMAIL = "ana@example.test";

  beforeEach(() => {
    fs.mkdirSync(path.join(dir, "ana", "trips"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "ana", "config.json"),
      JSON.stringify({
        title: "Ana's journal",
        tagline: "t",
        owner: { name: "Ana B", nickname: "Ana", email: OWNER_EMAIL },
        startLocation: "X",
        defaultLocale: "en",
        locales: ["en"],
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

  /**
   * A real agent bearer token for Ana's own address — the credential
   * `isOwner` accepts from a script — minted the way `/api/auth/verify` does,
   * without the HTTP round trip: `issueCode` then `verifyCode`, the same pair
   * `signUpAndConfirm` above uses for a guest session.
   */
  async function ownerToken(): Promise<string> {
    const { code } = await issueCode("ana", OWNER_EMAIL, "agent");
    const verified = await verifyCode("ana", OWNER_EMAIL, code, "agent");
    if (!verified.ok) throw new Error("expected the code to verify");
    return verified.token;
  }

  async function postAdmin(body: Record<string, unknown>, token: string) {
    const { POST } = await import("@/app/api/contacts/admin/route");
    return POST(
      new Request("https://example.test/api/contacts/admin", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ user: "ana", ...body }),
      }),
    );
  }

  test("rejects a malformed address rather than writing it", async () => {
    const token = await ownerToken();
    const { contactId } = await requestContact("ana", {
      name: "Gran", email: "gran@example.test", locale: "en",
      wantsEmailDigest: false, wantsPostcard: false, createdVia: "owner",
    });

    const response = await postAdmin(
      { action: "update", id: contactId, email: "not-an-address" },
      token,
    );

    expect(response.status).toBe(400);
    expect(((await response.json()) as { error?: string }).error).toBe("invalid_email");
    expect((await getContact("ana", contactId!))?.email).toBe("gran@example.test");
  });

  test("refuses to give a contact the address a different contact already holds", async () => {
    const token = await ownerToken();
    await requestContact("ana", {
      name: "Gran", email: "taken@example.test", locale: "en",
      wantsEmailDigest: false, wantsPostcard: false, createdVia: "owner",
    });
    const { contactId } = await requestContact("ana", {
      name: "Other", email: "other@example.test", locale: "en",
      wantsEmailDigest: false, wantsPostcard: false, createdVia: "owner",
    });

    const response = await postAdmin(
      { action: "update", id: contactId, email: "taken@example.test" },
      token,
    );

    expect(response.status).toBe(409);
    expect(((await response.json()) as { error?: string }).error).toBe("email_taken");
    expect((await getContact("ana", contactId!))?.email).toBe("other@example.test");
    // Ana's own attempt is still findable, undisturbed.
    expect((await listContacts("ana")).map((c) => c.email).sort()).toEqual([
      "other@example.test",
      "taken@example.test",
    ]);
  });

  /**
   * `create` used to route straight through `requestContact`, whose
   * existing-row branch overwrites locale and consents, NULLs the postal
   * address, and then this route mails a fresh code — an owner adding an
   * address unaware it already belongs to an approved guest would delete
   * that guest's address, unsubscribe them and confuse them with a code they
   * never asked for. `create` now refuses instead, the same shape it already
   * used for a blocked address.
   */
  test("create refuses an address already on the list, and leaves it untouched", async () => {
    const token = await ownerToken();
    const { contact: existing } = await signUpAndConfirm("ana", "existing@example.test", {
      name: "Existing Guest",
      address: ADDRESS,
      wantsPostcard: true,
      createdVia: "owner",
    });
    await approveContact("ana", existing.id);
    const before = await getContact("ana", existing.id);

    const { db } = await getDatabase();
    const codesBefore = await db
      .selectFrom("login_codes")
      .selectAll()
      .where("owner_id", "=", "ana")
      .where("email", "=", "existing@example.test")
      .execute();

    const response = await postAdmin(
      { action: "create", name: "Somebody New", email: "existing@example.test", locale: "en" },
      token,
    );

    expect(response.status).toBe(409);
    expect(((await response.json()) as { error?: string }).error).toBe("contact_exists");

    const after = await getContact("ana", existing.id);
    expect(after?.locale).toBe(before?.locale);
    expect(after?.status).toBe(before?.status);
    expect(after?.wantsEmailDigest).toBe(before?.wantsEmailDigest);
    expect(after?.wantsPostcard).toBe(before?.wantsPostcard);
    expect(after?.postalAddress).toEqual(before?.postalAddress);

    // No code was issued for the address a second time.
    const codesAfter = await db
      .selectFrom("login_codes")
      .selectAll()
      .where("owner_id", "=", "ana")
      .where("email", "=", "existing@example.test")
      .execute();
    expect(codesAfter).toHaveLength(codesBefore.length);
  });

  /**
   * `create` already refused `wantsPostcard` with no postable address
   * (400 `invalid_address`); `update` used to silently zero the tick
   * instead, so the same form gave two different answers to the same
   * mistake. `update` now refuses the same way.
   */
  test("update refuses a postcard consent with nowhere to send it, same as create", async () => {
    const token = await ownerToken();
    const { contactId } = await requestContact("ana", {
      name: "Gran", email: "no-address@example.test", locale: "en",
      wantsEmailDigest: false, wantsPostcard: false, createdVia: "owner",
    });

    const response = await postAdmin(
      { action: "update", id: contactId, wantsPostcard: true },
      token,
    );

    expect(response.status).toBe(400);
    expect(((await response.json()) as { error?: string }).error).toBe("invalid_address");
    expect((await getContact("ana", contactId!))?.wantsPostcard).toBe(false);
  });

  /**
   * The bug: `update` used to compute `nextAddress` as `EMPTY_ADDRESS` for a
   * row whose `postalAddress` reads null — a row written by the pre-fix
   * `update` with `wants_postcard = 1` and no address, or any row whose blob
   * no longer decrypts after `CONTACTS_ENCRYPTION_KEY` was rotated — and then
   * refused every edit against that unpostable `EMPTY_ADDRESS`, including a
   * name-only one that never touched the address or the postcard preference.
   */
  test("a name-only edit succeeds on a contact with wants_postcard set and no readable address", async () => {
    const token = await ownerToken();
    const { contactId } = await requestContact("ana", {
      name: "Gran", email: "legacy-postcard@example.test", locale: "en",
      wantsEmailDigest: false, wantsPostcard: false, createdVia: "owner",
    });
    // Simulate the legacy row directly: `wants_postcard` set, no readable
    // address behind it.
    const { db } = await getDatabase();
    await db
      .updateTable("contacts")
      .set({ wants_postcard: 1, postal_cipher: null })
      .where("id", "=", contactId!)
      .execute();

    const response = await postAdmin({ action: "update", id: contactId, name: "Grandma" }, token);

    expect(response.status).toBe(200);
    const after = await getContact("ana", contactId!);
    expect(after?.name).toBe("Grandma");
    expect(after?.wantsPostcard).toBe(true);
  });

  /**
   * A row whose stored address never decrypts (a key rotation, say) is the
   * same shape as one that never had an address at all: `getContact` reads
   * `postalAddress` as `null` either way. Genuinely turning the preference on
   * against that row must still be refused — the "resend what's already
   * stored passes through" rule below only excuses a request that changes
   * nothing.
   */
  test("still refuses to turn wantsPostcard on when the stored address won't decrypt", async () => {
    const token = await ownerToken();
    const { contactId } = await requestContact("ana", {
      name: "Gran", email: "legacy-postcard-2@example.test", locale: "en",
      wantsEmailDigest: false, wantsPostcard: false, createdVia: "owner",
    });
    const { db } = await getDatabase();
    await db
      .updateTable("contacts")
      .set({ postal_cipher: "not-a-real-ciphertext" })
      .where("id", "=", contactId!)
      .execute();

    const response = await postAdmin(
      { action: "update", id: contactId, wantsPostcard: true },
      token,
    );

    expect(response.status).toBe(400);
    expect(((await response.json()) as { error?: string }).error).toBe("invalid_address");
    expect((await getContact("ana", contactId!))?.wantsPostcard).toBe(false);
  });

  /**
   * IMPORTANT 1 of the second followup round: the fix above only worked
   * against a request that omits `wantsPostcard`/`address` entirely. The
   * real form (`ContactsAdmin.tsx`'s `submit`) always posts both, on every
   * save — so on a legacy row (`wants_postcard = 1`, address unreadable) the
   * old "touches this field" gate 400'd every edit again, including a
   * name-only one, exactly reproducing the bug the fix claimed to close.
   * This posts the request shaped the way the real form does: the stored
   * (unreadable) address resent verbatim, `wantsPostcard` resent unchanged,
   * only the name actually different.
   */
  test("a save that re-posts the legacy row's own values unchanged succeeds, as the real form does", async () => {
    const token = await ownerToken();
    const { contactId } = await requestContact("ana", {
      name: "Gran", email: "legacy-repost@example.test", locale: "en",
      wantsEmailDigest: false, wantsPostcard: false, createdVia: "owner",
    });
    const { db } = await getDatabase();
    await db
      .updateTable("contacts")
      .set({ wants_postcard: 1, postal_cipher: null })
      .where("id", "=", contactId!)
      .execute();

    const response = await postAdmin(
      {
        action: "update",
        id: contactId,
        name: "Grandma",
        wantsEmailDigest: false,
        wantsPostcard: true,
        address: {
          name: "", line1: "", line2: "", postcode: "", city: "", country: "", tel: "",
        },
      },
      token,
    );

    expect(response.status).toBe(200);
    const after = await getContact("ana", contactId!);
    expect(after?.name).toBe("Grandma");
    expect(after?.wantsPostcard).toBe(true);
  });

  test("submitting a non-empty but non-postable address still 400s, whatever wantsPostcard says", async () => {
    const token = await ownerToken();
    const { contactId } = await requestContact("ana", {
      name: "Gran", email: "partial-address@example.test", locale: "en",
      wantsEmailDigest: false, wantsPostcard: false, createdVia: "owner",
    });

    const response = await postAdmin(
      {
        action: "update",
        id: contactId,
        address: {
          name: "Gran", line1: "", line2: "", postcode: "", city: "Zurich", country: "", tel: "",
        },
      },
      token,
    );

    expect(response.status).toBe(400);
    expect(((await response.json()) as { error?: string }).error).toBe("invalid_address");
    expect((await getContact("ana", contactId!))?.postalAddress).toBeNull();
  });
});
