import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/**
 * What each route drags into its bundle.
 *
 * `lib/worldLand.json` is 62 KB of baked coastline. Statically imported by
 * four client components, it landed in the shared chunk every route pulls —
 * so `/costs`, which draws no map at all, downloaded the world.
 *
 * The rule this enforces is the one that fixes it and keeps it fixed: the
 * outline is reachable *only* through a dynamic `import()`. A bundler is then
 * obliged to give it its own chunk, and a route that never renders a map never
 * asks for that chunk. Checking the import graph rather than the built output
 * means this runs in milliseconds and says which file broke it.
 */

const root = path.join(import.meta.dirname, "..");
const LAND = "lib/worldLand.json";

const SOURCE_DIRS = ["app", "components", "lib"];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules") continue;
        walk(full);
      } else if (/\.(ts|tsx|mjs)$/.test(entry.name)) {
        out.push(full);
      }
    }
  };
  walk(path.join(root, dir));
  return out;
}

/** `import x from "…"` / `export … from "…"`, but never `import("…")`. */
const STATIC_IMPORT = /(?:^|[\s;}])(?:import|export)\s[^;]*?from\s*["']([^"']+)["']/g;
/** A bare side-effect import, `import "…";`. */
const SIDE_EFFECT = /(?:^|[\s;}])import\s*["']([^"']+)["']/g;
const DYNAMIC_IMPORT = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

/** Resolves a specifier to a repo-relative path, or null if it leaves the repo. */
function resolve(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = path.join(root, spec.slice(2));
  else if (spec.startsWith(".")) base = path.resolve(path.dirname(from), spec);
  else return null; // a package

  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.mjs`,
    `${base}.json`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return path.relative(root, candidate);
    }
  }
  return null;
}

type Edges = { static: string[]; dynamic: string[] };

function graph(): Map<string, Edges> {
  const map = new Map<string, Edges>();
  for (const dir of SOURCE_DIRS) {
    for (const file of sourceFiles(dir)) {
      const src = fs.readFileSync(file, "utf8");
      const statics = new Set<string>();
      const dynamics = new Set<string>();
      for (const re of [STATIC_IMPORT, SIDE_EFFECT]) {
        re.lastIndex = 0;
        for (const m of src.matchAll(re)) {
          const hit = resolve(file, m[1]);
          if (hit) statics.add(hit);
        }
      }
      DYNAMIC_IMPORT.lastIndex = 0;
      for (const m of src.matchAll(DYNAMIC_IMPORT)) {
        const hit = resolve(file, m[1]);
        if (hit) dynamics.add(hit);
      }
      map.set(path.relative(root, file), {
        static: [...statics],
        dynamic: [...dynamics],
      });
    }
  }
  return map;
}

/** Everything reachable from `entry` without crossing a dynamic import. */
function staticallyReachable(g: Map<string, Edges>, entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const next of g.get(file)?.static ?? []) queue.push(next);
  }
  return seen;
}

describe("route bundles", () => {
  const g = graph();

  it("reaches the world outline only through a dynamic import", () => {
    const statics: string[] = [];
    const dynamics: string[] = [];
    for (const [file, edges] of g) {
      if (edges.static.includes(LAND)) statics.push(file);
      if (edges.dynamic.includes(LAND)) dynamics.push(file);
    }
    // A static import here is what put 62 KB of coastline on every route.
    expect(statics).toEqual([]);
    // And it is still reachable — a typo in the specifier would otherwise
    // pass this test by removing the maps entirely.
    expect(dynamics).toEqual(["components/useWorldLand.ts"]);
  });

  it("does not put map data in the costs page's bundle", () => {
    const reached = staticallyReachable(g, "app/[user]/(trip)/costs/page.tsx");
    expect(reached.size).toBeGreaterThan(5);
    expect([...reached].filter((f) => f === LAND)).toEqual([]);
  });

  it("does not put map data in the story page's bundle either", () => {
    // The hero does draw a map — but after the page is readable, not before.
    const reached = staticallyReachable(g, "app/[user]/(trip)/page.tsx");
    expect(reached).toContain("components/MiniMap.tsx");
    expect([...reached].filter((f) => f === LAND)).toEqual([]);
  });

  it("keeps the photobook's own copy off the client", () => {
    // lib/photobook/worldland.ts reads the same file from disk at render
    // time. That is a server path and must stay out of every page bundle.
    for (const entry of [
      "app/[user]/(trip)/costs/page.tsx",
      "app/[user]/(trip)/page.tsx",
      "app/[user]/(trip)/map/page.tsx",
    ]) {
      expect(staticallyReachable(g, entry)).not.toContain("lib/photobook/worldland.ts");
    }
  });
});
