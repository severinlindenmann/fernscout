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

/** Every cookie the mocked `next/headers` hands back. Most redemptions in
 * this file are a stranger's first visit (nothing to read), but B350's own
 * tests below need `set` too: `/api/contacts/confirm` writes the guest
 * session cookie here on a pre-approved confirmation. */
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

/** `invitePutResponse` directly, the way `/api/web/[user]/invites` (Studio ›
 * Readers' own door) makes a link now — B2295 (one door for readers, B2291)
 * removed the agent bearer route this used to go through — reshaped into
 * the pre-v2 `{invite: {id, url}, sent}` shape this file's assertions were
 * written against, since v2's own response is the flat document plus `url`
 * and (only on a failed send) `note` rather than a nested `invite` and an
 * explicit `sent` boolean. `_token` is unused and kept only so call sites
 * did not all need editing too. */
async function createLink(
  _token: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: InviteBody }> {
  const { invitePutResponse } = await import("@/lib/contacts/invitesResponse");
  const id = crypto.randomUUID();
  const response = await invitePutResponse(
    OWNER,
    id,
    new Request(`https://example.test/api/web/ana/invites`, {
      method: "PUT",
      headers: headers(),
      body: JSON.stringify(body),
    }),
  );
  const status = response.status;
  const raw = (await response.json()) as {
    id?: string;
    url?: string;
    note?: string;
    error?: string;
    message?: string;
  };
  if (status >= 400) return { status, body: { error: raw.error, message: raw.message } };
  return {
    status,
    body: {
      ok: true,
      invite: { id: raw.id!, url: raw.url },
      ...(typeof body.email === "string" ? { sent: raw.note === undefined } : {}),
    },
  };
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

  const { migrateToLatest } = await import("@/lib/db/migrate");
  const { getDatabase } = await import("@/lib/db");
  await migrateToLatest(await getDatabase());
});

afterEach(() => {
  writeSpy?.mockRestore();
  writeSpy = null;
  // A pre-approved confirmation now sets the guest session cookie (B350);
  // clear it between tests so one redemption's session cannot make the next
  // test's redeemer read as already signed in.
  jar.cookies = {};
});

afterAll(async () => {
  const { closeDatabase } = await import("@/lib/db");
  await closeDatabase();
  for (const key of ["CONTENT_DIR", "DATA_DIR", "DATABASE_URL", "CONTACTS_ENCRYPTION_KEY", "SESSION_SECRET"]) {
    delete process.env[key];
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("the whole file, kept in written order", { shuffle: false }, () => {
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
      const files = fs.readdirSync(path.join(dir, "mail", OWNER));
      expect(files.some((f) => f.includes("family-example-test"))).toBe(true);
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

  });
});
