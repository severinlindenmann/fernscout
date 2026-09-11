import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * B112 — a local script that writes an entry file has to run its frontmatter
 * past the same validator the REST route does (`lib/validate/entry.ts`), or
 * the draft rule and every field check the API enforces have a second,
 * silent door around them.
 *
 * `npm run ingest` is the one script that still writes entries directly
 * (offline by design — see its own header), and it already does this: it
 * imports `validateEntry` in `lib/ingest/index.ts`, and it hardcodes
 * `status: draft` with no flag able to skip it (`lib/ingest/entry.ts`). This
 * test is the guard that keeps that true, in the shape B671 left behind for
 * `lib/gps/store.ts`: an assertion about the import graph, so a future script
 * that writes its own frontmatter without the shared validator fails here
 * rather than being noticed by a person months later.
 *
 * `content/example/` is the one named exception. `scripts/build-demo-content.mjs`
 * writes its frontmatter directly, but it is a fixture — regenerated,
 * committed to git and reviewed there like any other diff, never a real
 * owner's journal — which is the same courtesy the draft rule gives a real
 * owner, just through code review instead of a publish button.
 */
const root = path.join(import.meta.dirname, "..");
const SCRIPTS_DIR = path.join(root, "scripts");
const VALIDATOR = "lib/validate/entry.ts";

const EXEMPT = new Set([
  "build-demo-content.mjs",
  // A measuring stick for scripts/measure-payload.mjs and test/payload.test.ts
  // — writes a synthetic fixture to a directory the caller names, never into
  // a real journal's content root.
  "make-scale-fixture.mjs",
]);

/** A file that builds a path into an `entries/` directory *and* writes bytes
 * to disk — the shape any content-entry writer takes (`<date>-<slug>.md`
 * under a trip's `entries/`). Requiring both in the same file is what tells
 * apart an actual writer (`lib/ingest/index.ts`, `scripts/build-demo-content.mjs`)
 * from a file that merely defines or re-exports the helper
 * (`lib/ingest/paths.ts`) — the latter has no `writeFileSync` of its own. */
const BUILDS_ENTRY_PATH = /entriesDir|entryFileName|"entries"/;
const WRITES_BYTES = /writeFileSync/;

function resolve(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(root, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else return null; // a package

  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.mts`,
    `${base}.mjs`,
    path.join(base, "index.ts"),
  ]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return path.relative(root, candidate);
    }
  }
  return null;
}

const IMPORT = /(?:^|[\s;}])(?:import|export)\s[^;]*?from\s*["']([^"']+)["']/g;

/** Everything a file statically imports, transitively. */
function reachableFrom(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const full = path.join(root, file);
    if (!fs.existsSync(full)) continue;
    const src = fs.readFileSync(full, "utf8");
    IMPORT.lastIndex = 0;
    for (const m of src.matchAll(IMPORT)) {
      const hit = resolve(full, m[1]);
      if (hit && !seen.has(hit)) queue.push(hit);
    }
  }
  return seen;
}

describe("a script that writes an entry file goes through the shared validator", () => {
  const files = fs
    .readdirSync(SCRIPTS_DIR)
    .filter((f) => /\.(mjs|mts|ts)$/.test(f) && !EXEMPT.has(f));

  // Whether the script's own code writes an entries/*.md path, directly or
  // through anything it imports — `scripts/ingest.mts` only reaches it via
  // `lib/ingest/index.ts`, so checking the script's own source is not enough.
  const writesEntries = new Map<string, Set<string>>();
  for (const file of files) {
    const rel = path.join("scripts", file);
    const reached = reachableFrom(rel);
    const hits = [...reached].filter((f) => {
      const contents = fs.readFileSync(path.join(root, f), "utf8");
      return BUILDS_ENTRY_PATH.test(contents) && WRITES_BYTES.test(contents);
    });
    if (hits.length > 0) writesEntries.set(rel, reached);
  }

  for (const [rel, reached] of writesEntries) {
    it(`${rel} reaches ${VALIDATOR} in its import graph`, () => {
      expect(reached).toContain(VALIDATOR);
    });
  }

  it("found at least one script to check (the test is not accidentally empty)", () => {
    expect([...writesEntries.keys()]).toContain("scripts/ingest.mts");
  });
});
