import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { SIGNUP_OWNER, issueCode, verifyCode } from "@/lib/auth";
import { clearConfigCache } from "@/lib/config";
import { closeDatabase, getDatabase } from "@/lib/db";
import { getUser, clearUserCache } from "@/lib/users";
import { handleMcpPost } from "@/lib/mcp/http";
import { clearIdempotencyStore } from "@/lib/mcp/idempotency";

/**
 * B263, the MCP half: `create_journal` must refuse the same silence the REST
 * door does. Before this it took no `visibility` argument at all and
 * defaulted `default_locale` inside `createJournal`, so an agent using MCP
 * rather than REST got a public journal it never asked to be public.
 *
 * B277 extends the same requirement to `locales`, which this tool did not
 * even take as an argument until now — every journal made through MCP got
 * whatever `createJournal` defaulted it to, with no switcher to reach a
 * second language.
 */

let dir: string;

const SITE = "https://example.test";

async function signupToken(email: string): Promise<string> {
  const { code } = await issueCode(SIGNUP_OWNER, email, "signup");
  const result = await verifyCode(SIGNUP_OWNER, email, code, "signup");
  if (!result.ok) throw new Error("could not mint a signup token");
  return result.token;
}

async function callCreateJournal(token: string, args: Record<string, unknown>) {
  const response = await handleMcpPost(
    new Request(`${SITE}/api/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "create_journal", arguments: args },
      }),
    }),
  );
  const body = JSON.parse(await response.text()) as {
    result?: { isError?: boolean; content?: { type: string; text: string }[] };
  };
  const result = body.result;
  const text = result?.content?.map((c) => c.text).join("\n") ?? "";
  return { isError: result?.isError === true, text };
}

const BASE = { username: "wanderer", title: "A journal", owner_name: "Robin", owner_nickname: "Robin" };

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-mcp-create-journal-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATABASE_URL = `sqlite:${path.join(dir, "mcp.db")}`;
  process.env.SESSION_SECRET = "b263-mcp-test-secret";
  delete process.env.NEXT_PUBLIC_SITE_URL;

  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "Fernscout", url: SITE },
      users: { reserved: [] },
      features: { auth: { enabled: true }, signup: { enabled: true } },
    }),
  );
  clearConfigCache();
  clearUserCache();
  clearIdempotencyStore();

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

describe("create_journal over MCP", () => {
  test("refuses a missing visibility", async () => {
    const token = await signupToken("a@example.test");
    const { isError, text } = await callCreateJournal(token, { ...BASE, default_locale: "en" });
    expect(isError).toBe(true);
    expect(text).toMatch(/visibility is required/i);
    expect(getUser("wanderer")).toBeNull();
  });

  test("refuses a missing default_locale", async () => {
    const token = await signupToken("b@example.test");
    const { isError, text } = await callCreateJournal(token, { ...BASE, visibility: "public" });
    expect(isError).toBe(true);
    expect(text).toMatch(/default_locale is required/i);
    expect(getUser("wanderer")).toBeNull();
  });

  test("refuses a default_locale this instance does not maintain", async () => {
    const token = await signupToken("c@example.test");
    const { isError, text } = await callCreateJournal(token, {
      ...BASE,
      visibility: "public",
      default_locale: "Deutsch",
    });
    expect(isError).toBe(true);
    expect(text).toContain("Deutsch");
    expect(getUser("wanderer")).toBeNull();
  });

  test("refuses a missing locales", async () => {
    const token = await signupToken("e@example.test");
    const { isError, text } = await callCreateJournal(token, {
      ...BASE,
      visibility: "public",
      default_locale: "en",
    });
    expect(isError).toBe(true);
    expect(text).toMatch(/locales is required/i);
    expect(getUser("wanderer")).toBeNull();
  });

  test("refuses locales that do not contain default_locale", async () => {
    const token = await signupToken("f@example.test");
    const { isError, text } = await callCreateJournal(token, {
      ...BASE,
      visibility: "public",
      default_locale: "de",
      locales: ["en", "hu"],
    });
    expect(isError).toBe(true);
    expect(text).toMatch(/locales must contain default_locale/i);
    expect(getUser("wanderer")).toBeNull();
  });

  test("creates the journal, private, when all are answered", async () => {
    const token = await signupToken("d@example.test");
    const { isError } = await callCreateJournal(token, {
      ...BASE,
      visibility: "private",
      default_locale: "en",
      locales: ["en"],
    });
    expect(isError).toBe(false);
    expect(getUser("wanderer")?.visibility).toBe("private");
    expect(getUser("wanderer")?.locales).toEqual(["en"]);
  });
});
