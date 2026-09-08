import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { palette } from "@/lib/brand";

/**
 * B757: `border-navy-300` was used across the app for years with no
 * `--color-navy-300` behind it. Tailwind cannot generate a colour for an
 * undefined token, so the class set `border-style`/`border-width` and
 * nothing else — the border silently fell back to `currentColor`, and
 * nothing failed, because a missing colour is not a syntax error.
 *
 * Scoped to the `-300` shade specifically, on this palette's own hues —
 * matching B757's acceptance line rather than auditing every shade of
 * every hue. Several hues here (`sky`, `yellow`, `green`, `blue`) are also
 * Tailwind's own default palette names, so an undefined shade on one of
 * those can silently resolve to Tailwind's *stock* colour instead of
 * failing loudly (a design-consistency problem, not this bug's "renders as
 * nothing" shape) — auditing every shade of those would flag pre-existing,
 * differently-shaped issues this ticket did not touch. `navy`, `cream` and
 * `coral` have no Tailwind default to fall back to, so for them an
 * undefined shade is unambiguously this bug.
 */

const CODE_DIRS = ["app", "components"];
const ROOT = process.cwd();
const UTILITIES =
  "bg|border|text|decoration|ring|outline|divide|from|via|to|fill|stroke|accent|caret|shadow|placeholder";

function walk(dir: string): string[] {
  const out: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      out.push(...walk(full));
    } else if (/\.(tsx|ts)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe("every -300 colour class names a defined token", () => {
  const paletteHues = new Set(palette().map((s) => s.token.split("-")[0]));
  const definedTokens = new Set(palette().map((s) => s.token));
  const pattern = new RegExp(`\\b(?:${UTILITIES})-([a-z]+)-300\\b`, "g");

  test("finds files to check", () => {
    const files = CODE_DIRS.flatMap((d) => walk(path.join(ROOT, d)));
    expect(files.length).toBeGreaterThan(20);
  });

  test("no undefined -300 shade is used on one of this palette's hues", () => {
    const files = CODE_DIRS.flatMap((d) => walk(path.join(ROOT, d)));
    const missing = new Set<string>();

    for (const file of files) {
      const text = fs.readFileSync(file, "utf8");
      for (const [, hue] of text.matchAll(pattern)) {
        if (!paletteHues.has(hue)) continue; // not one of this palette's hues at all
        const token = `${hue}-300`;
        if (!definedTokens.has(token)) missing.add(`${token} (${path.relative(ROOT, file)})`);
      }
    }

    expect([...missing].sort()).toEqual([]);
  });
});
