import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { POST } from "@/app/api/auth/signup/verify/route";
import { NO_JOURNAL, issueCode } from "@/lib/auth";
import { clearConfigCache } from "@/lib/config";
import { closeDatabase, getDatabase } from "@/lib/db";
import { clearUserCache } from "@/lib/users";

/**
 * B1568 — an address that already owns a journal is told so at the code
 * step, not three steps later.
 *
 * The cap check lived only in `createJournal()`, which the signup wizard
 * reaches after the journal form and a proven phone number — so the owner of
 * a journal who chose "create one" verified their email, filled in the form
 * and burned a real SMS before `too_many_journals` came back. The verify
 * route knows the answer the moment the code proves the address.
 *
 * The order matters and is asserted here: the refusal comes only *after* a
 * correct code. Answered on the address alone, this route would be the
 * "who is on this server" oracle the uniform 202 on /api/auth/signup/request
 * exists to prevent.
 */

let dir: string;

let caller = 0;
function verify(body: Record<string, unknown>) {
  caller += 1;
  return POST(
    new Request("https://example.test/api/auth/signup/verify", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": `203.0.113.${caller}`,
      },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-signup-verify-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "auth.db")}`;
  process.env.SESSION_SECRET = "b1568-test-secret-b1568-secret!!";
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "T", url: "https://t.test" },
      users: { reserved: [] },
      features: { signup: { enabled: true }, auth: { enabled: true } },
    }),
  );
  // A journal already on disk, owned by the address under test.
  fs.mkdirSync(path.join(dir, "robin", "trips"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "robin", "config.json"),
    JSON.stringify({
      title: "Robin's journal",
      owner: { name: "Robin Traveller", nickname: "Robin", email: "owner@example.test" },
      locales: ["en"],
    }),
  );
  clearConfigCache();
  clearUserCache();

  const { migrateToLatest } = await import("@/lib/db/migrate");
  await migrateToLatest(await getDatabase());
});

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.SESSION_SECRET;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("POST /api/auth/signup/verify for an address at the journal cap", () => {
  test("refuses with too_many_journals, naming the journal, and returns no token", async () => {
    const { code } = await issueCode(NO_JOURNAL, "owner@example.test", "signup");
    const response = await verify({ email: "owner@example.test", code });
    expect(response.status).toBe(409);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.error).toBe("too_many_journals");
    expect(body.message).toContain("robin");
    expect(body.token).toBeUndefined();
  });

  test("but only after the code proves the address — a wrong code stays invalid_code", async () => {
    await issueCode(NO_JOURNAL, "owner@example.test", "signup");
    const response = await verify({ email: "owner@example.test", code: "000000" });
    expect(response.status).toBe(401);
    expect(((await response.json()) as Record<string, unknown>).error).toBe("invalid_code");
  });

  test("an address owning nothing still gets its token", async () => {
    const { code } = await issueCode(NO_JOURNAL, "new@example.test", "signup");
    const response = await verify({ email: "new@example.test", code });
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(typeof body.token).toBe("string");
  });
});
