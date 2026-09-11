import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

/**
 * A vCard, over the network, the way an agent does it — B1394.
 *
 * The properties worth asserting are the same shape `costs-import-route`
 * asserts for a statement: reading writes **nothing**, and the second call
 * is the only thing that files a row — and here, unlike costs, that row is
 * `pending` with its own confirmation mail, never pre-approved.
 *
 * Every name and address below is invented.
 */

const OWNER = "ana";
const OWNER_EMAIL = "ana@example.test";

let dir: string;
let calls = 0;

function headers(extra: Record<string, string> = {}): Record<string, string> {
  calls += 1;
  return { "x-forwarded-for": `10.9.1.${calls % 250}`, ...extra };
}

async function ownerToken(): Promise<string> {
  const { issueCode, verifyCode } = await import("@/lib/auth");
  const { code } = await issueCode(OWNER, OWNER_EMAIL, "agent");
  const result = await verifyCode(OWNER, OWNER_EMAIL, code, "agent");
  if (!result.ok) throw new Error("no owner token");
  return result.token;
}

const VCARD = [
  "BEGIN:VCARD",
  "VERSION:3.0",
  "FN:Bea Muster",
  "EMAIL:bea@example.test",
  "TEL:+41 79 000 00 00",
  "END:VCARD",
].join("\r\n");

async function readCall(token: string, body: unknown) {
  const { POST } = await import("@/app/api/v1/[user]/import/route");
  const response = await POST(
    new Request(`https://example.test/api/v1/${OWNER}/import`, {
      method: "POST",
      headers: headers({ authorization: `Bearer ${token}`, "content-type": "application/json" }),
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ user: OWNER }) },
  );
  return { status: response.status, body: await response.json() };
}

async function importCall(token: string, body: unknown) {
  const { POST } = await import("@/app/api/v1/[user]/contacts/import/route");
  const response = await POST(
    new Request(`https://example.test/api/v1/${OWNER}/contacts/import`, {
      method: "POST",
      headers: headers({ authorization: `Bearer ${token}`, "content-type": "application/json" }),
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ user: OWNER }) },
  );
  return { status: response.status, body: await response.json() };
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-contacts-import-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.SESSION_SECRET = "77".repeat(32);
  process.env.CONTACTS_ENCRYPTION_KEY = "33".repeat(32);

  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", defaultUser: OWNER },
      users: { reserved: [] },
      features: { auth: { enabled: true }, contacts: { enabled: true } },
    }),
  );
  fs.mkdirSync(path.join(dir, OWNER, "trips"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title: "Two Backpacks",
      owner: { name: "A B", nickname: "A", email: OWNER_EMAIL },
      defaultLocale: "en",
      locales: ["en"],
      features: { auth: { enabled: true }, contacts: { enabled: true } },
    }),
  );

  const { clearConfigCache } = await import("@/lib/config");
  const { clearUserCache } = await import("@/lib/users");
  clearConfigCache();
  clearUserCache();

  const { migrateToLatest } = await import("@/lib/db/migrate");
  const { getDatabase } = await import("@/lib/db");
  await migrateToLatest(await getDatabase());
});

afterAll(async () => {
  const { closeDatabase } = await import("@/lib/db");
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.CONTACTS_ENCRYPTION_KEY;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("the whole file, kept in written order", { shuffle: false }, () => {
  test("reading a vCard writes nothing", async () => {
    const token = await ownerToken();
    const { status, body } = await readCall(token, { kind: "contacts", text: VCARD });
    expect(status).toBe(200);
    expect(body.people).toHaveLength(1);
    expect(body.people[0]).toMatchObject({ name: "Bea Muster", email: "bea@example.test" });

    const { listContacts } = await import("@/lib/contacts");
    expect(await listContacts(OWNER)).toEqual([]);
  });

  test("filing an agreed row makes a pending contact, never active", async () => {
    const token = await ownerToken();
    const { status, body } = await importCall(token, {
      rows: [{ name: "Bea Muster", email: "bea@example.test", tel: "+41 79 000 00 00" }],
    });
    expect(status).toBe(200);
    expect(body.filed).toBe(1);
    expect(body.results[0].outcome).toBe("created");

    const { listContacts } = await import("@/lib/contacts");
    const [contact] = await listContacts(OWNER);
    expect(contact.status).toBe("pending");
    expect(contact.wantsPostcard).toBe(false);
    expect(contact.wantsWhatsapp).toBe(false);
  });

  test("a row with no email is invalid and files nothing for it", async () => {
    const token = await ownerToken();
    const { body } = await importCall(token, { rows: [{ name: "No Email" }] });
    expect(body.filed).toBe(0);
    expect(body.invalid).toBe(1);
    expect(body.results[0].outcome).toBe("invalid");
  });

  test("more than 50 rows is refused outright", async () => {
    const token = await ownerToken();
    const rows = Array.from({ length: 51 }, (_, i) => ({
      name: `Person ${i}`,
      email: `p${i}@example.test`,
    }));
    const { status, body } = await importCall(token, { rows });
    expect(status).toBe(400);
    expect(body.error).toBe("invalid_request");
  });

  test("a trip-scoped token is refused — an address book is the whole journal's", async () => {
    const { issueCode, verifyCode } = await import("@/lib/auth");
    const { code } = await issueCode(OWNER, OWNER_EMAIL, "agent", { trip: "somewhere" });
    const result = await verifyCode(OWNER, OWNER_EMAIL, code, "agent");
    if (!result.ok) throw new Error("no trip token");
    const { status, body } = await importCall(result.token, {
      rows: [{ name: "Someone Else", email: "someone@example.test" }],
    });
    expect(status).toBe(403);
    expect(body.error).toBe("out_of_scope");
  });
});
