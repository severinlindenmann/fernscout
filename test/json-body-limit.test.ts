import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { JSON_BODY_MAX_BYTES, readJsonBody } from "@/lib/api/jsonBody";

/**
 * B2243 — every JSON door under `/api/v2/**` and `/api/helper/**` reads its
 * body through `readJson` or `readJsonBody`, both held to
 * `JSON_BODY_MAX_BYTES`. The v2 OpenAPI document promises a 413 on every
 * JSON operation because of this; a route that goes back to a bare
 * `request.json()` would make that promise false.
 *
 * Derived from the tree, not a list: a new route file is covered the moment
 * it exists.
 */
const ROOTS = ["app/api/v2", "app/api/helper"];

/** Not JSON-bounded on purpose, each with its own limit. */
const OWN_LIMIT: Record<string, string> = {
  "app/api/v2/[user]/import/route.ts":
    "a years-long export arrives as JSON text; bounded by REQUEST_MAX_BYTES on Content-Length instead",
};

function routeFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) return routeFiles(p);
    return entry.name === "route.ts" ? [p] : [];
  });
}

describe("JSON request bodies have a ceiling", () => {
  test("no v2 or helper route parses a body with a bare request.json()", () => {
    const offenders = ROOTS.flatMap(routeFiles)
      .filter((file) => !(file in OWN_LIMIT))
      .filter((file) => /\b(request|req)\.json\(\)/.test(fs.readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });

  test("readJsonBody answers 413 over the ceiling and null for a body that is not JSON", async () => {
    const big = await readJsonBody(
      new Request("https://t.test/x", { method: "POST", body: JSON.stringify({ a: "x".repeat(JSON_BODY_MAX_BYTES) }) }),
    );
    if (big.ok) throw new Error("expected a refusal");
    expect(big.response.status).toBe(413);
    expect(await big.response.json()).toMatchObject({ error: "body_too_large", details: { maxBytes: JSON_BODY_MAX_BYTES } });

    const junk = await readJsonBody(new Request("https://t.test/x", { method: "POST", body: "{nope" }));
    expect(junk).toEqual({ ok: true, value: null });

    const fine = await readJsonBody(new Request("https://t.test/x", { method: "POST", body: '{"a":1}' }));
    expect(fine).toEqual({ ok: true, value: { a: 1 } });
  });

  test("a declared Content-Length over the ceiling is refused before a byte is read", async () => {
    const request = new Request("https://t.test/x", {
      method: "POST",
      headers: { "content-length": String(JSON_BODY_MAX_BYTES + 1) },
      body: "{}",
    });
    const result = await readJsonBody(request);
    expect(result.ok).toBe(false);
    expect(request.bodyUsed).toBe(false);
  });
});
