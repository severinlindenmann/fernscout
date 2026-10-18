import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { writeTripFixture } from "./fixtures/content";

/**
 * B-3007 — one person across email and phone. A sign-in by number that the
 * person linked to their address (or an owner's own proven number) is the
 * same person: the same journals, the same `/me`, one postal address.
 * Dry-run SMS into <dataDir>/sms; documentation number range only.
 */

const jar = vi.hoisted(() => ({ cookies: {} as Record<string, string> }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.cookies[name] === undefined ? undefined : { value: jar.cookies[name] }),
    set: (name: string, value: string) => {
      jar.cookies[name] = value;
    },
    delete: (name: string) => {
      delete jar.cookies[name];
    },
  }),
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.60" }),
}));

const JOURNALS = ["ana", "ben", "cleo"];
const VIK = "vik@example.test";
const NUM = "+41 76 000 00 10";
const DIGITS = "41760000010";
const ANA_DIGITS = "41760000020";
const ADDRESS = { name: "Vik", line1: "Seestrasse 1", line2: "", postcode: "8000", city: "Zürich", country: "CH" };
let dir: string;
let ipCounter = 0;

function texts(): { to: string; body: string }[] {
  const smsDir = path.join(dir, "sms");
  if (!fs.existsSync(smsDir)) return [];
  return fs.readdirSync(smsDir).sort().map((f) => JSON.parse(fs.readFileSync(path.join(smsDir, f), "utf8")));
}
const codeIn = (body: string) => body.match(/(?<![#\w])(\d{6})(?!\w)/)?.[1] ?? "";

function req(url: string, body: unknown, method = "POST") {
  return new Request(`https://example.test${url}`, {
    method,
    headers: {
      "content-type": "application/json",
      origin: "https://example.test",
      "x-forwarded-for": `203.0.113.${(ipCounter++ % 200) + 1}`,
    },
    body: JSON.stringify(body),
  });
}

async function ask(body: Record<string, unknown>) {
  const { POST } = await import("@/app/api/auth/codes/route");
  const { flushAfterResponse } = await import("@/lib/afterResponse");
  const res = await POST(req("/api/auth/codes", body));
  await flushAfterResponse();
  return { status: res.status, json: await res.json() };
}

async function redeem(body: Record<string, unknown>) {
  const { POST } = await import("@/app/api/auth/codes/redeem/route");
  const res = await POST(req("/api/auth/codes/redeem", body));
  return { status: res.status, json: await res.json() };
}

/** A text to this number, its code redeemed. */
async function lastCodeTo(digits: string) {
  const text = texts().filter((t) => t.to === digits).at(-1);
  if (!text) throw new Error(`no text to ${digits}`);
  return codeIn(text.body);
}

async function signInAs(subject: string) {
  const { issueIdentityCookie } = await import("@/lib/auth/identityCookie");
  jar.cookies = {};
  await issueIdentityCookie(subject);
}

async function addActive(owner: string, input: { email?: string; phone?: string }) {
  const { addContact, approveContact, confirmContactByOwner } = await import("@/lib/contacts");
  const added = await addContact(owner, { name: "Vik", ...input, locale: "en", createdVia: "owner" });
  if (!added.ok) throw new Error("add failed");
  await confirmContactByOwner(owner, added.contact.id);
  await approveContact(owner, added.contact.id, { onlyTrip: null });
  return added.contact;
}

async function homeOf(subject: string) {
  const { journalsFor } = await import("@/lib/home");
  return (await journalsFor(subject)).map((j) => `${j.username}:${j.role}`).sort();
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-b3007-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.CONTACTS_ENCRYPTION_KEY = "68".repeat(32);
  process.env.SESSION_SECRET = "79".repeat(32);
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", defaultUser: "ana" },
      users: { reserved: [] },
      features: {
        auth: { enabled: true },
        contacts: { enabled: true },
        mail: { enabled: true, transport: "file" },
        sms: { enabled: true, backend: "dry-run" },
      },
    }),
  );
  for (const owner of JOURNALS) {
    fs.mkdirSync(path.join(dir, owner), { recursive: true });
    fs.writeFileSync(
      path.join(dir, owner, "config.json"),
      JSON.stringify({
        title: `Journal ${owner}`,
        owner: { name: owner, nickname: owner, email: `${owner}@example.test` },
        defaultLocale: "en",
        locales: ["en"],
        baseCurrency: "CHF",
        features: { auth: { enabled: true }, contacts: { enabled: true } },
      }),
    );
    writeTripFixture(owner, { id: "t1", title: "Trip", start: "2026-08-25", end: "2026-08-26", status: "past", visibility: "guest", people: [] });
  }
  const { clearConfigCache } = await import("@/lib/config");
  const { clearUserCache } = await import("@/lib/users");
  clearConfigCache();
  clearUserCache();

  // ana knows Vik by address, ben only by number, cleo by address with an
  // address the owner typed herself.
  await addActive("ana", { email: VIK });
  await addActive("ben", { phone: NUM });
  const cleo = await addActive("cleo", { email: VIK });
  const { updateContactByOwner } = await import("@/lib/contacts");
  await updateContactByOwner("cleo", cleo.id, { address: { ...ADDRESS, line1: "Owner-typed 9" } });
});

beforeEach(async () => {
  const { resetRateLimitsForTests } = await import("@/lib/rateLimit");
  resetRateLimitsForTests();
  jar.cookies = {};
});

afterAll(async () => {
  const { closeDatabase } = await import("@/lib/db");
  await closeDatabase();
  for (const key of ["CONTENT_DIR", "DATA_DIR", "DATABASE_URL", "CONTACTS_ENCRYPTION_KEY", "SESSION_SECRET"]) delete process.env[key];
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("one person across email and phone", () => {
  test("unlinked, the two sign-ins see different journals", async () => {
    expect(await homeOf(VIK)).toEqual(["ana:guest", "cleo:guest"]);
    expect(await homeOf(`+${DIGITS}`)).toEqual(["ben:guest"]);
  });

  test("link needs a sign-in by the other kind", async () => {
    expect((await ask({ for: "identity", phone: NUM, link: true })).status).toBe(401);
    expect((await ask({ for: "read", user: "ana", email: VIK, link: true })).status).toBe(400);
    await signInAs(`+${DIGITS}`);
    expect((await ask({ for: "identity", phone: NUM, link: true })).status).toBe(400);
    expect((await redeem({ for: "identity", phone: NUM, code: "000000", link: true })).status).toBe(400);
  });

  test("signed in by address, proving the number links them; a sign-in by number is then the same person", async () => {
    await signInAs(VIK);
    expect((await ask({ for: "identity", phone: NUM, link: true })).status).toBe(202);
    const linked = await redeem({ for: "identity", phone: NUM, code: await lastCodeTo(DIGITS), link: true });
    expect(linked.status).toBe(200);

    // A new device, by number.
    jar.cookies = {};
    expect((await ask({ for: "identity", phone: NUM })).status).toBe(202);
    expect((await redeem({ for: "identity", phone: NUM, code: await lastCodeTo(DIGITS) })).status).toBe(200);
    const { resolveIdentity } = await import("@/lib/auth/handshake");
    expect((await resolveIdentity())?.email).toBe(VIK);

    const both = ["ana:guest", "ben:guest", "cleo:guest"];
    expect(await homeOf(VIK)).toEqual(both);
    expect(await homeOf(`+${DIGITS}`)).toEqual(both);

    // Both devices are on the person's list.
    const { listIdentities } = await import("@/lib/auth");
    expect((await listIdentities(VIK)).length).toBeGreaterThanOrEqual(2);

    // ben's journal, which knows only the number, finds them by address.
    const { getContactForPerson } = await import("@/lib/contacts");
    expect((await getContactForPerson("ben", VIK))?.phone).toBe(NUM);
  });

  test("a number already somebody else's is not linked", async () => {
    await signInAs("other@example.test");
    expect((await ask({ for: "identity", phone: NUM, link: true })).status).toBe(202);
    const out = await redeem({ for: "identity", phone: NUM, code: await lastCodeTo(DIGITS), link: true });
    expect(out.status).toBe(409);
    expect(out.json.error).toBe("link_taken");
    const { linkedEmail } = await import("@/lib/people");
    expect(await linkedEmail(DIGITS)).toBe(VIK);
  });

  test("a number no journal knows gets its code only when a signed-in person adds it", async () => {
    const fresh = "41760000030";
    const before = texts().length;
    expect((await ask({ for: "identity", phone: "+41 76 000 00 30" })).status).toBe(202);
    expect(texts().length).toBe(before);
    await signInAs("new@example.test");
    expect((await ask({ for: "identity", phone: "+41 76 000 00 30", link: true })).status).toBe(202);
    expect(texts().at(-1)?.to).toBe(fresh);
  });

  test("an owner's own proven number signs in as the owner, with no link step", async () => {
    const { getDatabase, nowIso } = await import("@/lib/db");
    const { db } = await getDatabase();
    await db
      .insertInto("owner_tel")
      .values({ owner_id: "ana", tel: ANA_DIGITS, proven_at: nowIso(), proven_method: "sms", updated_at: nowIso() })
      .execute();
    await signInAs(`+${ANA_DIGITS}`);
    const { resolveIdentity } = await import("@/lib/auth/handshake");
    expect((await resolveIdentity())?.email).toBe("ana@example.test");
    expect(await homeOf(`+${ANA_DIGITS}`)).toContain("ana:owner");

    // An unproven owner number links nobody.
    await db.updateTable("owner_tel").set({ proven_at: null }).where("owner_id", "=", "ana").execute();
    const { canonicalSubject } = await import("@/lib/people");
    expect(await canonicalSubject(`+${ANA_DIGITS}`)).toBe(`+${ANA_DIGITS}`);
  });

  test("the address saved on /me reaches every journal holding the person's own, never an owner-typed one", async () => {
    const { getContactByEmail, manageTokenFor, updateContactSelf } = await import("@/lib/contacts");
    // Vik gave ana an address once, themselves.
    const anaContact = (await getContactByEmail("ana", VIK))!;
    await updateContactSelf("ana", manageTokenFor("ana", anaContact.id), { address: { ...ADDRESS, line1: "Old 1" } });

    await signInAs(`+${DIGITS}`); // the number, linked above: the same person
    const { GET, PUT } = await import("@/app/api/v2/me/person/route");
    const saved = await PUT(req("/api/v2/me/person", { address: ADDRESS }, "PUT"));
    expect(saved.status).toBe(200);
    expect((await saved.json()).journals).toBe(1);

    expect((await getContactByEmail("ana", VIK))?.postalAddress?.line1).toBe("Seestrasse 1");
    expect((await getContactByEmail("cleo", VIK))?.postalAddress?.line1).toBe("Owner-typed 9");
    expect((await getContactByEmail("ben", `+${DIGITS}`))?.postalAddress?.line1 ?? "").toBe("");

    const read = await (await GET()).json();
    expect(read).toMatchObject({ email: VIK, phone: `+${DIGITS}`, address: ADDRESS, addresses: true });

    // An incomplete address is refused, and nothing changes.
    expect((await PUT(req("/api/v2/me/person", { address: { line1: "x" } }, "PUT"))).status).toBe(400);
  });

  test("an edit through a manage link alone stays in its journal", async () => {
    const { getContactByEmail, manageTokenFor } = await import("@/lib/contacts");
    const ana = (await getContactByEmail("ana", VIK))!;
    const { POST } = await import("@/app/api/contacts/manage/route");
    jar.cookies = {};
    const res = await POST(
      req("/api/contacts/manage", { user: "ana", token: manageTokenFor("ana", ana.id), action: "update", address: { ...ADDRESS, line1: "Forwarded 5" } }),
    );
    expect(res.status).toBe(200);
    const { getPersonAddress } = await import("@/lib/people");
    expect((await getPersonAddress(VIK))?.line1).toBe("Seestrasse 1");
  });
});
