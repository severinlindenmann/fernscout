import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

/**
 * B2296 — importing "who was there" sends no mail.
 *
 * B2055 used to mail every imported row a consent letter ("Do you want
 * anything from this journal?") the moment it was filed, unasked — B2296
 * (one door for readers, B2291) removed the sender: an imported row is
 * pending and unconfirmed, and shows up on Studio › Readers under "Not
 * invited yet"; inviting it from there is a deliberate, later press.
 *
 * Every name and address below is invented.
 */

const OWNER = "ana";
const OWNER_EMAIL = "ana@example.test";
const TITLE = "Two Backpacks";
const NICKNAME = "Ana";

let dir: string;

function mailsTo(email: string): string[] {
  const folder = path.join(dir, "mail", OWNER);
  if (!fs.existsSync(folder)) return [];
  const marker = email.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase();
  return fs.readdirSync(folder).filter((f) => f.includes(marker));
}

function decodeMail(raw: string): { subject: string; body: string } {
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

function lastMailTo(email: string): { subject: string; body: string } {
  const files = mailsTo(email);
  const file = files[files.length - 1];
  return decodeMail(fs.readFileSync(path.join(dir, "mail", OWNER, file), "utf8"));
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

describe("importing rows", () => {
  test("files a pending, unconfirmed contact and sends nothing", async () => {
    const { importContactRows } = await import("@/lib/contacts/importRows");
    const { getUser } = await import("@/lib/users");
    const { getContactByEmail } = await import("@/lib/contacts");

    const results = await importContactRows(OWNER, getUser(OWNER)!, [
      { name: "Bea Muster", email: "bea@example.test" },
    ]);
    expect(results).toEqual([{ name: "Bea Muster", email: "bea@example.test", outcome: "created" }]);

    expect(mailsTo("bea@example.test")).toHaveLength(0);

    const contact = await getContactByEmail(OWNER, "bea@example.test");
    expect(contact?.status).toBe("pending");
    expect(contact?.confirmedAt).toBeNull();
    expect(contact?.createdVia).toBe("owner-import");

    const { getDatabase } = await import("@/lib/db");
    const { db } = await getDatabase();
    const codes = await db.selectFrom("login_codes").selectAll().where("email", "=", "bea@example.test").execute();
    expect(codes).toHaveLength(0);
  });

  test("three rows send zero mails between them", async () => {
    const { importContactRows } = await import("@/lib/contacts/importRows");
    const { getUser } = await import("@/lib/users");

    const rows = [
      { name: "Cara One", email: "cara-one@example.test" },
      { name: "Cara Two", email: "cara-two@example.test" },
      { name: "Cara Three", email: "cara-three@example.test" },
    ];
    const results = await importContactRows(OWNER, getUser(OWNER)!, rows);
    expect(results.every((r) => r.outcome === "created")).toBe(true);

    for (const row of rows) expect(mailsTo(row.email)).toHaveLength(0);
  });
});

describe("the sign-in path", () => {
  test("still sends the code mail unchanged", async () => {
    const { sendCodeMail } = await import("@/lib/contacts/mail");
    const { getUser } = await import("@/lib/users");
    await sendCodeMail(OWNER, getUser(OWNER)!, "dora@example.test", "en", "424242");
    const [file] = mailsTo("dora@example.test");
    expect(file).toBeTruthy();
    const mail = decodeMail(fs.readFileSync(path.join(dir, "mail", OWNER, file), "utf8"));
    expect(mail.subject).toBe(`Your code for ${TITLE}`);
    expect(mail.body).toContain("Your code is 424242");
  });
});

describe("B2366 — a code mail's promise matches whether the owner already decided", () => {
  test("a person the owner added is already in: the code mail says so, not that they still wait", async () => {
    const { addPersonByOwner } = await import("@/lib/contacts");
    const { sendGuestCode } = await import("@/lib/contacts/guestCode");

    const added = await addPersonByOwner(OWNER, { name: "Eve Added", email: "eve@example.test", locale: "en" });
    if (!added.ok) throw new Error("addPersonByOwner failed in test setup");
    expect(added.contact.status).toBe("active");

    const sent = await sendGuestCode(OWNER, added.contact.id, "email", { ip: "203.0.113.9" });
    expect(sent.ok).toBe(true);

    const mail = lastMailTo("eve@example.test");
    const { translateIn } = await import("@/lib/locales");
    expect(mail.body).toContain(translateIn("en", "contact.mailCodeLinkBodyPreapproved"));
    expect(mail.body).not.toContain(translateIn("en", "contact.mailCodeLinkBody"));
  });

  test("a person who only asked (not yet let in) still gets told nothing opens yet", async () => {
    const { addContact } = await import("@/lib/contacts");
    const { sendGuestCode } = await import("@/lib/contacts/guestCode");

    const added = await addContact(OWNER, { name: "Fred Asked", email: "fred@example.test", locale: "en", createdVia: "owner-import" });
    if (!added.ok) throw new Error("addContact failed in test setup");
    expect(added.contact.status).toBe("pending");

    const sent = await sendGuestCode(OWNER, added.contact.id, "email", { ip: "203.0.113.10" });
    expect(sent.ok).toBe(true);

    const mail = lastMailTo("fred@example.test");
    const { translateIn } = await import("@/lib/locales");
    expect(mail.body).toContain(translateIn("en", "contact.mailCodeLinkBody"));
  });
});

describe("B2368 — the masked address is the same everywhere it is shown", () => {
  test("sendGuestCode's masked reply matches the guide's own maskEmail, not a shorter reveal", async () => {
    // B2368 — the /w/ guide's "to ag•••@…" comes from lib/contacts/welcome.ts's
    // maskEmail (two letters); guestCode.ts kept its own private copy that
    // revealed only one, so the address on screen changed between the guide
    // and the "code sent" line for the same address.
    const { addPersonByOwner } = await import("@/lib/contacts");
    const { sendGuestCode } = await import("@/lib/contacts/guestCode");
    const { maskEmail } = await import("@/lib/contacts/welcome");

    const added = await addPersonByOwner(OWNER, { name: "Gia Guest", email: "giulia@example.test", locale: "en" });
    if (!added.ok) throw new Error("addPersonByOwner failed in test setup");

    const sent = await sendGuestCode(OWNER, added.contact.id, "email", { ip: "203.0.113.11" });
    expect(sent.ok && sent.to).toBe(maskEmail("giulia@example.test"));
    expect(sent.ok && sent.to).toBe("gi•••@example.test");
  });
});
