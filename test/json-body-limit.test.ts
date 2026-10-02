import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { JSON_BODY_MAX_BYTES, readJsonBody } from "@/lib/api/jsonBody";

/**
 * B2243, B2261 — every JSON door reads its body through `readJson`,
 * `readJsonBody` or `readBoundedJson`, all held to a ceiling. The v2 OpenAPI
 * document promises a 413 on every JSON operation because of this; a route
 * that goes back to a bare `request.json()` would make that promise false.
 *
 * Derived from the tree, not a list: a new route file is covered the moment
 * it exists. Every route root — the app's and the private clone's.
 */
const ROOTS = ["app", "paid"].filter((root) => fs.existsSync(root));

function routeFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : routeFiles(p);
    return entry.name === "route.ts" ? [p] : [];
  });
}

describe("JSON request bodies have a ceiling", () => {
  test("no route parses a body with a bare request.json()", () => {
    const offenders = ROOTS.flatMap(routeFiles)
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

describe("the doors outside v2 answer 413 over the ceiling", () => {
  const big = () =>
    new Request("https://t.test/x", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": String(JSON_BODY_MAX_BYTES + 1) },
      body: "{}",
    });

  test("public doors that read the body before any capability gate", async () => {
    const { POST: push, DELETE: unsubscribe } = await import("@/app/api/push/subscribe/route");
    const { POST: react } = await import("@/app/api/reactions/route");
    for (const handler of [push, unsubscribe, react]) {
      expect((await handler(big())).status).toBe(413);
    }
  });

  test("a chunked import body, which declares no Content-Length, is counted", async () => {
    const { readBoundedJson } = await import("@/lib/api/jsonBody");
    const { REQUEST_MAX_BYTES } = await import("@/lib/validate/media");
    const chunk = new Uint8Array(1024 * 1024).fill(32);
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        if (sent++ > REQUEST_MAX_BYTES / chunk.byteLength + 1) return c.close();
        c.enqueue(chunk);
      },
    });
    const request = new Request("https://t.test/x", { method: "POST", body, duplex: "half" } as RequestInit);
    expect(request.headers.get("content-length")).toBeNull();
    expect(await readBoundedJson(request, REQUEST_MAX_BYTES)).toEqual({ tooLarge: true });
  });
});
