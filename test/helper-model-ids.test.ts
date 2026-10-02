import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * One place for an assistant model id — B2686.
 *
 * `lib/helper/models.ts` is the one module allowed to name
 * `claude-haiku-*`/`claude-sonnet-*`/`claude-opus-*`; every other call site
 * asks it for the id a job should use. A literal model id anywhere else in
 * `lib/` or `app/` is exactly the thing B2686 exists to catch — it is
 * either a forgotten call site from before this module existed, or a new one
 * that was not pointed at it. Derived by walking the real source tree rather
 * than a hand-kept list, which is stale the moment a file moves —
 * `test/depersonalised.test.ts` makes the same call for the same reason.
 */

const ROOT = process.cwd();
const SCAN_DIRS = ["lib", "app"];

/** The one file allowed to say a model id by name, plus the pricing table
 *  (which has to key its rows by the same ids — B2686's own acceptance note)
 *  and the two places that name one in an illustrative comment rather than
 *  a value a call actually sends. */
const EXEMPT = new Set([
  path.join("lib", "helper", "models.ts"),
  path.join("site", "config.json"),
  path.join("lib", "db", "schema.ts"),
  path.join("lib", "db", "migrations", "023-usage.ts"),
]);

const MODEL_ID_PATTERN = /claude-(?:haiku|sonnet|opus)-\d/;

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mts|mjs|js)$/.test(entry.name)) out.push(full);
  }
  return out;
}

describe("assistant model ids live in one module", () => {
  test("no literal claude-* model id outside lib/helper/models.ts", () => {
    const hits: string[] = [];
    for (const dir of SCAN_DIRS) {
      for (const file of walk(path.join(ROOT, dir))) {
        const rel = path.relative(ROOT, file);
        if (EXEMPT.has(rel)) continue;
        const text = fs.readFileSync(file, "utf8");
        if (MODEL_ID_PATTERN.test(text)) hits.push(rel);
      }
    }
    expect(hits, `move these model ids behind lib/helper/models.ts:\n${hits.join("\n")}`).toEqual([]);
  });

  test("site/config.json prices every model lib/helper/models.ts defaults to", () => {
    const configText = fs.readFileSync(path.join(ROOT, "site", "config.json"), "utf8");
    const config = JSON.parse(configText) as { costs?: { models?: Record<string, unknown> } };
    const priced = new Set(Object.keys(config.costs?.models ?? {}));
    const modelsSource = fs.readFileSync(path.join(ROOT, "lib", "helper", "models.ts"), "utf8");
    const defaults = Array.from(modelsSource.matchAll(/:\s*"(claude-[a-z0-9-]+)"/g), (m) => m[1]);
    expect(defaults.length).toBeGreaterThan(0);
    for (const id of defaults) {
      expect(priced.has(id), `${id} has no price in site/config.json's costs.models`).toBe(true);
    }
  });
});
