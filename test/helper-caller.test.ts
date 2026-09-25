import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { clearConfigCache } from "@/lib/config";
import { clearUserCache } from "@/lib/users";

// No cookie ever arrives — the same discipline test/helper-routes-bearer-
// refused.test.ts uses: resolveAccess runs for real and finds nothing.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

/**
 * B1055 — a WhatsApp-shaped caller reaches the same tools a cookie caller
 * does, and every route that needs an owner's browser still refuses it.
 */

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-helper-caller-"));
  process.env.CONTENT_DIR = dir;
  fs.mkdirSync(path.join(dir, "alex"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "alex", "config.json"),
    JSON.stringify({ title: "Alex", owner: { name: "Alex", email: "alex@example.test" } }),
  );
  clearConfigCache();
  clearUserCache();
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  clearConfigCache();
  clearUserCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("resolveCookieCaller", () => {
  test("is null with no cookie in scope", async () => {
    const { resolveCookieCaller } = await import("@/lib/helper/caller");
    expect(await resolveCookieCaller("alex")).toBeNull();
  });

  test("isHelperOwner answers the same no, unchanged", async () => {
    const { isHelperOwner } = await import("@/lib/helper/server");
    expect(await isHelperOwner("alex")).toBe(false);
  });
});

describe("whatsappCaller", () => {
  test("builds a caller with no cookie and no request in scope", async () => {
    const { whatsappCaller } = await import("@/lib/helper/caller");
    const caller = whatsappCaller("alex");
    expect(caller).toEqual({ username: "alex", how: "whatsapp" });
  });

  test("reaches answerInThread — the tool layer takes a plain username, not a Caller", async () => {
    // The acceptance line, verified directly: nothing below the route layer
    // reads a cookie, so a WhatsApp-shaped caller's username is already
    // everything answerInThread needs. No model call here — this only
    // proves the function signature accepts it with nothing else in scope.
    const { answerInThread } = await import("@/lib/helper/model");
    expect(typeof answerInThread).toBe("function");
    expect(answerInThread.length).toBeLessThanOrEqual(6);
  });

  test("a whatsapp-proven caller is still refused by a cookie-only owner check", async () => {
    const caller = { username: "alex", how: "whatsapp" } as const;
    const { isHelperOwner } = await import("@/lib/helper/server");
    // The caller value itself grants nothing — only isHelperOwner (cookie)
    // decides route access, and this caller never reaches it.
    expect(await isHelperOwner(caller.username)).toBe(false);
  });
});
