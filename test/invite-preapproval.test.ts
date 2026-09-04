import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";

/**
 * B319 — mailing an invite to a named address pre-approves it, and the proof
 * still has to happen before anything is granted.
 *
 * The property every assertion here circles is the one the task's Decided
 * section states in words: **the owner typing an address is what vouches for
 * it, not the invite existing.** So a confirmation that proves the *exact*
 * address the owner asked to have mailed skips the queue and creates a real
 * `access_grants` row on the spot; a confirmation for any other address —
 * including a forwarded copy of the very same link — asks exactly as an
 * ordinary invite always has. And an address that never proves itself, pre-
 * approved or not, creates nothing at all: `approveContact` only ever runs
 * from inside a successful confirmation.
 */

/** Every cookie the mocked `next/headers` hands back — unused here (every
 * redemption in this file is a stranger's first visit, never signed in), but
 * `lib/contacts/session.ts` calls `cookies()` regardless. */
const jar = vi.hoisted(() => ({ cookies: {} as Record<string, string> }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      jar.cookies[name] === undefined ? undefined : { value: jar.cookies[name] },
  }),
}));

const OWNER = "ana";
const OWNER_EMAIL = "ana@example.test";

let dir: string;
let calls = 0;
function headers(extra: Record<string, string> = {}): Record<string, string> {
  calls += 1;
  return { "content-type": "application/json", "x-forwarded-for": `10.5.0.${calls % 250}`, ...extra };
}

async function ownerToken(): Promise<string> {
  const { issueCode, verifyCode } = await import("@/lib/auth");
  const { code } = await issueCode(OWNER, OWNER_EMAIL, "agent");
  const result = await verifyCode(OWNER, OWNER_EMAIL, code, "agent");
  if (!result.ok) throw new Error("no owner token");
  return result.token;
}

type InviteBody = {
  ok?: boolean;
  sent?: boolean;
  invite?: { id: string; url?: string };
  error?: string;
  message?: string;
};

/** `POST /api/v1/ana/invites`, as an agent holding the owner's own token would
 * call it. */
async function createLink(
  token: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: InviteBody }> {
  const { POST } = await import("@/app/api/v1/[user]/invites/route");
  const response = await POST(
    new Request("https://example.test/api/v1/ana/invites", {
      method: "POST",
      headers: headers({ authorization: `Bearer ${token}` }),
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ user: OWNER }) },
  );
  return { status: response.status, body: (await response.json()) as InviteBody };
}

/** `POST /api/contacts/redeem` — the door a `guest` link's page posts to. */
async function redeem(
  body: Record<string, unknown>,
): Promise<{ status: number; body: { status?: string; error?: string } }> {
  const { POST } = await import("@/app/api/contacts/redeem/route");
  const response = await POST(
    new Request("https://example.test/api/contacts/redeem", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ user: OWNER, kind: "guest", ...body }),
    }),
  );
  return { status: response.status, body: (await response.json()) as { status?: string } };
}

/** `POST /api/contacts/confirm` — the route this task adds its branch to. */
async function confirm(
  email: string,
  code: string,
): Promise<{ status: number; body: { ok?: boolean; status?: string } }> {
  const { POST } = await import("@/app/api/contacts/confirm/route");
  const response = await POST(
    new Request("https://example.test/api/contacts/confirm", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ user: OWNER, email, code }),
    }),
  );
  return { status: response.status, body: (await response.json()) as { ok?: boolean; status?: string } };
}

async function freshCode(email: string): Promise<string> {
  const { issueCode } = await import("@/lib/auth");
  const { code } = await issueCode(OWNER, email, "guest");
  return code;
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

/** Whether the owner has actually been told about this address's request —
 * `ContactRecord` does not carry this column (see `lib/contacts/index.ts`),
 * so this reads it off the row directly, the same way
 * `test/contact-notify-mail-failure.test.ts` does. */
async function notifiedAt(email: string): Promise<string | null> {
  const { getDatabase } = await import("@/lib/db");
  const { db } = await getDatabase();
  const row = await db
    .selectFrom("contacts")
    .select("notified_at")
    .where("owner_id", "=", OWNER)
    .where("email_key", "=", email)
    .executeTakeFirstOrThrow();
  return row.notified_at;
}

/** The token out of an invite's own URL — `/{user}/invite/guest/{token}`. */
function tokenFrom(url: string): string {
  return url.split("/").pop() ?? "";
}

let writeSpy: ReturnType<typeof vi.spyOn> | null = null;

/** Makes the next mail to `email` — and only that one — throw the way a real
 * SMTP hiccup does, by intercepting the write the file transport makes for
 * it. Every other message passes straight through. Mirrors
 * `test/contact-notify-mail-failure.test.ts`. */
function failMailOnceTo(email: string) {
  const real = fs.writeFileSync.bind(fs);
  const marker = email.replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase();
  let thrown = false;
  writeSpy = vi
    .spyOn(fs, "writeFileSync")
    .mockImplementation(
      (file: fs.PathOrFileDescriptor, data: string | NodeJS.ArrayBufferView, options?: fs.WriteFileOptions) => {
        if (!thrown && typeof file === "string" && file.includes(marker)) {
          thrown = true;
          throw new Error("AUTH PLAIN failed: 454 4.7.0 Temporary authentication failure");
        }
        real(file, data, options);
      },
    );
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-preapproval-"));
  process.env.CONTENT_DIR = dir;
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

  const { migrateToLatest } = await import("@/lib/db/migrate");
  const { getDatabase } = await import("@/lib/db");
  await migrateToLatest(await getDatabase());
});

afterEach(() => {
  writeSpy?.mockRestore();
  writeSpy = null;
});

afterAll(async () => {
  const { closeDatabase } = await import("@/lib/db");
  await closeDatabase();
  for (const key of ["CONTENT_DIR", "DATABASE_URL", "CONTACTS_ENCRYPTION_KEY", "SESSION_SECRET"]) {
    delete process.env[key];
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("mailing a guest invite to a named address", () => {
  const FAMILY = "family@example.test";

  test("pre-approves that address and mails the invitation", async () => {
    const owner = await ownerToken();
    const created = await createLink(owner, { kind: "guest", email: FAMILY, name: "Family", locale: "en" });

    expect(created.status).toBe(201);
    expect(created.body.sent).toBe(true);
    expect(created.body.invite?.url).toMatch(/\/ana\/invite\/guest\/fs_inv_/);

    // One .eml on disk, addressed to the family — the fifth letter this task
    // adds, and not merely the code that follows redemption.
    const files = fs.readdirSync(path.join(dir, OWNER, "mail"));
    expect(files.some((f) => f.includes("family-example-test"))).toBe(true);
  });

  test("redeeming it writes an ordinary pending row — nothing is granted before proof", async () => {
    const owner = await ownerToken();
    const created = await createLink(owner, { kind: "guest", email: FAMILY, name: "Family", locale: "en" });
    const token = tokenFrom(created.body.invite!.url!);

    const redeemed = await redeem({ token, name: "Family", email: FAMILY });
    expect(redeemed.status).toBe(202);
    expect(redeemed.body.status).toBe("code");

    const contact = await contactRow(FAMILY);
    expect(contact).not.toBeNull();
    expect(contact!.status).toBe("pending");
    expect(contact!.confirmedAt).toBeNull();
    expect(await grantExists(contact!.id)).toBe(false);
  });

  test("proving that exact address skips the queue and grants access on the spot", async () => {
    const code = await freshCode(FAMILY);
    const result = await confirm(FAMILY, code);

    expect(result.status).toBe(200);
    expect(result.body.ok).toBe(true);
    // Not "pending" — the whole point. This is the response the owner
    // clicking Approve would otherwise have produced.
    expect(result.body.status).toBe("active");

    const contact = await contactRow(FAMILY);
    expect(contact!.status).toBe("active");
    expect(contact!.approvedAt).not.toBeNull();
    expect(await grantExists(contact!.id)).toBe(true);

    // The owner's queue was never touched: `notifyOwnerOfRequest` is only
    // called on the non-preapproved branch, so `notified_at` never turns
    // true for this address.
    expect(await notifiedAt(FAMILY)).toBeNull();
  });

  test("a different address redeeming the same link still asks, and grants nothing", async () => {
    const owner = await ownerToken();
    const created = await createLink(owner, { kind: "guest", email: FAMILY, name: "Family", locale: "en" });
    const token = tokenFrom(created.body.invite!.url!);

    const STRANGER = "stranger@example.test";
    // The link forwarded on, exactly as decision 19 says is safe to do.
    const redeemed = await redeem({ token, name: "Stranger", email: STRANGER });
    expect(redeemed.body.status).toBe("code");

    const code = await freshCode(STRANGER);
    const result = await confirm(STRANGER, code);
    expect(result.status).toBe(200);
    // Pending, not active: this address was never the one the owner typed.
    expect(result.body.status).toBe("pending");

    const contact = await contactRow(STRANGER);
    expect(contact!.status).toBe("pending");
    expect(await grantExists(contact!.id)).toBe(false);
    // And the owner *was* told about this one — the ordinary path, untouched.
    expect(await notifiedAt(STRANGER)).not.toBeNull();
  });
});

describe("mail failures are best effort (B272's lesson, extended here)", () => {
  test("a send failure on the invite mail does not fail the create call", async () => {
    const owner = await ownerToken();
    const target = "flaky-invite@example.test";
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    failMailOnceTo(target);
    try {
      const created = await createLink(owner, { kind: "guest", email: target, locale: "en" });
      // The invite and its pre-approval both exist regardless of the mail —
      // only `sent` reports the send itself failed.
      expect(created.status).toBe(201);
      expect(created.body.sent).toBe(false);
      expect(created.body.invite?.url).toBeTruthy();
      expect(error).toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });

  test("a send failure on the approval mail does not undo the grant it followed", async () => {
    const target = "flaky-approved@example.test";
    const owner = await ownerToken();
    const created = await createLink(owner, { kind: "guest", email: target, locale: "en" });
    const token = tokenFrom(created.body.invite!.url!);
    await redeem({ token, name: "Flaky", email: target });
    const code = await freshCode(target);

    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    failMailOnceTo(target);
    try {
      const result = await confirm(target, code);
      // The 200 with `status: "active"` the reader gets, and the grant behind
      // it, do not depend on the letter that tells them so.
      expect(result.status).toBe(200);
      expect(result.body.status).toBe("active");
      const contact = await contactRow(target);
      expect(await grantExists(contact!.id)).toBe(true);
      expect(error).toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });
});
