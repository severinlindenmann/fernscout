import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * The chat room at `/agent` is gone — B2173. The address answers the site's
 * ordinary not-found page, and nothing may link back into it.
 *
 * Allowed: `/agent.md` (a 301 to /documentation.txt) and `/<user>/studio/agent`
 * (Permissions & keys). Comments may still mention the room's history; only a
 * quoted string or an href counts as a link.
 */

const ROOT = process.cwd();

function files(dir: string): string[] {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) return files(rel);
    return /\.(tsx?|json)$/.test(entry.name) ? [rel] : [];
  });
}

/** The source with block comments and whole-line `//` comments taken out. */
function code(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("the /agent room stays removed", () => {
  test("app/agent holds nothing but the agent.md redirect", () => {
    expect(fs.existsSync(path.join(ROOT, "app/agent"))).toBe(false);
    expect(fs.existsSync(path.join(ROOT, "app/agent.md/route.ts"))).toBe(true);
  });

  test("no href or string points at /agent", () => {
    // `"/agent"`, `"/agent/…"`, `"/agent?…"`, `href="/agent…"`, or a template
    // literal starting there — but not `/agent.md` and not `/studio/agent`.
    const link = /(?:href=["'{`]*|["'`])\/agent(?![.\w-])/g;
    const found = ["app", "components", "lib", "site/locales"].flatMap(files).flatMap((file) =>
      [...code(fs.readFileSync(path.join(ROOT, file), "utf8")).matchAll(link)].map(
        (match) => `${file}: ${match[0]}`,
      ),
    );
    expect(found).toEqual([]);
  });

  test("the name stays reserved, so no journal can take the address", () => {
    expect(fs.readFileSync(path.join(ROOT, "lib/users.ts"), "utf8")).toMatch(/ALWAYS_RESERVED[\s\S]*?"agent",/);
  });
});
