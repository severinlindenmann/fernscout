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
 * per-journal opt-in every other capability uses — while `/api/auth/request`
 * and `/api/auth/verify` asked only `isEnabled("auth")`, the server-wide
 * ceiling, with no username. So a journal that never turned `auth` on in its
 * own `config.json` had a gate showing no sign-in form, while the API still
 * minted it codes and issued it sessions.
 *
 * `SILENT` never mentions `auth`; `LOUD` states it. Both are on the same
 * server, which has `auth` enabled — the ceiling both journals sit under.
 */

const SILENT = "silent";
const LOUD = "loud";
const OWNER_EMAIL = "owner@example.test";

let dir: string;

function headers(): Record<string, string> {
  return { "content-type": "application/json", "x-forwarded-for": "10.9.0.1" };
}

function writeJournal(username: string, statesAuth: boolean) {
  fs.mkdirSync(path.join(dir, username, "trips"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, username, "config.json"),
    JSON.stringify({
      title: `${username}'s journal`,
      owner: { name: "Robin Traveller", nickname: "Robin", email: OWNER_EMAIL },
      defaultLocale: "en",
      locales: ["en"],
      baseCurrency: "CHF",
      ...(statesAuth ? { features: { auth: { enabled: true } } } : {}),
    }),
  );
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-auth-switch-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.SESSION_SECRET = "88".repeat(32);
  process.env.AUTH_DEV_CODE = "654321";

  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "Testbed", url: "https://example.test", defaultUser: LOUD },
      users: { reserved: [] },
      features: { auth: { enabled: true }, mail: { enabled: true, transport: "file" } },
    }),
  );
  writeJournal(SILENT, false);
  writeJournal(LOUD, true);
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
  test("a journal that never mentions auth has it off", () => {
    expect(isEnabled("auth", SILENT)).toBe(false);
  });

  test("a journal that states it has it on", () => {
    expect(isEnabled("auth", LOUD)).toBe(true);
  });
});

describe("POST /api/auth/request now asks the same question", () => {
  test("a guest code is refused for a journal that has not turned auth on", async () => {
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
  test("a code minted for a journal that has not turned auth on cannot be redeemed", async () => {
    // Write, not read — see the note on the success case below for why.
    const { code } = await issueCode(SILENT, OWNER_EMAIL, "agent");
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
