import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

/**
 * B1571 — a full journal must still be able to run a `contacts` import,
 * because that kind only reads and reports (`readContactsFile`); it writes
 * nothing until an agreed row is later sent to
 * `POST /api/v2/{user}/contacts/import`. A `gps` import genuinely writes to
 * the journal's own store and must stay refused over the ceiling.
 *
 * Every name and coordinate below is invented.
 */

const OWNER = "ana";
const OWNER_EMAIL = "ana@example.test";

let dir: string;
let calls = 0;

function headers(extra: Record<string, string> = {}): Record<string, string> {
  calls += 1;
  return { "x-forwarded-for": `10.11.2.${calls % 250}`, ...extra };
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
  "END:VCARD",
].join("\r\n");

async function importCall(token: string, body: unknown) {
  const { POST } = await import("@/app/api/v2/[user]/import/route");
  const response = await POST(
    new Request(`https://example.test/api/v2/${OWNER}/import`, {
      method: "POST",
      headers: headers({ authorization: `Bearer ${token}`, "content-type": "application/json" }),
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ user: OWNER }) },
  );
  return { status: response.status, body: await response.json() };
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-import-quota-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.SESSION_SECRET = "77".repeat(32);

  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", defaultUser: OWNER },
      users: { reserved: [] },
      features: { auth: { enabled: true } },
      // A ceiling small enough that the journal below is already over it.
      media: { perUserBytes: 10 },
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
      features: { auth: { enabled: true } },
    }),
  );
  // Push the journal well past the 10-byte ceiling above.
  fs.writeFileSync(path.join(dir, OWNER, "filler.bin"), Buffer.alloc(1_000));

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
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("a full journal and the import door", () => {
  test("a contacts import still reads and reports — it writes nothing", async () => {
    const token = await ownerToken();
    const { status, body } = await importCall(token, { kind: "contacts", text: VCARD });
    expect(status).toBe(200);
    expect(body.people).toHaveLength(1);
  });

  test("a gps import is still refused — it writes to the journal's own store", async () => {
    const token = await ownerToken();
    const { status, body } = await importCall(token, {
      kind: "gps",
      text: JSON.stringify([1_700_000_000, 47.0, 8.0]),
    });
    expect(status).toBe(400);
    expect(body.error).toMatch(/holds|room|full/i);
  });
});
