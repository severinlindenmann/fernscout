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
 * B757 scoped this to the `-300` shade only, on the theory that a single
 * suffix was the whole bug. B1035 found `navy-800` — a different shade,
 * same shape, 27 files — which is exactly what a suffix-scoped guard
 * cannot catch: it survives until the next shade someone reaches for. This
 * now checks every shade suffix, on `navy`, `cream` and `coral` — the hues
 * in this palette with no Tailwind default of the same name, so an
 * undefined shade on one of them is unambiguously this bug (renders as
 * nothing). `sky`, `yellow`, `green` and `blue` are also Tailwind's own
 * default palette names, so an undefined shade there can silently resolve
 * to Tailwind's *stock* colour instead — a real, differently-shaped gap
 * (design consistency, not "renders as nothing"), captured separately
 * rather than asserted here.
 */

const CODE_DIRS = ["app", "components"];
const ROOT = process.cwd();
const CSS = fs.readFileSync(path.join(ROOT, "app", "globals.css"), "utf8");
const UTILITIES =
  "bg|border|text|decoration|ring|outline|divide|from|via|to|fill|stroke|accent|caret|shadow|placeholder";
const UNAMBIGUOUS_HUES = new Set(["navy", "cream", "coral"]);
// B1810: the ambiguous hues left uncovered above — Tailwind's own default
// palette names, where an undefined shade does not vanish (like `navy-300`
// did) but silently resolves to Tailwind's *stock* hex instead, fixed in
// both themes because it was never one of this app's tokens to begin with.
// `bg-yellow-50`, `text-yellow-900`, `border-yellow-500`, `text-red-700`
// all compiled and looked plausible on cream, and never flipped in dark
// mode. Checked against `--color-*` names directly (not `palette()`, which
// is scoped to the light `:root` block only) because a shade defined solely
// under a dark block would still need catching here.
const AMBIGUOUS_HUES = new Set(["sky", "yellow", "green", "blue", "red"]);

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

describe("every colour class on an unambiguous hue names a defined token", () => {
  const definedTokens = new Set(palette().map((s) => s.token));
  const pattern = new RegExp(`\\b(?:${UTILITIES})-([a-z]+)-(\\d+)\\b`, "g");

  test("finds files to check", () => {
    const files = CODE_DIRS.flatMap((d) => walk(path.join(ROOT, d)));
    expect(files.length).toBeGreaterThan(20);
  });

  test("no undefined shade is used on navy, cream or coral", () => {
    const files = CODE_DIRS.flatMap((d) => walk(path.join(ROOT, d)));
    const missing = new Set<string>();

    for (const file of files) {
      const text = fs.readFileSync(file, "utf8");
      for (const [, hue, shade] of text.matchAll(pattern)) {
        if (!UNAMBIGUOUS_HUES.has(hue)) continue;
        const token = `${hue}-${shade}`;
        if (!definedTokens.has(token)) missing.add(`${token} (${path.relative(ROOT, file)})`);
      }
    }

    expect([...missing].sort()).toEqual([]);
  });

  test("no undefined shade is used on sky, yellow, green, blue or red", () => {
    // Any block, light or dark — a shade this app never defines anywhere is
    // still the bug, whichever `:root` it would have needed to appear in.
    const definedAnywhere = new Set(
      [...CSS.matchAll(/--color-([a-z]+-\d+):/g)].map(([, token]) => token),
    );
    const files = CODE_DIRS.flatMap((d) => walk(path.join(ROOT, d)));
    const missing = new Set<string>();

    for (const file of files) {
      const text = fs.readFileSync(file, "utf8");
      for (const [, hue, shade] of text.matchAll(pattern)) {
        if (!AMBIGUOUS_HUES.has(hue)) continue;
        const token = `${hue}-${shade}`;
        if (!definedAnywhere.has(token)) missing.add(`${token} (${path.relative(ROOT, file)})`);
      }
    }

    expect([...missing].sort()).toEqual([]);
  });

  test("every semantic screen role used by a utility is exported to Tailwind", () => {
    const defined = new Set(
      [...CSS.matchAll(/--color-((?:surface|ink|line|action|on-|overlay|shadow)[a-z-]*):/g)].map(
        ([, token]) => token,
      ),
    );
    const pattern = new RegExp(
      `\\b(?:${UTILITIES})-((?:surface|ink|line|action|on-|overlay|shadow)[a-z-]*)(?:/\\d+)?\\b`,
      "g",
    );
    const missing = new Set<string>();
    for (const file of CODE_DIRS.flatMap((d) => walk(path.join(ROOT, d)))) {
      const source = fs.readFileSync(file, "utf8");
      for (const [, token] of source.matchAll(pattern)) {
        if (!defined.has(token)) missing.add(`${token} (${path.relative(ROOT, file)})`);
      }
    }
    expect([...missing].sort()).toEqual([]);
  });
});
