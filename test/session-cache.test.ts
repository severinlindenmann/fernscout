import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";

/**
 * B53 — one page render, one session lookup.
 *
 * `resolveSession` is not a read: it ends with `UPDATE sessions SET
 * last_seen_at`, so every call is a write transaction. A signed-in reader
 * opening a gated trip made five of them, because five separate call sites all
 * legitimately ask who is asking.
 *
 * The fix is `cache()` from React, which memoises for the duration of one
 * request. The whole risk of that fix is **decision 24** — an agent token
 * arrives in `Authorization: Bearer` and a guest session arrives in a cookie,
 * and the two are not interchangeable. A cache that blurred that, or that
 * outlived a request, would turn a performance change into an authentication
 * bug. So this file spends most of its length on the wall rather than on the
 * saving.
 *
 * ## How the scope is faked, and why that is honest
 *
 * `cache()` reads a *dispatcher* off React's shared internals. Next installs
 * one per request; when there is none — a script, a test, a background job —
 * the React server build's `cache` calls straight through and memoises
 * nothing:
 *
 * ```js
 * var dispatcher = ReactSharedInternals.A;
 * if (!dispatcher) return fn.apply(null, arguments);
 * ```
 *
 * The tests below install and remove that dispatcher by hand, so "one request"
 * is a real scope with a real beginning and end rather than a stand-in. The
 * `vi.mock` is needed because vitest resolves `react` without the
 * `react-server` condition and gets the client build, whose `cache` is the
 * identity function — which is also the reason `test/access-gate.test.ts` and
 * `test/viewer.test.ts` are unaffected by any of this.
 */

const require_ = createRequire(import.meta.url);
// Reached through `package.json` because the build itself is not an exported
// subpath — `react-server` is a *condition* on ".", and vitest does not set it.
const reactRoot = path.dirname(require_.resolve("react/package.json"));
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const reactServer: any = require_(
  path.join(reactRoot, "cjs", "react.react-server.development.js"),
);

vi.mock("react", () => reactServer);

const internals = reactServer.__SERVER_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;

/**
 * One request, as far as `cache()` can tell.
 *
 * A fresh store per call, torn down on the way out — which is the property
 * being asserted as much as it is scaffolding. Nothing survives the `finally`.
 */
async function inOneRequest<T>(body: () => Promise<T>): Promise<T> {
  const store = new Map<unknown, unknown>();
  const previous = internals.A;
  internals.A = {
    getCacheForType: (create: () => unknown) => {
      if (!store.has(create)) store.set(create, create());
      return store.get(create);
    },
    cacheSignal: () => null,
  };
  try {
    return await body();
  } finally {
    internals.A = previous;
  }
}

const OWNER = "ana";
const OWNER_EMAIL = "ana@example.test";

let dir: string;

/** Every statement the shared handle runs, so "one lookup" is counted. */
let statements: string[] = [];

function sessionStatements() {
  return statements.filter((sql) => /\bsessions\b/i.test(sql));
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-session-cache-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.SESSION_SECRET = "5c".repeat(32);

  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "S", url: "https://example.test", defaultUser: OWNER },
      users: { reserved: [] },
      features: { auth: { enabled: true } },
    }),
  );
  fs.mkdirSync(path.join(dir, OWNER), { recursive: true });
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title: "A journal",
      tagline: "t",
      owner: { name: "A B", nickname: "A", email: OWNER_EMAIL },
      startLocation: "X",
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      displayCurrencies: ["CHF"],
      units: "metric",
      features: {},
    }),
  );

  const { migrateToLatest } = await import("@/lib/db/migrate");
  const { getDatabase } = await import("@/lib/db");
  const { db } = await getDatabase();
  await migrateToLatest(await getDatabase());

  // Count at the executor, which is every query the shared handle runs.
  const executor = db.getExecutor();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const real = (executor as any).executeQuery.bind(executor);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (executor as any).executeQuery = (compiled: any, ...rest: unknown[]) => {
    statements.push(compiled.sql);
    return real(compiled, ...rest);
  };
});

afterEach(() => {
  statements = [];
});

afterAll(async () => {
  const { closeDatabase } = await import("@/lib/db");
  await closeDatabase();
  for (const key of ["CONTENT_DIR", "DATABASE_URL", "SESSION_SECRET"]) delete process.env[key];
  fs.rmSync(dir, { recursive: true, force: true });
});

async function tokenFor(kind: "guest" | "agent"): Promise<string> {
  const { issueCode, verifyCode } = await import("@/lib/auth");
  const { code } = await issueCode(OWNER, OWNER_EMAIL, kind);
  const result = await verifyCode(OWNER, OWNER_EMAIL, code, kind);
  if (!result.ok) throw new Error(`no ${kind} session`);
  return result.token;
}

describe("five call sites, one lookup", () => {
  test("a page render resolves the reader once and stamps last_seen_at once", async () => {
    const { resolveSession } = await import("@/lib/auth");
    const token = await tokenFor("guest");
    statements = [];

    const answers = await inOneRequest(async () => {
      // The five in B53's list: the layout's `signedIn`, `listableTrips`,
      // `isJournalGuest` from it, `isTravellerOn` from `mayReadTrip`, and
      // `isJournalGuest` again from `mayReadTrip`.
      return [
        await resolveSession(token, "guest"),
        await resolveSession(token, "guest"),
        await resolveSession(token, "guest"),
        await resolveSession(token, "guest"),
        await resolveSession(token, "guest"),
      ];
    });

    // Same answer five times, and it is the right one.
    for (const answer of answers) expect(answer?.email).toBe(OWNER_EMAIL);
    expect(new Set(answers.map((a) => a?.id)).size).toBe(1);

    const selects = sessionStatements().filter((sql) => /^select/i.test(sql));
    const updates = sessionStatements().filter((sql) => /^update/i.test(sql));
    expect(selects, selects.join(" | ")).toHaveLength(1);
    // The column the owner's sessions list shows. Still written — once.
    expect(updates, updates.join(" | ")).toHaveLength(1);
    expect(updates[0]).toMatch(/last_seen_at/);
  });

  test("no call site had to learn that the lookup is cached", async () => {
    // The signature is unchanged and it is still just a function: five
    // unrelated modules call it the way they always did.
    const { resolveSession } = await import("@/lib/auth");
    expect(typeof resolveSession).toBe("function");
    expect(await resolveSession(undefined, "guest")).toBeNull();
  });
});

describe("the wall between a bearer token and a cookie", () => {
  test("caching a guest answer does not answer the agent question", async () => {
    const { resolveSession } = await import("@/lib/auth");
    const guestToken = await tokenFor("guest");
    statements = [];

    const [asGuest, asAgent] = await inOneRequest(async () => [
      await resolveSession(guestToken, "guest"),
      // The same string, down the other channel. `expected` is part of the
      // cache key *and* is checked in the body, so neither the cache nor the
      // lookup can hand this one a session.
      await resolveSession(guestToken, "agent"),
    ]);

    expect(asGuest?.kind).toBe("guest");
    expect(asAgent).toBeNull();
  });

  test("caching an agent answer does not answer the guest question", async () => {
    const { resolveSession } = await import("@/lib/auth");
    const agentToken = await tokenFor("agent");
    statements = [];

    const [asAgent, asGuest] = await inOneRequest(async () => [
      await resolveSession(agentToken, "agent"),
      await resolveSession(agentToken, "guest"),
    ]);

    expect(asAgent?.kind).toBe("agent");
    expect(asGuest).toBeNull();
  });

  test("two different tokens in one request are two different answers", async () => {
    const { resolveSession } = await import("@/lib/auth");
    const first = await tokenFor("guest");
    const second = await tokenFor("guest");
    statements = [];

    const [a, b] = await inOneRequest(async () => [
      await resolveSession(first, "guest"),
      await resolveSession(second, "guest"),
    ]);

    expect(a?.id).toBeTruthy();
    expect(b?.id).toBeTruthy();
    expect(a?.id).not.toBe(b?.id);
    // Two tokens, two lookups. The cache keys on the argument, not on "a
    // session was resolved earlier".
    expect(sessionStatements().filter((sql) => /^select/i.test(sql))).toHaveLength(2);
  });
});

describe("nothing outlives the request", () => {
  test("a second request looks the session up again", async () => {
    const { resolveSession } = await import("@/lib/auth");
    const token = await tokenFor("guest");
    statements = [];

    await inOneRequest(() => resolveSession(token, "guest"));
    await inOneRequest(() => resolveSession(token, "guest"));

    expect(sessionStatements().filter((sql) => /^select/i.test(sql))).toHaveLength(2);
    expect(sessionStatements().filter((sql) => /^update/i.test(sql))).toHaveLength(2);
  });

  test("a session revoked between two requests is refused by the second", async () => {
    const { resolveSession, revokeSession } = await import("@/lib/auth");
    const token = await tokenFor("guest");

    const before = await inOneRequest(() => resolveSession(token, "guest"));
    expect(before).not.toBeNull();
    await revokeSession(before!.id);

    // The dangerous version of this fix is one that remembers across requests.
    // A revoked session would go on being honoured until the process restarted.
    const after = await inOneRequest(() => resolveSession(token, "guest"));
    expect(after).toBeNull();
  });

  test("outside a request there is no cache at all", async () => {
    const { resolveSession } = await import("@/lib/auth");
    const token = await tokenFor("guest");
    statements = [];

    // No dispatcher installed: this is the shape every existing test runs in,
    // and the reason `test/access-gate.test.ts` can flip the viewer between
    // assertions in one process without being answered from a stale cache.
    await resolveSession(token, "guest");
    await resolveSession(token, "guest");
    await resolveSession(token, "guest");

    expect(sessionStatements().filter((sql) => /^select/i.test(sql))).toHaveLength(3);
  });
});
