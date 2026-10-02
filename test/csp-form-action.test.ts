// @scans app/**/*.ts app/**/*.tsx paid/**/*.ts paid/**/*.tsx lib/**/*.ts lib/**/*.tsx components/**/*.ts components/**/*.tsx next.config.ts
import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import nextConfig from "@/next.config";

/**
 * B2656 — the photobook "Order the book" form posted and 303-redirected
 * straight to checkout.stripe.com; `form-action 'self'` (next.config.ts)
 * then (correctly) blocked it and WebKit cancelled the navigation. The fix
 * was to stop posting cross-origin at all: the route now answers a relative
 * `Location`, and the client does a fetch + `window.location.href`
 * navigation, which `form-action` does not govern. So today there is
 * nothing to allow — this derives the set of external origins the app's own
 * markup and routes actually target (a literal `<form action="https://…">`,
 * or a literal external `Location:` on a redirect response) and fails if
 * `form-action` does not cover one, so a *future* regression — a new form
 * or redirect reintroducing a cross-origin post — is caught here instead of
 * in the Simulator.
 */

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next" || entry.name.startsWith(".claude")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (/\.(tsx?|mts)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function externalOrigins(): Set<string> {
  const origins = new Set<string>();
  for (const root of ["app", "paid", "lib", "components"].filter((d) => fs.existsSync(d))) {
    for (const file of walk(root)) {
      const text = fs.readFileSync(file, "utf8");
      for (const m of text.matchAll(/<form[^>]*\baction=["'](https?:\/\/[^"'/]+)/g)) {
        origins.add(new URL(m[1]).origin);
      }
      for (const m of text.matchAll(/Location:\s*["'`](https?:\/\/[^"'`/]+)/g)) {
        origins.add(new URL(m[1]).origin);
      }
    }
  }
  return origins;
}

describe("the CSP's form-action covers every external redirect target in source", () => {
  test("no off-origin <form action> or redirect Location is missing from form-action", async () => {
    const headers = nextConfig.headers;
    expect(headers, "next.config.ts must declare a headers() block").toBeTypeOf("function");
    const rules = (await headers!()) as { source: string; headers: { key: string; value: string }[] }[];
    let csp: string | undefined;
    for (const rule of rules) {
      if (!rule.source.includes(":path*") || rule.source.includes("media")) continue;
      for (const header of rule.headers) {
        if (header.key.toLowerCase() === "content-security-policy") csp = header.value;
      }
    }
    expect(csp, "no baseline Content-Security-Policy header found").toBeDefined();
    const formAction = /form-action ([^;]+)/.exec(csp ?? "")?.[1] ?? "";
    expect(formAction, "no form-action directive in the CSP").not.toBe("");

    const found = [...externalOrigins()];
    const missing = found.filter((origin) => !formAction.includes(origin));
    expect(missing, `CSP form-action does not cover: ${missing.join(", ")} — allow it there, or stop posting a form to it`).toEqual([]);
  });
});
