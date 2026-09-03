import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";

/**
 * The uniform `202` is uniform in the clock too — B159.
 *
 * B37 made this endpoint answer identically whatever token it is given, so it
 * cannot be used to ask "is that invite link still live?". Four probes against
 * the live site proved the *body* achieves that perfectly: byte-identical
 * `202 {"status":"accepted"}` with identical headers for no token, a revoked
 * token, an invented token and a live one.
 *
 * The clock did not. A live token took 1.95s against roughly 0.19s for each of
 * the three dead ones, because everything a live token causes — a database
 * insert, `issueCode`, then SMTP and an `.eml` write — happened before the
 * response. Ten times is not a subtle signal, and it distinguishes exactly the
 * thing B37 decided a holder must not learn: "this invite was revoked" from
 * "this address is wrong".
 *
 * **The guard here is an ordering assertion, not a stopwatch.** Wall-clock
 * comparisons in a test suite are flaky and prove the property only for
 * whatever the machine was doing that second. What actually has to hold is
 * that the response does not wait for the expensive work, so that is what is
 * asserted: the mail is still unsent when the `202` is in hand, and it is sent
 * afterwards. A stopwatch case follows it, with a deliberately slow send, for
 * the shape of the original measurement.
 */

const KEY = "11".repeat(32);
const OWNER = "ana";

/** Resolves when the deferred send starts; held open until the test lets go. */
let sendStarted: (() => void) | undefined;
let releaseSend: (() => void) | undefined;
const sends: string[] = [];

vi.mock("@/lib/contacts/mail", () => ({
  sendCodeMail: vi.fn(async (_user: string, _u: unknown, email: string) => {
    sends.push(email);
    sendStarted?.();
    await new Promise<void>((resolve) => {
      releaseSend = resolve;
    });
  }),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

let dir: string;
let ip = 0;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-timing-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "timing.db")}`;
  process.env.CONTACTS_ENCRYPTION_KEY = KEY;
  delete process.env.AUTH_DEV_CODE;

  fs.mkdirSync(path.join(dir, OWNER, "trips"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title: "Ana's journal",
      tagline: "t",
      owner: { name: "Ana B", nickname: "Ana" },
      startLocation: "X",
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      displayCurrencies: ["CHF"],
      units: "metric",
      features: { contacts: { enabled: true } },
    }),
  );
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", defaultUser: OWNER },
      users: { reserved: [] },
      features: { contacts: { enabled: true } },
    }),
  );
  clearConfigCache();
  clearUserCache();

  const { migrateToLatest } = await import("@/lib/db/migrate");
  await migrateToLatest(await getDatabase());

  sends.length = 0;
  sendStarted = undefined;
  releaseSend = undefined;
});

afterEach(async () => {
  releaseSend?.();
  const { flushAfterResponse } = await import("@/lib/afterResponse");
  await flushAfterResponse();
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.CONTACTS_ENCRYPTION_KEY;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

/**
 * A fresh `x-forwarded-for` per call: C15 caps this route at five submissions
 * per IP per quarter hour, and `lib/rateLimit.ts` is a module-level map shared
 * for the life of the file. The B37 agent burned four of its five slots
 * measuring this on the live site, which is a good part of why the guard lives
 * here now.
 */
async function post(token: string, email: string) {
  const { POST } = await import("@/app/api/contacts/request/route");
  return POST(
    new Request("https://example.test/api/contacts/request", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": `198.51.100.${(ip += 1)}`,
      },
      body: JSON.stringify({
        user: OWNER,
        name: "A Reader",
        locale: "en",
        invite: token,
        email,
        wantsEmailDigest: false,
        wantsPostcard: false,
      }),
    }),
  );
}

async function liveToken(): Promise<string> {
  const { createInvite } = await import("@/lib/contacts/invites");
  return (await createInvite(OWNER, { name: "A Reader", locale: "en" })).token;
}

describe("a live token is not distinguishable by how long the answer takes", () => {
  test("the 202 arrives before the mail is sent, and the mail is still sent", async () => {
    const token = await liveToken();
    const started = new Promise<void>((resolve) => {
      sendStarted = resolve;
    });

    const response = await post(token, "live@example.test");
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ status: "accepted" });

    // The assertion that carries the whole ticket: the response is in hand and
    // the expensive work has not finished. Before the fix `await POST(...)`
    // could not return until the send had, which is what made a live token
    // take ten times as long as a dead one.
    expect(sends).toEqual([]);

    // …and it is not dropped on the floor either. Deferring the work must not
    // quietly become skipping it.
    await started;
    expect(sends).toEqual(["live@example.test"]);
    releaseSend?.();

    const { flushAfterResponse } = await import("@/lib/afterResponse");
    await flushAfterResponse();

    const { listContacts } = await import("@/lib/contacts");
    expect((await listContacts(OWNER)).map((c) => c.email)).toContain("live@example.test");
  });

  test("a live, a revoked and an absent token answer in comparable time", async () => {
    const { createInvite, revokeInvite } = await import("@/lib/contacts/invites");

    const live = await liveToken();
    const doomed = await createInvite(OWNER, { name: "Gone", locale: "en" });
    await revokeInvite(OWNER, doomed.id);

    // The send never resolves unless a test lets it, so any millisecond of it
    // on the response path would dominate the comparison completely.
    const elapsed = async (token: string, email: string) => {
      const at = performance.now();
      const response = await post(token, email);
      const took = performance.now() - at;
      expect(response.status).toBe(202);
      return took;
    };

    const samples: Record<string, number[]> = { live: [], revoked: [], absent: [] };
    for (let n = 0; n < 3; n++) {
      samples.live.push(await elapsed(live, `live-${n}@example.test`));
      samples.revoked.push(await elapsed(doomed.token, `revoked-${n}@example.test`));
      samples.absent.push(await elapsed("nosuchtokenatall000000000", `absent-${n}@example.test`));
      releaseSend?.();
    }

    const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    const live_ = median(samples.live);
    const dead = Math.max(median(samples.revoked), median(samples.absent));

    // Generous, on purpose. The failure this catches is the order-of-magnitude
    // one B159 measured — 1.95s against 0.19s — not a few milliseconds of
    // difference between one database read and none, which is real and is not
    // what makes a link testable.
    expect(live_).toBeLessThan(Math.max(dead * 5, 50));
  });
});

/**
 * The other half of B159, and much smaller: a comment describing a mechanism
 * that is not the one in the file.
 */
describe("what /<user>/join actually does with a POST", () => {
  test("redirects a GET and refuses a POST, as the comment now says", async () => {
    const route = await import("@/app/[user]/join/route");
    expect(Object.keys(route)).not.toContain("POST");

    const response = await route.GET(new Request("https://example.test/ana/join"), {
      params: Promise.resolve({ user: OWNER }),
    });
    expect(response.status).toBe(308);
    expect(response.headers.get("location")).toBe(`/${OWNER}/me`);
  });
});
