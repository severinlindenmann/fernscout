import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { NextRequest } from "next/server";
import { default as proxy } from "@/proxy";
import { GUEST_COOKIE, IDENTITY_COOKIE } from "@/lib/auth";
import { clearConfigCache } from "@/lib/config";

/**
 * B-2779 — a request carrying no session cookie for any studio address is
 * rewritten to one parameterless sign-in page, so a journal that exists and
 * one that does not answer the same (B1829). Anyone carrying a cookie reaches
 * the studio's own gates, so a signed-in non-owner still gets the 404.
 */
let dir: string;
function setup(auth: boolean) {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({ site: { name: "T", url: "https://t.test" }, features: { auth: { enabled: auth } } }),
  );
  clearConfigCache();
}
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-studio-signin-"));
  process.env.CONTENT_DIR = dir;
  process.env.DATA_DIR = dir;
  setup(true);
});
afterEach(() => {
  delete process.env.CONTENT_DIR;
  delete process.env.DATA_DIR;
  clearConfigCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

function rewrite(url: string, init?: { cookie?: string; method?: string }): string | null {
  const request = new NextRequest(new URL(url, "https://t.test"), {
    method: init?.method,
    headers: init?.cookie ? { cookie: init.cookie } : undefined,
  });
  const target = proxy(request).headers.get("x-middleware-rewrite");
  return target ? new URL(target).pathname : null;
}

describe("studio addresses, signed out", () => {
  test("a real and a non-existent journal rewrite to the same page, at any depth", () => {
    for (const rest of ["/studio", "/studio/day/new", "/studio/readers"]) {
      expect(rewrite(`/@example${rest}`)).toBe("/studio-signin");
      expect(rewrite(`/@nobody-here${rest}`)).toBe("/studio-signin");
    }
  });

  test("the rewrite target takes no parameters, so the page cannot name a journal", () => {
    const page = fs.readFileSync(path.join(process.cwd(), "app/studio-signin/page.tsx"), "utf8");
    expect(page).not.toMatch(/params|searchParams|getUser/);
  });

  test("a cookie of either kind reaches the studio's own gates", () => {
    expect(rewrite("/@example/studio", { cookie: `${IDENTITY_COOKIE}=x` })).toBe("/at/example/studio");
    expect(rewrite("/@example/studio", { cookie: `${GUEST_COOKIE}=x` })).toBe("/at/example/studio");
  });

  test("other journal pages, other methods and a disabled sign-in are left alone", () => {
    expect(rewrite("/@example/trips")).toBe("/at/example/trips");
    expect(rewrite("/@example/studio", { method: "POST" })).toBe("/at/example/studio");
    setup(false);
    expect(rewrite("/@example/studio")).toBe("/at/example/studio");
  });

  test("the cookie names match lib/auth", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "proxy.ts"), "utf8");
    expect(src).toContain(`IDENTITY_COOKIE_NAME = "${IDENTITY_COOKIE}"`);
    expect(src).toContain(`GUEST_COOKIE_NAME = "${GUEST_COOKIE}"`);
  });
});
