import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { storeInboxFile } from "@/lib/inbox";

/**
 * `POST /api/helper/[user]/contacts/read` — B1823, the cookie-side twin of
 * `POST /api/v2/[user]/import` (kind `contacts`) the "Who was there" flow
 * needs. Same shape `test/helper-statement.test.ts` asserts for its own
 * "the import reads and reports, nothing is written" rule: this door never
 * touches a contact, it only reports what a vCard says — and, D5's own
 * requirement, it never silently drops a row with no email address.
 */

const OWNER_EMAIL = "owner@example.test";

const { resolveAccess } = vi.hoisted(() => ({
  resolveAccess: vi.fn(async () => ({ email: OWNER_EMAIL as string | null })),
}));
vi.mock("@/lib/auth/handshake", () => ({ resolveAccess }));

const { POST } = await import("@/app/api/helper/[user]/contacts/read/route");

let dir: string;
const params = { params: Promise.resolve({ user: "owner" }) };

function json(url: string, body: unknown) {
  return new Request(`https://t.test${url}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function read(response: Response) {
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

function writeConfig(features: Record<string, unknown>) {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({ site: { name: "T", url: "https://t.test" }, features }),
  );
  clearConfigCache();
  clearUserCache();
}

function stage(filename: string, contents: string): string {
  return storeInboxFile("owner", "files", filename, Buffer.from(contents), {}).entry.id;
}

const CARD = (person: { fn: string; email?: string; tel?: string }) =>
  [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `FN:${person.fn}`,
    ...(person.email ? [`EMAIL:${person.email}`] : []),
    ...(person.tel ? [`TEL:${person.tel}`] : []),
    "END:VCARD",
  ].join("\r\n");

const VCARD = [
  CARD({ fn: "Priya Raman", email: "priya@example.test" }),
  CARD({ fn: "Hotel Grimsel", tel: "+41 33 000 00 00" }), // no email — the D5 "never silently drop a row" case
].join("\r\n");

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-helper-contacts-read-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.SESSION_SECRET = "helper-contacts-read-secret-b1823";
  process.env.CONTACTS_ENCRYPTION_KEY = "44".repeat(32);
  resolveAccess.mockResolvedValue({ email: OWNER_EMAIL });

  fs.mkdirSync(path.join(dir, "owner"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "owner", "config.json"),
    JSON.stringify({
      title: "A journal",
      tagline: "t",
      owner: { name: "A B", nickname: "A", email: OWNER_EMAIL },
      defaultLocale: "en",
      locales: ["en"],
    }),
  );
  writeConfig({ auth: { enabled: true }, contacts: { enabled: true } });
  await migrateToLatest(await getDatabase());
});

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.CONTACTS_ENCRYPTION_KEY;
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("reading is a report, never a write", () => {
  test("every row on the card comes back, including the one with no email", async () => {
    const id = stage("export.vcf", VCARD);
    const answer = await read(await POST(json("/api/helper/owner/contacts/read", { inbox: id }), params));

    expect(answer.status).toBe(200);
    expect(answer.body.people).toHaveLength(2);
    expect(answer.body.withEmail).toBe(1);
    const names = (answer.body.people as { name: string; email?: string }[]).map((p) => p.name);
    expect(names).toContain("Priya Raman");
    expect(names).toContain("Hotel Grimsel"); // kept and named, not dropped
  });

  test("an unknown inbox id is refused, not a crash", async () => {
    const answer = await read(await POST(json("/api/helper/owner/contacts/read", { inbox: "nope" }), params));
    expect(answer.status).toBe(404);
    expect(answer.body.error).toBe("unknown_inbox_file");
  });

  test("a file that is not a vCard is refused with why", async () => {
    const id = stage("export.txt", "just some text, not a vcard");
    const answer = await read(await POST(json("/api/helper/owner/contacts/read", { inbox: id }), params));
    expect(answer.status).toBe(400);
    expect(answer.body.error).toBe("unreadable");
  });

  test("somebody who is not the owner gets the same door everyone else does", async () => {
    resolveAccess.mockResolvedValue({ email: "stranger@example.test" });
    const id = stage("export.vcf", VCARD);
    const answer = await read(await POST(json("/api/helper/owner/contacts/read", { inbox: id }), params));
    expect(answer.status).toBe(404);
  });

  test("the contacts capability off is a 404, not a fault", async () => {
    writeConfig({ auth: { enabled: true } });
    const id = stage("export.vcf", VCARD);
    const answer = await read(await POST(json("/api/helper/owner/contacts/read", { inbox: id }), params));
    expect(answer.status).toBe(404);
    expect(answer.body.error).toBe("contacts_disabled");
  });
});
