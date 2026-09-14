import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { POST } from "@/app/api/auth/codes/route";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";
import { closeDatabase, getDatabase } from "@/lib/db";
import { addInvite, listInvites, removeInvite, signupAllowed } from "@/lib/inviteList";

/**
 * B1693 — an invite-only instance takes the addresses it was told about, and
 * no others.
 *
 * The two halves that matter are here: **the default refuses** (a fresh
 * instance that has never written `inviteOnly` takes nobody, so an operator
 * who forgets the setting is closed rather than open), and **no mail is
 * written** for a refused address — the refusal has to happen before
 * `sendSignupCode`, or the control leaks a code to somebody nobody named.
 */

let dir: string;
let data: string;
let caller = 0;

function writeConfig(features: Record<string, unknown>) {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "T", url: "https://t.test" },
      users: { reserved: [] },
      features: { mail: { enabled: true, transport: "file" }, ...features },
    }),
  );
  clearConfigCache();
}

function ask(email: string) {
  caller += 1;
  return POST(
    new Request("https://t.test/api/auth/codes", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": `203.0.113.${caller}` },
      body: JSON.stringify({ email, for: "signup" }),
    }),
  );
}

function mailsWritten(): string[] {
  const bucket = path.join(data, "mail", ".mail");
  return fs.existsSync(bucket) ? fs.readdirSync(bucket) : [];
}

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-invite-"));
  data = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-invite-data-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = data;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "auth.db")}`;
  process.env.SESSION_SECRET = "b1693-test-secret-b1693-test-secret";
  writeConfig({});
  clearUserCache();
  vi.spyOn(console, "log").mockImplementation(() => {});

  const { migrateToLatest } = await import("@/lib/db/migrate");
  await migrateToLatest(await getDatabase());
});

afterEach(async () => {
  await closeDatabase();
  delete process.env.CONTENT_DIR;
  delete process.env.DATA_DIR;
  delete process.env.DATABASE_URL;
  delete process.env.SESSION_SECRET;
  clearConfigCache();
  clearUserCache();
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
  fs.rmSync(data, { recursive: true, force: true });
});

describe("invite-only signup", () => {
  test("a config that says nothing about signup takes nobody", async () => {
    const response = await ask("stranger@example.test");
    expect(response.status).toBe(403);
    expect((await response.json()).error).toBe("signup_not_invited");
    expect(mailsWritten()).toEqual([]);
  });

  test("a listed address is sent a code, and loses it again when removed", async () => {
    await addInvite("guest@example.test", "operator@example.test");
    expect(await signupAllowed("guest@example.test")).toBe(true);

    const allowed = await ask("guest@example.test");
    expect(allowed.status).toBe(202);
    expect(mailsWritten()).toHaveLength(1);

    await removeInvite("guest@example.test");
    const refused = await ask("guest@example.test");
    expect(refused.status).toBe(403);
    // Still the one mail from the allowed attempt.
    expect(mailsWritten()).toHaveLength(1);
  });

  test("the address is matched however it was typed", async () => {
    await addInvite("  Guest@Example.Test ", null);
    expect(await signupAllowed("guest@example.test")).toBe(true);
    expect(await signupAllowed("GUEST@EXAMPLE.TEST")).toBe(true);
    // Adding the same person again is one entry, not a second to disagree
    // with the first.
    await addInvite("guest@example.test", null);
    expect(await listInvites()).toHaveLength(1);
  });

  test("inviteOnly: false takes anybody, list or no list", async () => {
    writeConfig({ signup: { inviteOnly: false } });
    const response = await ask("anyone@example.test");
    expect(response.status).toBe(202);
    expect(mailsWritten()).toHaveLength(1);
  });

  test("an instance still carrying the old enabled: false is invite-only, not broken", async () => {
    writeConfig({ signup: { enabled: false } });
    await addInvite("guest@example.test", null);
    const listed = await ask("guest@example.test");
    expect(listed.status).toBe(202);
    const stranger = await ask("stranger@example.test");
    expect(stranger.status).toBe(403);
  });
});
