import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { clientIp } from "@/lib/rateLimit";

/**
 * The address every rate limit on this server is keyed by.
 *
 * **Be honest about what can be tested here.** `clientIp` reads a header; it
 * cannot know whether the value was written by a proxy or by the client. The
 * property that actually makes it safe lives in `deploy/Caddyfile`, and a unit
 * test cannot exercise Caddy.
 *
 * So this file does two separate things: it pins what the function does with
 * the header it is handed, and it asserts that the Caddyfile still carries the
 * line the function depends on. The second is the one that would catch a
 * regression — somebody tidying that config away would otherwise reopen B01
 * with every test still green.
 */

describe("clientIp", () => {
  const ipOf = (headers: Record<string, string>) =>
    clientIp(new Request("https://example.test/", { headers }));

  test("takes the first value of X-Forwarded-For", () => {
    // Safe *because* the proxy overwrites the header — see the Caddyfile
    // assertion below. On its own this line is the bug, not the fix.
    expect(ipOf({ "x-forwarded-for": "203.0.113.9" })).toBe("203.0.113.9");
    expect(ipOf({ "x-forwarded-for": "203.0.113.9, 10.0.0.1" })).toBe("203.0.113.9");
  });

  test("trims whitespace, which a proxy chain leaves behind", () => {
    expect(ipOf({ "x-forwarded-for": "  203.0.113.9 , 10.0.0.1" })).toBe("203.0.113.9");
  });

  test("falls back to X-Real-IP, then to a constant", () => {
    expect(ipOf({ "x-real-ip": "198.51.100.7" })).toBe("198.51.100.7");
    // Every un-proxied caller shares one bucket. That is deliberate: the
    // alternative is no limit at all for anything reaching the port directly.
    expect(ipOf({})).toBe("unknown");
  });

  test("X-Forwarded-For wins over X-Real-IP", () => {
    expect(ipOf({ "x-forwarded-for": "203.0.113.9", "x-real-ip": "198.51.100.7" })).toBe(
      "203.0.113.9",
    );
  });
});

describe("the half of B01 that lives in the proxy", () => {
  // Since B66 the site block is its own file — the one an operator `import`s
  // rather than copies, so that a proxy change reaches a machine that already
  // serves another site. deploy/Caddyfile is now the global options block and
  // that import, and the directive being asserted here is not in it.
  const snippet = () =>
    fs.readFileSync(path.join(process.cwd(), "deploy", "fernscout.caddy"), "utf8");

  /**
   * Caddy *appends* the real address to an incoming `X-Forwarded-For` unless
   * told otherwise. With `clientIp` reading the first value, that meant a
   * client could name its own address and reset every limit keyed on it —
   * including the eight guesses in front of a trip's password.
   */
  test("the shipped site block overwrites X-Forwarded-For rather than appending", () => {
    expect(snippet()).toMatch(/header_up\s+X-Forwarded-For\s+\{remote_host\}/);
  });

  test("and it is inside the reverse_proxy block, where it takes effect", () => {
    const block = /reverse_proxy[^\n]*\{([\s\S]*?)\n\t\}/.exec(snippet());
    expect(block, "reverse_proxy should be a block, not a one-liner").not.toBeNull();
    expect(block![1]).toMatch(/header_up\s+X-Forwarded-For/);
  });

  test("and deploy/Caddyfile still delivers it, by importing that file", () => {
    // The greenfield path — `cp deploy/Caddyfile /etc/caddy/Caddyfile` — has to
    // keep working, and it now works by reference. A Caddyfile that lost the
    // import would serve a site with no site block at all, so this is not a
    // stylistic assertion.
    expect(fs.readFileSync(path.join(process.cwd(), "deploy", "Caddyfile"), "utf8")).toMatch(
      /^import\s+\S*deploy\/fernscout\.caddy$/m,
    );
  });

  // Whether the *running* proxy has any of this is a different question, and
  // the one B01 actually got wrong: the line was committed, deployed, and had
  // no effect for a day because nothing installed the file. That check is
  // test/check-caddy.test.ts and `npm run check:caddy` (B66).
});
