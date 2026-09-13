import { afterAll, beforeAll, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";
import { isEnabled } from "@/lib/capabilities";
import { issueCode } from "@/lib/auth";

/**
 * B252 — the trip gate and `/api/auth/*` used to ask two different
 * questions about the same journal.
 *
 * `app/[user]/trips/[trip]/layout.tsx` asked `isEnabled("auth", user)` — the
 * per-journal opt-in every other capability used to have — while
 * `/api/auth/request` and `/api/auth/verify` asked only `isEnabled("auth")`,
 * the server-wide ceiling, with no username. So a journal that never turned
 * `auth` on in its own `config.json` had a gate showing no sign-in form,
 * while the API still minted it codes and issued it sessions.
 *
 * Decision 5 (docs/v2-migration/00-decisions.md, B1666) later made `auth`
 * instance-only outright: no v2 door ever let a journal set it, so
 * `SILENT` and `LOUD` below no longer differ in what they get — both are
 * always answered by the same server-wide switch, everywhere, which is a
 * stronger version of the coordination B252 fixed rather than a weaker one.
 * The three-way split that used to exist here (silent journal / stated
 * journal / server-wide off) collapses into one: the server's answer, and
 * only the server's, reaching the gate and the API alike.
 */

const SILENT = "silent";
const LOUD = "loud";
const OWNER_EMAIL = "owner@example.test";

let dir: string;

function headers(): Record<string, string> {
  return { "content-type": "application/json", "x-forwarded-for": "10.9.0.1" };
}

function writeJournal(username: string) {
  fs.mkdirSync(path.join(dir, username, "trips"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, username, "config.json"),
    JSON.stringify({
      title: `${username}'s journal`,
      owner: { name: "Robin Traveller", nickname: "Robin", email: OWNER_EMAIL },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
    }),
  );
}

function writeServerConfig(authOn: boolean) {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "Testbed", url: "https://example.test", defaultUser: LOUD },
      users: { reserved: [] },
      features: { auth: { enabled: authOn }, mail: { enabled: true, transport: "file" } },
    }),
  );
  clearConfigCache();
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-auth-switch-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.SESSION_SECRET = "88".repeat(32);
  process.env.AUTH_DEV_CODE = "654321";

  writeServerConfig(true);
  writeJournal(SILENT);
  writeJournal(LOUD);
  clearConfigCache();
  clearUserCache();

  await migrateToLatest(await getDatabase());
});

afterAll(async () => {
  await closeDatabase();
  for (const key of ["CONTENT_DIR", "DATABASE_URL", "SESSION_SECRET", "AUTH_DEV_CODE"]) {
    delete process.env[key];
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("the trip gate and the capability report already agree", () => {
  test("a journal that never mentions auth still inherits the server's answer", () => {
    expect(isEnabled("auth", SILENT)).toBe(true);
  });

  test("a journal that states it too — the wording no longer matters", () => {
    expect(isEnabled("auth", LOUD)).toBe(true);
  });

  test("the server switched off reaches both alike", () => {
    writeServerConfig(false);
    try {
      expect(isEnabled("auth", SILENT)).toBe(false);
      expect(isEnabled("auth", LOUD)).toBe(false);
    } finally {
      writeServerConfig(true);
    }
  });
});

describe("POST /api/auth/request now asks the same question", () => {
  test("a guest code is refused for every journal once the server has auth off", async () => {
    writeServerConfig(false);
    try {
      const { POST } = await import("@/app/api/auth/codes/route");
      const response = await POST(
        new Request("https://example.test/api/auth/request", {
          method: "POST",
          headers: headers(),
          body: JSON.stringify({ user: SILENT, email: OWNER_EMAIL, for: "read" }),
        }),
      );
      expect(response.status).toBe(404);
      expect((await response.json()).error).toBe("auth_disabled");
    } finally {
      writeServerConfig(true);
    }
  });

  test("a guest code still goes through for a journal that has", async () => {
    const { POST } = await import("@/app/api/auth/codes/route");
    const response = await POST(
      new Request("https://example.test/api/auth/codes", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ user: LOUD, email: OWNER_EMAIL, for: "read" }),
      }),
    );
    expect(response.status).toBe(202);
  });

  test("an unknown journal is unaffected — still the uniform 202", async () => {
    const { POST } = await import("@/app/api/auth/codes/route");
    const response = await POST(
      new Request("https://example.test/api/auth/codes", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ user: "no-such-journal", email: OWNER_EMAIL, for: "read" }),
      }),
    );
    expect(response.status).toBe(202);
  });
});

describe("POST /api/auth/codes/redeem now asks the same question", () => {
  test("a code cannot be redeemed once the server has auth off", async () => {
    // Write, not read — see the note on the success case below for why.
    const { code } = await issueCode(SILENT, OWNER_EMAIL, "agent");
    writeServerConfig(false);
    try {
      const { POST } = await import("@/app/api/auth/codes/redeem/route");
      const response = await POST(
        new Request("https://example.test/api/auth/codes/redeem", {
          method: "POST",
          headers: headers(),
          body: JSON.stringify({ user: SILENT, email: OWNER_EMAIL, code, for: "write" }),
        }),
      );
      expect(response.status).toBe(404);
      expect((await response.json()).error).toBe("auth_disabled");
    } finally {
      writeServerConfig(true);
    }
  });

  test("the same code shape still redeems for a journal that has turned auth on", async () => {
    // Write, not read: a read redeem sets a cookie via `next/headers`, which
    // needs a request scope this direct route call has no reason to build —
    // the same choice `test/scope-escalation.test.ts` makes for the same
    // reason. The route asks the same `isEnabled("auth", user)` question
    // regardless of `for`, so this still exercises the fix.
    const { code } = await issueCode(LOUD, OWNER_EMAIL, "agent");
    const { POST } = await import("@/app/api/auth/codes/redeem/route");
    const response = await POST(
      new Request("https://example.test/api/auth/codes/redeem", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ user: LOUD, email: OWNER_EMAIL, code, for: "write" }),
      }),
    );
    expect(response.status).toBe(200);
  });

  test("an unknown journal still fails as a wrong code, not as auth_disabled", async () => {
    const { POST } = await import("@/app/api/auth/codes/redeem/route");
    const response = await POST(
      new Request("https://example.test/api/auth/codes/redeem", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          user: "no-such-journal",
          email: OWNER_EMAIL,
          code: "000000",
          for: "write",
        }),
      }),
    );
    expect(response.status).toBe(401);
    expect((await response.json()).error).toBe("invalid_code");
  });
});
