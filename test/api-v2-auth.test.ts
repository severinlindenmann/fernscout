import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";

/** A settable cookie jar, the same shape `test/invite-one-click.test.ts` and
 * `test/identity-mail-failure.test.ts` use — these routes both read and set
 * cookies outside of a real Next request, which needs a stand-in. */
const jar = vi.hoisted(() => ({ cookies: {} as Record<string, string> }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.cookies[name] === undefined ? undefined : { value: jar.cookies[name] }),
    set: (name: string, value: string) => {
      jar.cookies[name] = value;
    },
  }),
  headers: async () => ({ get: () => null }),
}));

/**
 * B1600 phase 2 step 2 — the three doors that replace v1's eight
 * (`docs/plans/2026-09-12-api-v2/auth.md` §2.2-2.3): `/api/auth/codes`,
 * `/api/auth/codes/redeem`, `/api/auth/links/redeem`.
 */

const OWNER = "roams";
const OWNER_EMAIL = "owner@example.test";
const CODE = "123456";

let dir: string;
let calls = 0;

function headers(extra: Record<string, string> = {}): Record<string, string> {
  calls += 1;
  return { "content-type": "application/json", "x-forwarded-for": `10.9.0.${calls % 250}`, ...extra };
}

async function ask(body: Record<string, unknown>) {
  const { POST } = await import("@/app/api/auth/codes/route");
  const response = await POST(
    new Request("https://example.test/api/auth/codes", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
    }),
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function redeem(body: Record<string, unknown>) {
  const { POST } = await import("@/app/api/auth/codes/redeem/route");
  const response = await POST(
    new Request("https://example.test/api/auth/codes/redeem", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
    }),
  );
  return {
    status: response.status,
    headers: response.headers,
    body: (await response.json()) as Record<string, unknown>,
  };
}

beforeEach(async () => {
  for (const key of Object.keys(jar.cookies)) delete jar.cookies[key];
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-v2-auth-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.SESSION_SECRET = "44".repeat(32);
  process.env.AUTH_DEV_CODE = CODE;

  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "R", url: "https://example.test", defaultUser: OWNER },
      users: { reserved: [] },
      features: {
        auth: { enabled: true },
        signup: { enabled: true },
        mail: { enabled: true, transport: "file" },
      },
    }),
  );
  fs.mkdirSync(path.join(dir, OWNER, "trips", "alps-2026", "entries"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, OWNER, "config.json"),
    JSON.stringify({
      title: "Roams's journal",
      owner: { name: "Robin Traveller", nickname: "Robin", email: OWNER_EMAIL },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      features: { auth: { enabled: true } },
    }),
  );
  fs.writeFileSync(
    path.join(dir, OWNER, "trips", "alps-2026", "trip.md"),
    [
      "---",
      'id: "alps-2026"',
      'title: "Alps"',
      'start: "2026-08-25"',
      'end: "2026-08-26"',
      'status: "past"',
      'visibility: "private"',
      "people:",
      '  - name: "Robin"',
      `    email: "${OWNER_EMAIL}"`,
      "---",
      "",
      "Intro.",
      "",
    ].join("\n"),
  );

  clearConfigCache();
  clearUserCache();
  const { migrateToLatest } = await import("@/lib/db/migrate");
  await migrateToLatest(await getDatabase());
});

afterEach(async () => {
  await closeDatabase();
  for (const key of ["CONTENT_DIR", "DATABASE_URL", "SESSION_SECRET", "AUTH_DEV_CODE"]) {
    delete process.env[key];
  }
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("the for vocabulary, end to end", () => {
  test("read: a code redeems into a cookie, no token in the body", async () => {
    const asked = await ask({ user: OWNER, email: "reader@example.test", for: "read" });
    expect(asked.status).toBe(202);

    const result = await redeem({ user: OWNER, email: "reader@example.test", code: CODE, for: "read" });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true, expires: expect.any(String), scope: "read" });
    expect(result.body.token).toBeUndefined();
    expect(jar.cookies.fs_session).toBeDefined();
  });

  test("write: a code redeems into a token in the body, no cookie", async () => {
    const asked = await ask({ user: OWNER, email: OWNER_EMAIL, for: "write" });
    expect(asked.status).toBe(202);

    const result = await redeem({ user: OWNER, email: OWNER_EMAIL, code: CODE, for: "write" });
    expect(result.status).toBe(200);
    expect(result.body.token).toMatch(/^fs_agent_/);
    expect(result.body.scope).toBe("write");
    expect(result.body.user).toBe(OWNER);
    expect(jar.cookies.fs_session).toBeUndefined();
  });

  test("identity: proves an address to the whole instance, names no journal", async () => {
    const asked = await ask({ email: "someone@example.test", for: "identity" });
    expect(asked.status).toBe(202);

    const result = await redeem({ email: "someone@example.test", code: CODE, for: "identity" });
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ ok: true, expires: expect.any(String), scope: "identity" });
    expect(result.body.token).toBeUndefined();
    expect(jar.cookies.fs_identity).toBeDefined();
  });

  test("signup: a token that can create exactly one journal", async () => {
    const asked = await ask({ email: "new@example.test", for: "signup" });
    expect(asked.status).toBe(202);

    const result = await redeem({ email: "new@example.test", code: CODE, for: "signup" });
    expect(result.status).toBe(200);
    expect(result.body.token).toMatch(/^fs_signup_/);
    expect(result.body.scope).toBe("signup");
    expect(result.body.user).toBeUndefined();
  });

  test("user is refused when for is identity or signup", async () => {
    const identity = await ask({ email: "a@example.test", for: "identity", user: OWNER });
    expect(identity.status).toBe(400);
    const signup = await ask({ email: "a@example.test", for: "signup", user: OWNER });
    expect(signup.status).toBe(400);
  });

  test("user is required when for is read or write", async () => {
    const read = await ask({ email: "a@example.test", for: "read" });
    expect(read.status).toBe(400);
    const write = await ask({ email: "a@example.test", for: "write" });
    expect(write.status).toBe(400);
  });

  test("scope is refused unless for is write", async () => {
    const result = await ask({
      email: "a@example.test",
      for: "read",
      user: OWNER,
      scope: { trip: "alps-2026" },
    });
    expect(result.status).toBe(400);
  });
});

describe("the silence rule", () => {
  test("an unknown journal still gets the uniform 202", async () => {
    const result = await ask({ user: "no-such-journal", email: "reader@example.test", for: "read" });
    expect(result.status).toBe(202);
  });

  test("an unknown address on a real journal still gets the uniform 202", async () => {
    const result = await ask({ user: OWNER, email: "nobody@example.test", for: "read" });
    expect(result.status).toBe(202);
  });

  test("an address with no rights to write still gets the uniform 202, unless it names a journal it may not write", async () => {
    // Silence still holds for reading; writing is the one deliberate exception.
    const result = await ask({ user: OWNER, email: "stranger@example.test", for: "read" });
    expect(result.status).toBe(202);
  });

  test("a write code for an address that may not write answers 403, truthfully", async () => {
    const result = await ask({ user: OWNER, email: "stranger@example.test", for: "write" });
    expect(result.status).toBe(403);
    expect(result.body.error).toBe("not_authorised");
  });

  test("identity and signup are always silent about the address", async () => {
    const identity = await ask({ email: "unknown@example.test", for: "identity" });
    expect(identity.status).toBe(202);
    const signup = await ask({ email: "unknown@example.test", for: "signup" });
    expect(signup.status).toBe(202);
  });
});

describe("the uniform invalid_code", () => {
  test("a wrong code answers 401 invalid_code", async () => {
    await ask({ user: OWNER, email: OWNER_EMAIL, for: "write" });
    const result = await redeem({ user: OWNER, email: OWNER_EMAIL, code: "000000", for: "write" });
    expect(result.status).toBe(401);
    expect(result.body.error).toBe("invalid_code");
  });

  test("no code at all answers the same invalid_code", async () => {
    const result = await redeem({ user: OWNER, email: "nobody@example.test", code: CODE, for: "read" });
    expect(result.status).toBe(401);
    expect(result.body.error).toBe("invalid_code");
  });

  test("the wrong for on a real code answers the same invalid_code", async () => {
    await ask({ user: OWNER, email: "reader@example.test", for: "read" });
    const result = await redeem({ user: OWNER, email: "reader@example.test", code: CODE, for: "write" });
    expect(result.status).toBe(401);
    expect(result.body.error).toBe("invalid_code");
  });

  test("naming a trip the write code was not bound to answers the same invalid_code", async () => {
    await ask({ user: OWNER, email: OWNER_EMAIL, for: "write", scope: { trip: "alps-2026" } });
    const result = await redeem({
      user: OWNER,
      email: OWNER_EMAIL,
      code: CODE,
      for: "write",
      scope: { trip: "no-such-trip" },
    });
    expect(result.status).toBe(401);
    expect(result.body.error).toBe("invalid_code");
  });
});

describe("a trip-bound code", () => {
  test("yields a trip-scoped token, not a journal-wide one", async () => {
    const asked = await ask({
      user: OWNER,
      email: OWNER_EMAIL,
      for: "write",
      scope: { trip: "alps-2026" },
    });
    expect(asked.status).toBe(202);

    const result = await redeem({ user: OWNER, email: OWNER_EMAIL, code: CODE, for: "write" });
    expect(result.status).toBe(200);
    const token = result.body.token as string;

    const { resolveSession } = await import("@/lib/auth");
    const session = await resolveSession(token, "agent");
    expect(session?.scope).toBe("write:trip:alps-2026");
  });

  test("an unqualified write code still opens the whole journal for the owner", async () => {
    await ask({ user: OWNER, email: OWNER_EMAIL, for: "write" });
    const result = await redeem({ user: OWNER, email: OWNER_EMAIL, code: CODE, for: "write" });
    const token = result.body.token as string;

    const { resolveSession } = await import("@/lib/auth");
    const session = await resolveSession(token, "agent");
    expect(session?.scope).toBe("write:content");
  });
});

describe("the rate-limit refusal shape", () => {
  test("too many requests from one address answers 429 with retryAfter", async () => {
    const { POST } = await import("@/app/api/auth/codes/route");
    const ip = "203.0.113.77";
    let last: Response | undefined;
    // The write bucket is the narrowest — 5 per window.
    for (let i = 0; i < 6; i++) {
      last = await POST(
        new Request("https://example.test/api/auth/codes", {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": ip },
          body: JSON.stringify({ user: OWNER, email: OWNER_EMAIL, for: "write" }),
        }),
      );
    }
    expect(last!.status).toBe(429);
    const body = (await last!.json()) as { error?: string; details?: { retryAfter?: number } };
    expect(body.error).toBe("too_many_requests");
    expect(typeof body.details?.retryAfter).toBe("number");
    expect(last!.headers.get("Retry-After")).toBe(String(body.details?.retryAfter));
  });
});

describe("links/redeem", () => {
  test("for: read is unaffected: an unknown link answers link_spent", async () => {
    const { POST } = await import("@/app/api/auth/links/redeem/route");
    const response = await POST(
      new Request("https://example.test/api/auth/links/redeem", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ user: OWNER, token: "not-a-real-token", for: "read" }),
      }),
    );
    expect(response.status).toBe(401);
    expect(((await response.json()) as { error?: string }).error).toBe("link_spent");
  });

  test("a real guest link redeems into a cookie", async () => {
    const { issueCode } = await import("@/lib/auth");
    const { linkToken } = await issueCode(OWNER, "reader@example.test", "guest");
    const { POST } = await import("@/app/api/auth/links/redeem/route");
    const response = await POST(
      new Request("https://example.test/api/auth/links/redeem", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ user: OWNER, token: linkToken, for: "read" }),
      }),
    );
    expect(response.status).toBe(200);
    expect(jar.cookies.fs_session).toBeDefined();
  });

  test("for: identity refuses a user field", async () => {
    const { POST } = await import("@/app/api/auth/links/redeem/route");
    const response = await POST(
      new Request("https://example.test/api/auth/links/redeem", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ token: "x", for: "identity", user: OWNER }),
      }),
    );
    expect(response.status).toBe(400);
  });
});
