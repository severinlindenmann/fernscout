import { describe, expect, test } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { wabaIdFrom } from "../scripts/whatsapp-subscribe.mts";

/**
 * `scripts/whatsapp-subscribe.mts` — B1180, the `subscribed_apps` POST as a
 * one-shot script rather than a hand-typed `curl`.
 *
 * Never calls Meta: both refusal paths (no token, no WABA id) are provable
 * without a network call, which is also the property that matters most —
 * the token must never reach a log or a printed line, in any path.
 */

const SCRIPT = path.join(process.cwd(), "scripts", "whatsapp-subscribe.mts");

describe("wabaIdFrom", () => {
  test("reads --waba", () => {
    expect(wabaIdFrom(["--waba", "12345"])).toBe("12345");
  });

  test("falls back to a bare positional argument", () => {
    expect(wabaIdFrom(["12345"])).toBe("12345");
  });

  test("null with nothing given", () => {
    expect(wabaIdFrom([])).toBeNull();
  });
});

describe("the script itself", () => {
  test("refuses with no WHATSAPP_ACCESS_TOKEN, and never calls Meta", () => {
    const res = spawnSync("npx", ["tsx", SCRIPT, "--waba", "12345"], {
      encoding: "utf8",
      env: { ...process.env, WHATSAPP_ACCESS_TOKEN: "" },
    });
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/WHATSAPP_ACCESS_TOKEN is not set/);
  });

  test("refuses with no WABA id, and the token never appears in its output", () => {
    const res = spawnSync("npx", ["tsx", SCRIPT], {
      encoding: "utf8",
      env: { ...process.env, WHATSAPP_ACCESS_TOKEN: "a-real-looking-secret-token" },
    });
    expect(res.status).toBe(1);
    expect(res.stderr).toMatch(/No WABA id given/);
    expect(res.stdout).not.toMatch(/a-real-looking-secret-token/);
    expect(res.stderr).not.toMatch(/a-real-looking-secret-token/);
  });
});
