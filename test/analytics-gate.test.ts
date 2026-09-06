import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

/**
 * Who may open `/<user>/me/analytics` — B566.
 *
 * The page is one gate and one line: `isOwner`, then `notFound()`. That makes
 * it cheap to get wrong in exactly one way, and the way is not subtle — it is
 * the difference between "the owner sees who reads their journal" and "anybody
 * who proves an email address does". `test/access-gate.test.ts` has the long
 * argument for why proving an address must never widen anything; this is the
 * same property, asserted for the one page that was added after it.
 *
 * **`notFound` and not `403`**, everywhere below. A refusal that distinguished
 * "not yours" from "not there" would tell a stranger that this journal counts
 * its readers, which is the owner's business and not the internet's.
 */

const jar = vi.hoisted(() => ({ cookies: {} as Record<string, string> }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      jar.cookies[name] === undefined ? undefined : { value: jar.cookies[name] },
  }),
  headers: async () => new Headers(),
}));

const OWNER = "ana";
const OWNER_EMAIL = "ana@example.test";
/** Signed in, and nothing else — the row that matters most. */
const STRANGER = "anyone@example.test";
/** On the trip's `people:`, so they may *write* to it. They still may not see
 * who reads it: B566 defers the buddy view deliberately, and a test is how a
 * deferral stays deferred rather than quietly arriving. */
const TRAVELLER = "robin@example.test";

let dir: string;
const tokens: Record<string, string> = {};

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-analytics-gate-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "gate.db")}`;
  process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";

  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test" },
      users: { reserved: [] },
      features: { analytics: { enabled: true }, auth: { enabled: true } },
    }),
  );
  fs.mkdirSync(path.join(dir, OWNER, "trips", "alps", "entries"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title: "Ana",
      owner: { name: "Ana A", nickname: "Ana", email: OWNER_EMAIL },
      features: { analytics: { enabled: true }, auth: { enabled: true } },
    }),
  );
  fs.writeFileSync(
    path.join(dir, OWNER, "trips", "alps", "trip.md"),
    [
      "---",
      "id: alps",
      'title: "Alps"',
      'start: "2026-01-01"',
      'end: "2026-01-10"',
      "status: past",
      "visibility: public",
      "people:",
      '  - name: "Robin"',
      `    email: "${TRAVELLER}"`,
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

  const { issueCode, verifyCode } = await import("@/lib/auth");
  for (const email of [OWNER_EMAIL, STRANGER, TRAVELLER]) {
    const { code } = await issueCode(OWNER, email, "guest");
    const session = await verifyCode(OWNER, email, code, "guest");
    if (!session.ok) throw new Error(`sign-in failed for ${email}: ${session.reason}`);
    tokens[email] = session.token;
  }
});

afterAll(async () => {
  const { closeDatabase } = await import("@/lib/db");
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.SESSION_SECRET;
  fs.rmSync(dir, { recursive: true, force: true });
});

function as(email: string | null) {
  jar.cookies = {};
  if (email) jar.cookies.fs_session = tokens[email];
}

/** What the page's gate actually asks. Called through the same module the page
 * imports, so a change of gate there fails here rather than passing silently. */
async function mayOpen(): Promise<boolean> {
  const { isOwner } = await import("@/lib/contacts/session");
  return isOwner(OWNER);
}

describe("who may see who is reading", () => {
  test("the owner may", async () => {
    as(OWNER_EMAIL);
    expect(await mayOpen()).toBe(true);
  });

  test("a signed-out reader may not", async () => {
    as(null);
    expect(await mayOpen()).toBe(false);
  });

  test("proving an address grants nothing", async () => {
    as(STRANGER);
    expect(await mayOpen()).toBe(false);
  });

  test("being on the trip is not being the owner — the buddy view is deferred", async () => {
    as(TRAVELLER);
    expect(await mayOpen()).toBe(false);
  });

  test("the report itself is refused when the journal never asked for it", async () => {
    // Belt and braces: even if the gate above were wrong, a journal with the
    // capability off has no report to hand over. Absent rather than broken.
    const { visitorReport } = await import("@/lib/analytics/report");
    expect(await visitorReport("nobody-here", 30)).toBeNull();
  });
});
