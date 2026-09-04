import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";

/**
 * B384 — a guest the owner adds by hand used to be a dead end.
 *
 * `case "create"` in `app/api/contacts/admin/route.ts` mailed a bare six-digit
 * code with nowhere to type it: `confirmedAt` stayed null forever and
 * `approveContact` refused (`not_confirmed`). It now mails the same
 * pre-approved guest invitation `POST /api/v1/{user}/invites` sends for
 * B319 — `createInvite` + `sendInviteMail` — so the row the owner just typed
 * in is confirmed and approved the moment the recipient opens the link and
 * proves their own address. `approveContact` stays the only thing that
 * creates a grant, and an unproved address is still never approved: this
 * only replaces what got mailed, not what proof requires.
 */

/** The cookie jar `isOwner` reads via the mocked `next/headers` — every admin
 * route test here authenticates with an agent bearer token instead, so
 * nothing is ever read back. `set` still has to exist: a pre-approved
 * `/api/contacts/confirm` writes the reader's guest session cookie there
 * (B350), whether or not this suite looks at it afterwards. */
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => {} }),
}));

const OWNER = "ana";
const OWNER_EMAIL = "ana@example.test";

let dir: string;
let calls = 0;
function headers(extra: Record<string, string> = {}): Record<string, string> {
  calls += 1;
  return { "content-type": "application/json", "x-forwarded-for": `10.6.0.${calls % 250}`, ...extra };
}

async function ownerToken(): Promise<string> {
  const { issueCode, verifyCode } = await import("@/lib/auth");
  const { code } = await issueCode(OWNER, OWNER_EMAIL, "agent");
  const result = await verifyCode(OWNER, OWNER_EMAIL, code, "agent");
  if (!result.ok) throw new Error("no owner token");
  return result.token;
}

type AdminBody = {
  ok?: boolean;
  error?: string;
  contact?: { id: string; status: string; confirmedAt: string | null; createdVia: string | null };
  sent?: boolean;
};

/** `POST /api/contacts/admin`, as the owner's own page calls it. */
async function admin(
  body: Record<string, unknown>,
  token: string,
): Promise<{ status: number; body: AdminBody }> {
  const { POST } = await import("@/app/api/contacts/admin/route");
  const response = await POST(
    new Request("https://example.test/api/contacts/admin", {
      method: "POST",
      headers: headers({ authorization: `Bearer ${token}` }),
      body: JSON.stringify({ user: OWNER, ...body }),
    }),
  );
  return { status: response.status, body: (await response.json()) as AdminBody };
}

/** `POST /api/contacts/redeem` — the door the mailed link's page posts to. */
async function redeem(
  body: Record<string, unknown>,
): Promise<{ status: number; body: { status?: string } }> {
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

/** `POST /api/contacts/confirm` — the door the six-digit code that follows
 * `redeem` posts to. */
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

/** Every mail this journal has "sent" (dry-run: a file on disk), addressed to
 * the given local part. */
function mailedTo(marker: string): boolean {
  const files = fs.readdirSync(path.join(dir, OWNER, "mail"));
  return files.some((f) => f.includes(marker));
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-admin-invite-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.CONTACTS_ENCRYPTION_KEY = "cc".repeat(32);
  process.env.SESSION_SECRET = "dd".repeat(32);
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
  vi.restoreAllMocks();
});

afterAll(async () => {
  const { closeDatabase } = await import("@/lib/db");
  await closeDatabase();
  for (const key of ["CONTENT_DIR", "DATABASE_URL", "CONTACTS_ENCRYPTION_KEY", "SESSION_SECRET"]) {
    delete process.env[key];
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("the owner adding a guest by hand mails an invitation, not a bare code", () => {
  const FAMILY = "family@example.test";

  test("create mails a link, and the row is pre-approved the moment it is opened", async () => {
    const token = await ownerToken();

    const created = await admin(
      { action: "create", name: "Family", email: FAMILY, locale: "en" },
      token,
    );
    expect(created.status).toBe(200);
    expect(created.body.ok).toBe(true);
    expect(created.body.contact?.status).toBe("pending");
    expect(created.body.contact?.confirmedAt).toBeNull();
    // Not `owner` any more — the row now points at the invite `sendInviteMail`
    // used, which is what `preapprovedEmailFor` reads on confirmation.
    expect(created.body.contact?.createdVia).toMatch(/^invite:/);

    // A mail landed on disk, addressed to the family — the invitation, not
    // the bare code B384 found.
    expect(mailedTo("family-example-test")).toBe(true);

    // Nothing was granted yet: the address has not proved itself.
    const before = await contactRow(FAMILY);
    expect(before?.status).toBe("pending");
    expect(await grantExists(before!.id)).toBe(false);

    // The recipient opens the mailed link — the same door B319's own link
    // leads to — and proves the address with the six-digit code that follows.
    const inviteId = created.body.contact!.createdVia!.slice("invite:".length);
    const { listInvitesWithLinks } = await import("@/lib/contacts/invites");
    const { serverSite } = await import("@/lib/site");
    const invite = (await listInvitesWithLinks(OWNER, serverSite().url)).find(
      (candidate) => candidate.id === inviteId,
    );
    expect(invite?.url).toBeTruthy();
    const inviteToken = invite!.url!.split("/").pop()!;

    const redeemed = await redeem({ token: inviteToken, name: "Family", email: FAMILY });
    expect(redeemed.body.status).toBe("code");

    const code = await freshCode(FAMILY);
    const result = await confirm(FAMILY, code);

    // `active`, not `pending`: the owner already vouched for this exact
    // address by typing it in, so proving it is the whole of what was left.
    expect(result.body.status).toBe("active");

    const after = await contactRow(FAMILY);
    expect(after?.status).toBe("active");
    expect(after?.approvedAt).not.toBeNull();
    expect(await grantExists(after!.id)).toBe(true);
  });

  test("create refuses an address already on the list, same as before", async () => {
    const token = await ownerToken();
    const dup = await admin(
      { action: "create", name: "Again", email: FAMILY, locale: "en" },
      token,
    );
    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe("contact_exists");
  });
});

describe("resending the mailed invitation", () => {
  const LOST_IT = "lost-it@example.test";

  test("mails the same link again for a row that has not confirmed yet", async () => {
    const token = await ownerToken();
    await admin({ action: "create", name: "Lost It", email: LOST_IT, locale: "en" }, token);
    const contact = await contactRow(LOST_IT);

    const resent = await admin({ action: "resend", id: contact!.id }, token);
    expect(resent.status).toBe(200);
    expect(resent.body.ok).toBe(true);
    expect(resent.body.sent).toBe(true);

    // Two mails to the same address now: the original and the resend.
    const files = fs.readdirSync(path.join(dir, OWNER, "mail"));
    expect(files.filter((f) => f.includes("lost-it-example-test")).length).toBeGreaterThanOrEqual(2);
  });

  test("refuses once the address has confirmed — nothing left to resend", async () => {
    const email = "already-confirmed@example.test";
    const token = await ownerToken();
    await admin({ action: "create", name: "Confirmed", email, locale: "en" }, token);
    const code = await freshCode(email);
    await confirm(email, code);
    const contact = await contactRow(email);

    const resent = await admin({ action: "resend", id: contact!.id }, token);
    expect(resent.status).toBe(409);
    expect(resent.body.error).toBe("already_confirmed");
  });

  test("refuses a row with no invite behind it — a legacy `owner` row", async () => {
    const { requestContact } = await import("@/lib/contacts");
    const token = await ownerToken();
    const { contactId } = await requestContact(OWNER, {
      name: "Legacy",
      email: "legacy-owner@example.test",
      locale: "en",
      address: null,
      wantsEmailDigest: false,
      wantsPostcard: false,
      createdVia: "owner",
    });

    const resent = await admin({ action: "resend", id: contactId! }, token);
    expect(resent.status).toBe(409);
    expect(resent.body.error).toBe("no_invite");
  });
});
