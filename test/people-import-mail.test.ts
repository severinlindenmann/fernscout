import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

/**
 * B2055 — the people import sends the mail its decide step promises.
 *
 * The studio's people step says "each of them gets one mail, asking whether
 * they want anything from this journal at all". The import used to send the
 * sign-in passcode instead ("Your code is 123456"). This pins the letter an
 * imported row actually receives, in every language the journal speaks, and
 * that the sign-in path still sends its code mail unchanged.
 *
 * Every name and address below is invented.
 */

const OWNER = "ana";
const OWNER_EMAIL = "ana@example.test";
const TITLE = "Two Backpacks";
const NICKNAME = "Ana";

let dir: string;

function decodeEml(raw: string): { subject: string; body: string } {
  const subjectLine = raw.match(/^Subject: (.*)$/m)?.[1] ?? "";
  const subject = subjectLine.replace(/=\?UTF-8\?B\?([^?]+)\?=/g, (_, b64: string) =>
    Buffer.from(b64, "base64").toString("utf8"),
  );
  const parts = raw
    .split(/--fs-[a-z0-9-]+/)
    .map((p) => p.split(/\r?\n\r?\n/).slice(1).join("\n").trim())
    .filter(Boolean);
  return { subject, body: parts.map((p) => Buffer.from(p, "base64").toString("utf8")).join("\n") };
}

/** The words, without the URLs and the HTML part's colours, which may hold six digits by chance. */
function withoutLinks(body: string): string {
  return body.replace(/https?:\/\/\S+/g, "").replace(/#[0-9a-f]{3,8}\b/gi, "");
}

function mailsTo(email: string): { subject: string; body: string }[] {
  const folder = path.join(dir, "mail", OWNER);
  if (!fs.existsSync(folder)) return [];
  const marker = email.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase();
  return fs
    .readdirSync(folder)
    .filter((f) => f.includes(marker))
    .map((f) => decodeEml(fs.readFileSync(path.join(folder, f), "utf8")));
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-people-import-mail-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.CONTACTS_ENCRYPTION_KEY = "5a".repeat(32);
  process.env.SESSION_SECRET = "6b".repeat(32);
  delete process.env.AUTH_DEV_CODE;

  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", defaultUser: OWNER },
      users: { reserved: [] },
      features: {
        auth: { enabled: true },
        contacts: { enabled: true },
        mail: { enabled: true, transport: "file" },
      },
    }),
  );
  fs.mkdirSync(path.join(dir, OWNER, "trips"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title: TITLE,
      owner: { name: "Ana B", nickname: NICKNAME, email: OWNER_EMAIL },
      defaultLocale: "en",
      locales: ["en", "de", "hu"],
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
  for (const key of ["CONTENT_DIR", "DATA_DIR", "DATABASE_URL", "CONTACTS_ENCRYPTION_KEY", "SESSION_SECRET"]) {
    delete process.env[key];
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("importing one row", () => {
  test("keeps one consent mail naming the journal and owner, with a decline link and no passcode", async () => {
    const { importContactRows } = await import("@/lib/contacts/importRows");
    const { getUser } = await import("@/lib/users");
    const { getContactByEmail, manageTokenFor, manageUrl } = await import("@/lib/contacts");

    const results = await importContactRows(OWNER, getUser(OWNER)!, [
      { name: "Bea Muster", email: "bea@example.test" },
    ]);
    expect(results).toEqual([{ name: "Bea Muster", email: "bea@example.test", outcome: "created" }]);

    const mails = mailsTo("bea@example.test");
    expect(mails).toHaveLength(1);
    const [mail] = mails;
    expect(mail.subject).toBe(`${NICKNAME} added you to ${TITLE}`);
    expect(mail.body).toContain(TITLE);
    expect(mail.body).toContain(NICKNAME);
    expect(mail.body).toContain(`${NICKNAME} added your address to ${TITLE}`);
    expect(mail.body).toContain("Decline everything");

    const contact = await getContactByEmail(OWNER, "bea@example.test");
    expect(contact?.status).toBe("pending");
    expect(mail.body).toContain(manageUrl("https://example.test", OWNER, manageTokenFor(OWNER, contact!.id)));

    // No passcode: nothing in the letter's words, and no code was issued.
    expect(withoutLinks(mail.body)).not.toMatch(/\b\d{6}\b/);
    expect(mail.body).not.toContain("Your code");
    expect(mail.subject).not.toContain("code");
    const { getDatabase } = await import("@/lib/db");
    const { db } = await getDatabase();
    const codes = await db.selectFrom("login_codes").selectAll().where("email", "=", "bea@example.test").execute();
    expect(codes).toHaveLength(0);
  });

  test.each(["de", "hu"] as const)("the %s letter is filled in, with no placeholder left", async (locale) => {
    const { sendImportedMail } = await import("@/lib/contacts/mail");
    const { getUser } = await import("@/lib/users");
    const { requestContact } = await import("@/lib/contacts");
    const email = `cara-${locale}@example.test`;
    const { contactId } = await requestContact(OWNER, {
      name: "Cara",
      email,
      locale,
      wantsEmailDigest: false,
      wantsPostcard: false,
      wantsWhatsapp: false,
      createdVia: "owner-import",
    });
    await sendImportedMail(OWNER, getUser(OWNER)!, { id: contactId!, email, locale });
    const [mail] = mailsTo(email);
    for (const text of [mail.subject, mail.body]) {
      expect(text).toContain(TITLE);
      expect(text).not.toMatch(/\{[a-z]+\}/);
    }
    expect(mail.body).toContain(NICKNAME);
    expect(withoutLinks(mail.body)).not.toMatch(/\b\d{6}\b/);
  });
});

describe("the sign-in path", () => {
  test("still sends the code mail unchanged", async () => {
    const { sendCodeMail } = await import("@/lib/contacts/mail");
    const { getUser } = await import("@/lib/users");
    await sendCodeMail(OWNER, getUser(OWNER)!, "dora@example.test", "en", "424242");
    const [mail] = mailsTo("dora@example.test");
    expect(mail.subject).toBe(`Your code for ${TITLE}`);
    expect(mail.body).toContain("Your code is 424242");
  });
});
