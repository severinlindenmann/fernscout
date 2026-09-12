import { afterAll, beforeAll, describe, expect, test } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { migrateToLatest } from "@/lib/db/migrate";

/**
 * B1026 — a malformed body used to answer the same `202` as a
 * syntactically-valid, unrecognised address.
 *
 * Only the shape checks (`user` present, `email` present and syntactically
 * an address) get named with a `400`. Whether the address is *known* to this
 * journal still answers the uniform `202` — that is the property the route
 * exists to protect, and this file's last case is the one that would break
 * if a future edit folded existence back into the shape check.
 */

const OWNER = "roams";
const OWNER_EMAIL = "owner@example.test";

let dir: string;

function headers(ip: string): Record<string, string> {
  return { "content-type": "application/json", "x-forwarded-for": ip };
}

beforeAll(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-auth-malformed-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "db.sqlite")}`;
  process.env.SESSION_SECRET = "99".repeat(32);

  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "Testbed", url: "https://example.test", defaultUser: OWNER },
      users: { reserved: [] },
      features: { auth: { enabled: true }, mail: { enabled: true, transport: "file" } },
    }),
  );
  fs.mkdirSync(path.join(dir, OWNER, "trips"), { recursive: true });
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
  clearConfigCache();
  clearUserCache();

  await migrateToLatest(await getDatabase());
});

afterAll(async () => {
  await closeDatabase();
  for (const key of ["CONTENT_DIR", "DATABASE_URL", "SESSION_SECRET"]) {
    delete process.env[key];
  }
  fs.rmSync(dir, { recursive: true, force: true });
});

async function ask(body: Record<string, unknown>, ip: string) {
  const { POST } = await import("@/app/api/auth/codes/route");
  const response = await POST(
    new Request("https://example.test/api/auth/codes", {
      method: "POST",
      headers: headers(ip),
      body: JSON.stringify({ for: "read", ...body }),
    }),
  );
  return { status: response.status, body: (await response.json()) as { error?: string } };
}

describe("POST /api/auth/codes tells a malformed body apart from an unknown address", () => {
  test("a syntactically malformed email is refused by name, 400", async () => {
    const result = await ask({ user: OWNER, email: "not-an-address" }, "10.10.1.1");
    expect(result.status).toBe(400);
    expect(result.body.error).toBe("invalid_email");
  });

  test("no email field at all is refused the same way", async () => {
    // Caught by the schema itself (`email` is required) rather than the
    // manual `isEmail` check below it, so the code is the generic shape
    // refusal — still 400, still never a lookup.
    const result = await ask({ user: OWNER }, "10.10.1.2");
    expect(result.status).toBe(400);
    expect(result.body.error).toBe("invalid_request");
  });

  test("a missing username is refused by name, 400", async () => {
    const result = await ask({ email: OWNER_EMAIL }, "10.10.1.3");
    expect(result.status).toBe(400);
    expect(result.body.error).toBe("invalid_request");
  });

  test("a syntactically valid but unrecognised address still gets the uniform 202", async () => {
    const result = await ask(
      { user: OWNER, email: "nobody-on-this-journal@example.test" },
      "10.10.1.4",
    );
    expect(result.status).toBe(202);
    expect(result.body.error).toBeUndefined();
  });
});
