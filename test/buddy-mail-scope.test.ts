import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * B347, B348, B349 — the three mails a buddy touches all called them a
 * reader.
 *
 * A buddy link grants write access to one trip, not reading rights to the
 * journal, and three letters got that backwards: the approval mail told them
 * to "follow along", the agent-code mail called the journal "yours", and the
 * owner's own notification called the request "following along" with no
 * trip named. Each is fixed the same way — say which trip, and only when the
 * contact actually arrived by a buddy link. A guest link's mail is asserted
 * unchanged throughout, driven through the same routes so the wiring — not
 * just the copy — is what's under test.
 */

/** Every cookie the mocked `next/headers` hands back — unused here (every
 * owner call authenticates with a bearer token) but `isOwner` still calls
 * `cookies()` before it looks at the header, and that throws outside a real
 * request scope without this. */
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

const OWNER = "ana";
const OWNER_EMAIL = "ana@example.test";
const TRIP_ID = "bus-2026";
const TRIP_TITLE = "Down the Balkan Line";

let dir: string;
let calls = 0;
function headers(extra: Record<string, string> = {}): Record<string, string> {
  calls += 1;
  return { "content-type": "application/json", "x-forwarded-for": `10.9.0.${calls % 250}`, ...extra };
}

/** The text/plain part of a `.eml` `buildMessage` wrote — base64, per
 * `lib/mail/rfc822.ts` — decoded back to what a reader actually sees. */
function plainTextOf(eml: string): string {
  const part = eml.split(/--fs-[\w-]+\r?\n/).find((p) => p.includes("text/plain"));
  const body = part?.split(/\r?\n\r?\n/).slice(1).join("\n") ?? "";
  return Buffer.from(body.replace(/\r?\n/g, ""), "base64").toString("utf8");
}

function mailFilesFor(email: string): string[] {
  const mailDir = path.join(dir, OWNER, "mail");
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

async function createLink(token: string, body: Record<string, unknown>): Promise<string> {
  const { POST } = await import("@/app/api/v1/[user]/invites/route");
  const response = await POST(
    new Request("https://example.test/api/v1/ana/invites", {
      method: "POST",
      headers: headers({ authorization: `Bearer ${token}` }),
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ user: OWNER }) },
  );
  const parsed = (await response.json()) as { invite?: { url?: string } };
  const url = parsed.invite!.url!;
  return url.slice(url.lastIndexOf("/") + 1);
}

async function redeem(kind: "guest" | "buddy", token: string, email: string): Promise<void> {
  const { POST } = await import("@/app/api/contacts/redeem/route");
  const response = await POST(
    new Request("https://example.test/api/contacts/redeem", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ user: OWNER, token, kind, name: "A Reader", email }),
    }),
  );
  const body = (await response.json()) as { status?: string };
  if (body.status !== "code") throw new Error(`redeem failed: ${JSON.stringify(body)}`);
}

async function confirm(email: string): Promise<void> {
  const { issueCode } = await import("@/lib/auth");
  const { POST } = await import("@/app/api/contacts/confirm/route");
  const { code } = await issueCode(OWNER, email, "guest");
  const response = await POST(
    new Request("https://example.test/api/contacts/confirm", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ user: OWNER, email, code }),
    }),
  );
  const body = (await response.json()) as { ok?: boolean };
  if (!body.ok) throw new Error(`confirm failed for ${email}: ${JSON.stringify(body)}`);
}

async function approve(token: string, email: string): Promise<void> {
  const { getContactByEmail } = await import("@/lib/contacts");
  const { POST } = await import("@/app/api/contacts/admin/route");
  const contact = await getContactByEmail(OWNER, email);
  if (!contact) throw new Error(`no contact for ${email}`);
  const response = await POST(
    new Request("https://example.test/api/contacts/admin", {
      method: "POST",
      headers: headers({ authorization: `Bearer ${token}` }),
      body: JSON.stringify({ user: OWNER, action: "approve", id: contact.id }),
    }),
  );
  const body = (await response.json()) as { ok?: boolean };
  if (!body.ok) throw new Error(`approve failed for ${email}: ${JSON.stringify(body)}`);
}

/** Redeem, confirm and approve, the way an owner and a new contact actually
 * would — through the routes, so the invite's kind and trip really do reach
 * the mail functions the way they do in production. */
async function onboard(kind: "guest" | "buddy", inviteToken: string, email: string, ownerBearer: string) {
  await redeem(kind, inviteToken, email);
  await confirm(email);
  await approve(ownerBearer, email);
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-buddy-mail-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.CONTACTS_ENCRYPTION_KEY = "44".repeat(32);
  process.env.SESSION_SECRET = "55".repeat(32);
  delete process.env.AUTH_DEV_CODE;

  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", defaultUser: OWNER },
      users: { reserved: [] },
      features: { auth: { enabled: true }, contacts: { enabled: true }, mail: { enabled: true, transport: "file" } },
    }),
  );
  fs.mkdirSync(path.join(dir, OWNER, "trips", TRIP_ID, "entries"), { recursive: true });
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
  fs.writeFileSync(
    path.join(dir, OWNER, "trips", TRIP_ID, "trip.md"),
    [
      "---",
      `id: "${TRIP_ID}"`,
      `title: "${TRIP_TITLE}"`,
      'start: "2026-08-25"',
      'end: "2026-08-26"',
      'status: "past"',
      'visibility: "private"',
      "---",
      "",
      "Intro.",
      "",
    ].join("\n"),
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
  for (const key of [
    "CONTENT_DIR",
    "DATABASE_URL",
    "CONTACTS_ENCRYPTION_KEY",
    "SESSION_SECRET",
    "AUTH_DEV_CODE",
  ]) {
    delete process.env[key];
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("the approval mail (B347) and the owner's queue notification (B349)", () => {
  test("a buddy contact is told which trip they can write to, and where their agent's instructions are", async () => {
    const token = await ownerToken();
    const invite = await createLink(token, { kind: "buddy", trip: TRIP_ID });
    const email = "buddy-approved@example.test";
    await onboard("buddy", invite, email, token);

    const approved = mailFilesFor(email).find((m) => m.includes("You're in"));
    expect(approved).toContain(TRIP_TITLE);
    expect(approved).toContain(`/${OWNER}/me`);
    expect(approved).not.toContain("Follow along whenever you like");

    // The owner's own notification, sent the moment the address was
    // confirmed — B349.
    const notice = mailFilesFor(OWNER_EMAIL).find((m) => m.includes(email) && m.includes("A new request"));
    expect(notice).toContain(TRIP_TITLE);
    expect(notice).not.toContain("would like to follow along");
  });

  test("a guest contact's mail reads exactly as it does today", async () => {
    const token = await ownerToken();
    const invite = await createLink(token, { kind: "guest" });
    const email = "guest-approved@example.test";
    await onboard("guest", invite, email, token);

    const approved = mailFilesFor(email).find((m) => m.includes("You're in"));
    expect(approved).toContain("Follow along whenever you like");
    expect(approved).not.toContain(`/${OWNER}/me`);
    expect(approved).not.toContain(TRIP_TITLE);

    const notice = mailFilesFor(OWNER_EMAIL).find((m) => m.includes(email) && m.includes("A new request"));
    expect(notice).toContain("would like to follow along");
    expect(notice).not.toContain(TRIP_TITLE);
  });
});

describe("the agent-code mail (B348)", () => {
  test("names the trip and does not call the journal theirs, for somebody on a trip", async () => {
    process.env.AUTH_DEV_CODE = "424242";
    try {
      const token = await ownerToken();
      const invite = await createLink(token, { kind: "buddy", trip: TRIP_ID });
      const email = "buddy-agent@example.test";
      await onboard("buddy", invite, email, token);

      const { POST } = await import("@/app/api/auth/request/route");
      const response = await POST(
        new Request("https://example.test/api/auth/request", {
          method: "POST",
          headers: headers(),
          body: JSON.stringify({ user: OWNER, email, kind: "agent", trip: TRIP_ID }),
        }),
      );
      expect(response.status).toBe(202);

      const mail = mailFilesFor(email).find((m) => m.includes("Agent access code"));
      expect(mail).toContain(TRIP_TITLE);
      expect(mail).not.toContain("write to your journal");
    } finally {
      delete process.env.AUTH_DEV_CODE;
    }
  });

  test("the owner's own code mail is unchanged", async () => {
    process.env.AUTH_DEV_CODE = "424242";
    try {
      const { POST } = await import("@/app/api/auth/request/route");
      const response = await POST(
        new Request("https://example.test/api/auth/request", {
          method: "POST",
          headers: headers(),
          body: JSON.stringify({ user: OWNER, email: OWNER_EMAIL, kind: "agent" }),
        }),
      );
      expect(response.status).toBe(202);

      const mails = mailFilesFor(OWNER_EMAIL).filter((m) => m.includes("Agent access code"));
      const mail = mails[mails.length - 1];
      expect(mail).toContain("write to your journal for seven days");
      expect(mail).not.toContain(TRIP_TITLE);
    } finally {
      delete process.env.AUTH_DEV_CODE;
    }
  });
});
