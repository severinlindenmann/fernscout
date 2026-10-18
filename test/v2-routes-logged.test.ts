import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

function walk(dir: string, match: (f: string) => boolean, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, match, out);
    else if (match(p)) out.push(p);
  }
  return out;
}

describe("every v2 and studio route is logged (B-2952, B-3008)", () => {
  const isRoute = (f: string) => f.endsWith("/route.ts");
  // The studio saves through /api/helper and /api/web, and a day's photos through its own page route.
  const files = [
    ...walk("app/api/v2", isRoute),
    ...walk("app/api/helper", isRoute),
    ...walk("app/api/web", isRoute),
    ...walk("app/at", (f) => isRoute(f) && f.includes("/day/[slug]/photos/")),
  ];

  it("finds the routes", () => {
    expect(files.length).toBeGreaterThan(150);
    expect(files.some((f) => f.endsWith("/day/[slug]/photos/route.ts"))).toBe(true);
  });

  it.each(files)("%s wraps every exported HTTP method in withV2Log", (file) => {
    const src = readFileSync(file, "utf8");
    const exported = new Set<string>();
    for (const m of src.matchAll(/^export (?:async )?function (\w+)/gm)) exported.add(m[1]);
    for (const m of src.matchAll(/^export const (\w+)/gm)) exported.add(m[1]);
    for (const m of src.matchAll(/^export \{([^}]*)\}/gm)) m[1].split(",").forEach((n) => exported.add(n.trim()));
    const methods = [...exported].filter((n) => METHODS.includes(n));
    expect(methods.length).toBeGreaterThan(0);
    for (const method of methods) {
      expect(src, `${method} in ${file}`).toMatch(new RegExp(`^export const ${method} = withV2Log\\(`, "m"));
    }
  });

  it("has no unwrapped server action module (none exist today)", () => {
    const actions = [...walk("app", (f) => /\.tsx?$/.test(f)), ...walk("lib", (f) => /\.tsx?$/.test(f))].filter((f) =>
      /^\s*["']use server["']/m.test(readFileSync(f, "utf8").slice(0, 400)),
    );
    expect(actions).toEqual([]);
  });
});
