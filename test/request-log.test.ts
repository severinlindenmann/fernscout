import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { NextRequest } from "next/server";
import { GET as health } from "@/app/api/health/route";
import { clearConfigCache } from "@/lib/config";
import { formatRequestLine } from "@/lib/requestLog";
import { clearUserCache } from "@/lib/users";
import { config as proxyConfig, default as proxy } from "@/proxy";

/**
 * B257 — a request log line, off by default, and what it does and does not
 * carry. See `lib/requestLog.ts` for why status, duration and response size
 * are not among the fields below: proxy runs before a request completes, so
 * none of the three exist yet at the point this line is written.
 */

describe("formatRequestLine", () => {
  test("carries method, path and user agent", () => {
    expect(formatRequestLine("GET", "/agent.md", "AgentFetch/1.0")).toBe(
      '[request] GET /agent.md ua="AgentFetch/1.0"',
    );
  });

  test("a missing user agent reads as -, not blank", () => {
    expect(formatRequestLine("GET", "/agent.md", null)).toBe('[request] GET /agent.md ua="-"');
  });

  test("a crafted user agent cannot forge a second log line", () => {
    const line = formatRequestLine("GET", "/x", 'evil\n[request] GET /admin ua="nice"');
    expect(line.split("\n")).toHaveLength(1);
  });
});

let dir: string;

/** Same shape as test/capabilities.test.ts's writeConfig. */
function writeConfig(loggingEnabled: boolean) {
  fs.writeFileSync(
    path.join(dir, "config.json"),
    JSON.stringify({
      site: { name: "F", url: "https://example.test" },
      users: { reserved: [] },
      features: { logging: { enabled: loggingEnabled } },
    }),
  );
  clearConfigCache();
}

function get(url: string, userAgent?: string) {
  return new NextRequest(new URL(url, "https://example.test"), {
    headers: userAgent ? { "user-agent": userAgent } : undefined,
  });
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "fernscout-reqlog-"));
  process.env.CONTENT_DIR = dir;
  clearConfigCache();
});

afterEach(() => {
  delete process.env.CONTENT_DIR;
  clearConfigCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("proxy request logging", () => {
  test("logs nothing when the capability is off — the default", () => {
    writeConfig(false);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    proxy(get("/agent.md", "AgentFetch/1.0"));
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });

  test("logs nothing when the config has never mentioned it either", () => {
    fs.writeFileSync(
      path.join(dir, "config.json"),
      JSON.stringify({ site: { name: "F", url: "https://example.test" }, users: { reserved: [] } }),
    );
    clearConfigCache();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    proxy(get("/agent.md"));
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });

  test("one line, with the documented fields, once it is on", () => {
    writeConfig(true);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    proxy(get("/agent.md", "AgentFetch/1.0"));
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith('[request] GET /agent.md ua="AgentFetch/1.0"');
    log.mockRestore();
  });

  test("never logs the query string, only the path", () => {
    writeConfig(true);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    proxy(get("/example?token=secret-value"));
    expect(String(log.mock.calls[0]?.[0])).not.toContain("secret-value");
    expect(String(log.mock.calls[0]?.[0])).not.toContain("?");
    log.mockRestore();
  });

  test("logs an API request, and does not run the tombstone check against it", () => {
    writeConfig(true);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const response = proxy(get("/api/v1/alice/trips"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("/api/v1/alice/trips"));
    // `x-middleware-next` is Next's own signal for "let this one through" —
    // a 410 (the tombstone page) would not carry it.
    expect(response.headers.get("x-middleware-next")).toBe("1");
    log.mockRestore();
  });

  test("logs the instance's own root-level agent documents", () => {
    writeConfig(true);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    proxy(get("/documentation.txt"));
    expect(log).toHaveBeenCalledWith(expect.stringContaining("/documentation.txt"));
    log.mockRestore();
  });

  test("still excludes build assets from the matcher, capability on or off", () => {
    // config.matcher is compile-time, not something a unit test invoking
    // proxy() directly can exercise — asserted instead by reading the
    // pattern here, so a future edit that widens it has to change this too.
    const general = String(proxyConfig.matcher[0]);
    expect(general).toContain("_next/static");
    expect(general).toContain("_next/image");
    expect(general).toContain("favicon.ico");
  });
});

describe("/api/health and logging", () => {
  test("never reports logging as a per-journal narrowing", async () => {
    writeConfig(true); // server-level on
    fs.mkdirSync(path.join(dir, "alice"), { recursive: true });
    fs.writeFileSync(
      path.join(dir, "alice", "config.json"),
      JSON.stringify({
        title: "Alice",
        owner: { name: "Alice", nickname: "A", email: "alice@example.test" },
        defaultLocale: "en",
        locales: ["en"],
        baseCurrency: "CHF",
        // Alice's own config never mentions `logging` — the point of B257's
        // "no per-journal switch" is that this must never read as a "no".
      }),
    );
    clearUserCache();

    // As the operator: since B473 an unentitled caller has no `journals` block
    // to inspect, and the claim here is about what that block does not contain.
    process.env.HEALTH_TOKEN = "s3cret-health-token-logging";
    try {
      const response = await health(
        new Request("https://example.test/api/health", {
          headers: { authorization: "Bearer s3cret-health-token-logging" },
        }),
      );
      const body = await response.json();

      expect(body.capabilities.logging).toEqual({ enabled: true });
      expect(body.journals.alice?.logging).toBeUndefined();
    } finally {
      delete process.env.HEALTH_TOKEN;
    }
  });
});
