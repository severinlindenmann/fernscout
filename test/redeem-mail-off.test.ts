import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

/**
 * Redeeming a link on a server that cannot send mail — B205.
 *
 * The ordinary path through `/api/contacts/redeem` is: write a `pending`
 * contact, issue six digits, send them, answer `202 {"status":"code"}`. The
 * page in front of the reader renders that last step as *we have sent you a
 * code, go and get it*.
 *
 * With mail off, `sendCodeMail` returns null without sending, and the answer
 * was `{"status":"code"}` all the same. Two costs, the same pair B160 removed
 * from `POST /api/auth/request`: a promise nobody can keep, and — because
 * `issueCode` consumes every live code for an address before writing a new one
 * — a working code taken away to make it.
 *
 * `/api/contacts/request` is deliberately untouched and is asserted here to be
 * untouched: its uniform 202 is what stops it being an oracle for "is this
 * link still live" (B159), and a refusal there would put the oracle back in
 * the status line.
 */

/** No session: this is somebody following a link who has never been here. */
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

const OWNER = "ana";
const OWNER_EMAIL = "ana@example.test";
const READER = "oma@example.test";

let dir: string;
/** One address per call — `lib/rateLimit.ts` is a module-level map shared by
 * the whole file. */
let calls = 0;
function headers(): Record<string, string> {
  calls += 1;
  return { "content-type": "application/json", "x-forwarded-for": `10.1.0.${calls % 250}` };
}

function writeServerConfig(mail: boolean) {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", defaultUser: OWNER },
      users: { reserved: [] },
      features: {
        auth: { enabled: true },
        contacts: { enabled: true },
        // The switch under test. `file` needs no credentials, so turning it
        // back on in the same fixture is one line rather than a mail account.
        mail: { enabled: mail, transport: "file" },
      },
    }),
  );
}

async function reloadConfig() {
  const { clearConfigCache } = await import("@/lib/config");
  const { clearUserCache } = await import("@/lib/users");
  clearConfigCache();
  clearUserCache();
}

async function redeem(
  body: Record<string, unknown>,
): Promise<{ status: number; body: { status?: string; error?: string; message?: string } }> {
  const { POST } = await import("@/app/api/contacts/redeem/route");
  const response = await POST(
    new Request("https://example.test/api/contacts/redeem", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ user: OWNER, ...body }),
    }),
  );
  return { status: response.status, body: (await response.json()) as { status?: string } };
}

async function guestLink(): Promise<string> {
  const { createInvite } = await import("@/lib/contacts/invites");
  const { token } = await createInvite(OWNER, { kind: "guest", name: "Oma" });
  return token;
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-redeem-mail-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.CONTACTS_ENCRYPTION_KEY = "66".repeat(32);
  process.env.SESSION_SECRET = "77".repeat(32);
  delete process.env.AUTH_DEV_CODE;

  writeServerConfig(false);
  fs.mkdirSync(path.join(dir, OWNER, "trips", "invited-2026", "entries"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title: "Two Backpacks",
      tagline: "t",
      owner: { name: "A B", nickname: "A", email: OWNER_EMAIL },
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
    path.join(dir, OWNER, "trips", "invited-2026", "trip.md"),
    ["---", 'id: "invited-2026"', 'title: "Invited"', 'start: "2026-08-25"', 'end: "2026-08-26"',
     'status: "past"', 'visibility: "guest"', "---", "", "Intro.", ""].join("\n"),
  );

  await reloadConfig();
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
  ]) {
    delete process.env[key];
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("a guest link redeemed on a server with mail off", () => {
  test("is refused rather than promised a code", async () => {
    const result = await redeem({ token: await guestLink(), kind: "guest", name: "Oma", email: READER });

    expect(result.body.status).not.toBe("code");
    expect(result.status).toBe(503);
    expect(result.body.error).toBe("mail_disabled");
    // The refusal has to be usable by whoever reads it: it says what is broken
    // and that nothing was taken.
    expect(result.body.message).toContain("still live");
  });

  /** The other half of the cost, and the one nobody would have noticed: the
   * code somebody is already holding must survive a redemption that could not
   * be completed. `issueCode` retires every live code for an address, so the
   * only defence is not reaching it. */
  test("leaves a code that was already live alone", async () => {
    const { issueCode, verifyCode } = await import("@/lib/auth");
    const holder = "opa@example.test";
    const { code } = await issueCode(OWNER, holder, "guest");

    const result = await redeem({ token: await guestLink(), kind: "guest", name: "Opa", email: holder });
    expect(result.status).toBe(503);

    const verified = await verifyCode(OWNER, holder, code, "guest");
    expect(verified.ok, "the code they were already holding was consumed").toBe(true);
  });

  /** Refused *before* anything is written, so a redemption that cannot finish
   * does not leave a request in the owner's queue that nobody can confirm. */
  test("writes no contact", async () => {
    const { getContactByEmail } = await import("@/lib/contacts");
    await redeem({ token: await guestLink(), kind: "guest", name: "Oma", email: READER });
    expect(await getContactByEmail(OWNER, READER)).toBeNull();
  });

  /** The refusal is about the mail, not about the token: an invented token is
   * still answered the way it always was, so nothing new is disclosed. */
  test("a dead token is still answered 202 expired", async () => {
    const result = await redeem({ token: "not-a-token", kind: "guest", name: "Oma", email: READER });
    expect(result.status).toBe(202);
    expect(result.body.status).toBe("expired");
  });
});

describe("with mail on again", () => {
  test("the same link redeems and asks for a code", async () => {
    writeServerConfig(true);
    await reloadConfig();
    try {
      const result = await redeem({
        token: await guestLink(),
        kind: "guest",
        name: "Oma",
        email: "tante@example.test",
      });
      expect(result.status).toBe(202);
      expect(result.body.status).toBe("code");
    } finally {
      writeServerConfig(false);
      await reloadConfig();
    }
  });
});

/**
 * B205 says this route is not its business and says why: its 202 is uniform by
 * construction (B159), so a refusal here would re-time the endpoint and give
 * back the oracle that was taken away. Asserted rather than left as a note,
 * because "we did not touch it" is not something a diff can say a year later.
 */
describe("/api/contacts/request, which this task does not touch", () => {
  async function ask(body: Record<string, unknown>) {
    const { POST } = await import("@/app/api/contacts/request/route");
    const response = await POST(
      new Request("https://example.test/api/contacts/request", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ user: OWNER, ...body }),
      }),
    );
    return { status: response.status, body: (await response.json()) as { status?: string } };
  }

  test("answers the same 202 for a live token and a dead one, with mail off", async () => {
    const { createInvite } = await import("@/lib/contacts/invites");
    const { token } = await createInvite(OWNER, { kind: "personal", name: "Oma" });

    const live = await ask({ invite: token, name: "Oma", email: "queue-live@example.test" });
    const dead = await ask({ invite: "not-a-token", name: "Oma", email: "queue-dead@example.test" });

    expect(live.status).toBe(202);
    expect(live.body).toEqual({ status: "accepted" });
    expect(dead).toEqual(live);
  });
});
