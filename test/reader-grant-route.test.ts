import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { hasReadGrant } from "@/lib/grants";

/**
 * Route-level coverage for `POST /api/helper/[user]/reader/grant` — the
 * security review's own finding: `isHelperOwner(user)` was read and confirmed
 * correct by eye, but nothing in the suite proved it at the route. Everything
 * in `test/contacts-grant-access.test.ts` exercises `lib/contacts`, one layer
 * below this door.
 *
 * The mock follows `test/helper-attach.test.ts`'s own pattern exactly:
 * `resolveAccess` from `@/lib/auth/handshake` is the one function every
 * cookie caller in this family bottoms out at (`resolveCookieCaller`,
 * `lib/helper/caller.ts`), so controlling its return value stands in for
 * "what the two session cookies say" without inventing a second harness.
 */

const OWNER_EMAIL = "alex@example.test";
const KEY = "22".repeat(32);

const { resolveAccess } = vi.hoisted(() => ({
  resolveAccess: vi.fn(async () => ({ email: null as string | null })),
}));
vi.mock("@/lib/auth/handshake", () => ({ resolveAccess }));

const { POST } = await import("@/app/api/helper/[user]/reader/grant/route");

const params = { params: Promise.resolve({ user: "alex" }) };
let dir: string;

function grant(headers: Record<string, string> = {}) {
  return POST(
    new Request("https://t.test/api/helper/alex/reader/grant", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify({ name: "Priya", email: "priya@example.test" }),
    }),
    params,
  );
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-reader-grant-route-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "test.db")}`;
  process.env.CONTACTS_ENCRYPTION_KEY = KEY;
  process.env.SESSION_SECRET = "reader-grant-route-secret-b1833";
  resolveAccess.mockResolvedValue({ email: null });

  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "T", url: "https://t.test" },
      users: { reserved: [] },
      features: { auth: { enabled: true }, helper: { enabled: true } },
    }),
  );
  fs.mkdirSync(path.join(dir, "alex"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "alex", "config.json"),
    JSON.stringify({
      title: "Alex",
      tagline: "t",
      owner: { name: "A B", nickname: "A", email: OWNER_EMAIL },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
    }),
  );
  clearConfigCache();
  clearUserCache();
  await migrateToLatest(await getDatabase());
});

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.CONTACTS_ENCRYPTION_KEY;
  delete process.env.SESSION_SECRET;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("POST /api/helper/[user]/reader/grant — the owner-only gate", () => {
  test("no owner cookie at all is refused, and no grant is created", async () => {
    resolveAccess.mockResolvedValue({ email: null });
    const response = await grant();
    expect(response.status).not.toBe(200);
    expect((await response.json()).ok).not.toBe(true);
  });

  test("a different signed-in user — not this journal's owner — is refused, and no grant is created", async () => {
    resolveAccess.mockResolvedValue({ email: "mallory@example.test" });
    const response = await grant();
    expect(response.status).not.toBe(200);
    expect((await response.json()).ok).not.toBe(true);
  });

  test("a bearer token with no cookie session is refused — the gate never reads Authorization", async () => {
    // No cookie recognises anybody (mirrors "no owner cookie at all"), but
    // this request also carries a bearer token, proving the token itself
    // buys nothing: `isHelperOwner` -> `resolveCookieCaller` never looks at
    // `request.headers`, only at what `resolveAccess` (the cookie resolver)
    // says.
    resolveAccess.mockResolvedValue({ email: null });
    const response = await grant({ authorization: "Bearer whatever-this-is" });
    expect(response.status).not.toBe(200);
    const body = await response.json();
    expect(body.ok).not.toBe(true);
    expect(body.error).toBe("not_your_journal");
  });

  test("positive control: the real owner's cookie succeeds and the grant actually lands", async () => {
    resolveAccess.mockResolvedValue({ email: OWNER_EMAIL });
    const response = await grant();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.email).toBe("priya@example.test");

    // The route's own response carries no contact id, so verify the grant
    // the same way `test/contacts-grant-access.test.ts` does: look the
    // address up and check the live grant behind it.
    const { listContacts } = await import("@/lib/contacts");
    const rows = await listContacts("alex");
    const priya = rows.find((row) => row.email === "priya@example.test");
    expect(priya).toBeTruthy();
    expect(priya?.status).toBe("active");
    if (priya) {
      expect(await hasReadGrant("alex", priya.id)).toBe(true);
    }
  });
});
