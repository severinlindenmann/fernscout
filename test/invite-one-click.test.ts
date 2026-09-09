import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, test, vi } from "vitest";

/**
 * B798 — one form, not two, and the code still rescues a mangled link.
 *
 * Played for real on the live instance: a 66-year-old following one link out
 * of a group chat had to fill in a form, leave the browser, find six digits in
 * a mail app, come back, and type them into a second form — before a step
 * (the approval mail) that is already a single press. The code mail now
 * carries the same one-press link, and the six digits stay underneath it,
 * because a mail client that mangles a URL is a real failure and the code is
 * what rescues it.
 *
 * The property that must survive all of it, and half these assertions are
 * about it: **opening an invitation grants nothing.** The link mints a
 * session, a session is an address and not a permission, and `approveContact`
 * is still the only thing in the codebase that writes an `access_grants` row.
 */

const jar = vi.hoisted(() => ({ cookies: {} as Record<string, string> }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      jar.cookies[name] === undefined ? undefined : { value: jar.cookies[name] },
    set: (name: string, value: string) => {
      jar.cookies[name] = value;
    },
  }),
}));

const OWNER = "ana";
const OWNER_EMAIL = "ana@example.test";

let dir: string;
let calls = 0;
function headers(extra: Record<string, string> = {}): Record<string, string> {
  calls += 1;
  return { "content-type": "application/json", "x-forwarded-for": `10.7.0.${calls % 250}`, ...extra };
}

/** The text/plain part of a `.eml`, decoded — same helper as
 * `test/buddy-mail-scope.test.ts`. */
function plainTextOf(eml: string): string {
  const part = eml.split(/--fs-[\w-]+\r?\n/).find((p) => p.includes("text/plain"));
  const body = part?.split(/\r?\n\r?\n/).slice(1).join("\n") ?? "";
  return Buffer.from(body.replace(/\r?\n/g, ""), "base64").toString("utf8");
}

function mailsTo(email: string): string[] {
  const mailDir = path.join(dir, "mail", OWNER);
  if (!fs.existsSync(mailDir)) return [];
  const slug = email.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  return fs
    .readdirSync(mailDir)
    .filter((f) => f.includes(slug))
    .sort()
    .map((f) => plainTextOf(fs.readFileSync(path.join(mailDir, f), "utf8")));
}

async function ownerToken(): Promise<string> {
  const { issueCode, verifyCode } = await import("@/lib/auth");
  const { code } = await issueCode(OWNER, OWNER_EMAIL, "agent");
  const result = await verifyCode(OWNER, OWNER_EMAIL, code, "agent");
  if (!result.ok) throw new Error("no owner token");
  return result.token;
}

/** A guest link, as the owner's own page or an agent makes one. */
async function guestLink(): Promise<string> {
  const { POST } = await import("@/app/api/v1/[user]/invites/route");
  const response = await POST(
    new Request("https://example.test/api/v1/ana/invites", {
      method: "POST",
      headers: headers({ authorization: `Bearer ${await ownerToken()}` }),
      body: JSON.stringify({ kind: "guest" }),
    }),
    { params: Promise.resolve({ user: OWNER }) },
  );
  const body = (await response.json()) as { invite?: { url?: string } };
  const url = body.invite?.url;
  if (!url) throw new Error("no invite url");
  return url.split("/").pop()!;
}

async function redeem(body: Record<string, unknown>): Promise<{ status?: string }> {
  const { POST } = await import("@/app/api/contacts/redeem/route");
  const response = await POST(
    new Request("https://example.test/api/contacts/redeem", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ user: OWNER, kind: "guest", ...body }),
    }),
  );
  return (await response.json()) as { status?: string };
}

async function spendLink(token: string): Promise<{ status: number; next?: string }> {
  const { POST } = await import("@/app/api/auth/link/route");
  const response = await POST(
    new Request("https://example.test/api/auth/link", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ user: OWNER, token }),
    }),
  );
  const body = (await response.json()) as { next?: string };
  return { status: response.status, next: body.next };
}

async function contactRow(email: string) {
  const { getContactByEmail } = await import("@/lib/contacts");
  return getContactByEmail(OWNER, email);
}

async function grantExists(contactId: string): Promise<boolean> {
  const { getDatabase } = await import("@/lib/db");
  const { db } = await getDatabase();
  const row = await db
    .selectFrom("access_grants")
    .select("id")
    .where("owner_id", "=", OWNER)
    .where("contact_id", "=", contactId)
    .where("scope", "=", "read")
    .executeTakeFirst();
  return row !== undefined;
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-one-click-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.CONTACTS_ENCRYPTION_KEY = "aa".repeat(32);
  process.env.SESSION_SECRET = "bb".repeat(32);
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
      title: "Two Backpacks",
      tagline: "t",
      owner: { name: "Ana B", nickname: "Ana", email: OWNER_EMAIL },
      startLocation: "X",
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      displayCurrencies: ["CHF"],
      units: "metric",
      features: { auth: { enabled: true }, contacts: { enabled: true } },
    }),
  );

  const { clearConfigCache } = await import("@/lib/config");
  const { clearUserCache } = await import("@/lib/users");
  clearConfigCache();
  clearUserCache();
});

describe("the whole file, kept in written order", { shuffle: false }, () => {
  describe("the code mail carries a one-press link", () => {
    test("a reader types a name and an address, then presses once", async () => {
      const email = "mum@example.test";
      const token = await guestLink();
      jar.cookies = {};

      expect(await redeem({ token, name: "Mum", email })).toEqual({ status: "code" });

      const [mail] = mailsTo(email);
      expect(mail, "the code mail should exist").toBeTruthy();

      // Both halves in one letter: the button, and the six digits underneath it
      // for a client that mangles the link.
      const link = mail.match(/https:\/\/example\.test\/ana\/s\/([\w-]+)/);
      expect(link, "the code mail must carry a one-press sign-in link").not.toBeNull();
      expect(mail, "and must keep the code as the fallback").toMatch(/\b\d{6}\b/);

      // Pressing it — `/{user}/s/<token>` is a page with a button, and this is
      // what the button posts (B142: a scanner following the URL spends
      // nothing).
      const spent = await spendLink(link![1]);
      expect(spent.status).toBe(200);
      // And it comes back to the page she started on, where the whole screen is
      // now one button rather than a second form.
      expect(spent.next).toBe(`/${OWNER}/invite/guest/${token}`);

      // **Signing in granted nothing.** She is not confirmed, not approved, and
      // no grant exists — a session is an address, not a permission.
      const before = await contactRow(email);
      expect(before?.status).toBe("pending");
      expect(before?.confirmedAt).toBeNull();
      expect(await grantExists(before!.id)).toBe(false);
      const { isJournalGuest } = await import("@/lib/contacts/session");
      expect(await isJournalGuest(OWNER)).toBe(false);

      // The one press on that page: no email field, no code, no typing.
      expect(await redeem({ token })).toEqual({ status: "waiting" });

      const after = await contactRow(email);
      expect(after?.confirmedAt, "the address is proved").not.toBeNull();
      expect(after?.status, "and still only in the queue").toBe("pending");
      expect(await grantExists(after!.id), "approveContact is the only thing that grants").toBe(
        false,
      );
      expect(await isJournalGuest(OWNER)).toBe(false);
    });

    test("the six digits still work for a reader whose client mangled the link", async () => {
      const email = "aunt@example.test";
      const token = await guestLink();
      jar.cookies = {};

      expect(await redeem({ token, name: "Aunt", email })).toEqual({ status: "code" });
      const code = mailsTo(email)[0]?.match(/\b(\d{6})\b/)?.[1];
      expect(code, "the code is still in the letter").toBeTruthy();

      const { POST } = await import("@/app/api/contacts/confirm/route");
      const response = await POST(
        new Request("https://example.test/api/contacts/confirm", {
          method: "POST",
          headers: headers(),
          body: JSON.stringify({ user: OWNER, email, code }),
        }),
      );
      expect(response.status).toBe(200);
      expect((await response.json()) as { status?: string }).toMatchObject({ status: "pending" });

      const row = await contactRow(email);
      expect(row?.confirmedAt).not.toBeNull();
      expect(await grantExists(row!.id), "typing the code grants nothing either").toBe(false);
    });
  });

  describe("B800 — a waiting reader is told so", () => {
    test("awaitingApproval is true only while the owner has not decided", async () => {
      const { awaitingApproval } = await import("@/lib/tripGate");
      const email = "mum@example.test";
      const row = await contactRow(email);
      expect(row?.status).toBe("pending");

      // The session the one-press link left behind is what makes the gate able
      // to say "you are already in the queue" rather than showing the join form
      // again.
      jar.cookies = {};
      expect(await awaitingApproval(OWNER), "a stranger is not waiting for anything").toBe(false);

      const { issueStandingLink, verifyLink } = await import("@/lib/auth");
      const { GUEST_COOKIE } = await import("@/lib/auth");
      const signedIn = await verifyLink(OWNER, await issueStandingLink(OWNER, email));
      if (!signedIn.ok) throw new Error("no session");
      jar.cookies[GUEST_COOKIE] = signedIn.token;
      expect(await awaitingApproval(OWNER)).toBe(true);

      // Once the owner decides, the sentence stops being true — they are a
      // guest, not a queue entry.
      const { approveContact } = await import("@/lib/contacts");
      await approveContact(OWNER, row!.id);
      expect(await awaitingApproval(OWNER)).toBe(false);
    });
  });
});
