import { describe, expect, test } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { compile } from "@tailwindcss/node";
import { Scanner } from "@tailwindcss/oxide";
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
// palette names, where an undefined shade does not vanish (like navy at
// shade 300 did) but silently resolves to Tailwind's *stock* hex instead,
// fixed in both themes because it was never one of this app's tokens to
// begin with. Yellow at 50 and 900, red at 700, and a border in yellow at
// 500 all compiled and looked plausible on cream, and never flipped in dark
// mode. Named in words rather than as literal class tokens on purpose —
// B1840 found Tailwind's own content scanner reading this very sentence as
// markup and shipping the classes it names. Checked against `--color-*`
// names directly (not `palette()`, which
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

/**
 * B1840 — the check from the other end, which is the one that actually
 * matters: source is only a proxy for what ships. The checks above ask "does
 * a `className` in `app`/`components` name a shade we defined", which says
 * nothing about a class name typed in a comment, a task file, or anywhere
 * else Tailwind's own automatic content detection used to read as markup —
 * exactly how `.border-yellow-500` and `.text-red-700` (Tailwind's own stock
 * colours, unthemed and not dark-mode aware) reached the shipped bundle
 * despite never appearing in a real `className`.
 *
 * This compiles `app/globals.css` for real, through the same
 * `@tailwindcss/node` + `@tailwindcss/oxide` pipeline `@tailwindcss/postcss`
 * uses during the actual Next build (`compile` → resolve `@source` entries →
 * `Scanner.scan()` → `build(candidates)`), and asserts the *output* CSS
 * never emits a utility for a shade on `sky`, `yellow`, `green`, `blue` or
 * `red` that `app/globals.css` does not itself define. `source(none)` plus
 * the explicit `@source "../app"`/`@source "../components"` lines just above
 * this file in `globals.css` are what make that true — this test would have
 * caught B1840 directly, and catches any future directory that starts
 * carrying a stray class-shaped string the same way.
 */
describe("the compiled bundle names no shade the theme never defined — B1840", () => {
  test("app/globals.css only ever scans app/ and components/", () => {
    expect(CSS).toMatch(/@import\s+"tailwindcss"\s+source\(none\)/);
    expect(CSS).toMatch(/@source\s+"\.\.\/app"/);
    expect(CSS).toMatch(/@source\s+"\.\.\/components"/);
  });

  test("no ambiguous-hue utility in the shipped CSS names an undefined shade", async () => {
    const cssPath = path.join(ROOT, "app", "globals.css");
    const base = path.dirname(cssPath);
    const compiled = await compile(CSS, { base, onDependency: () => {} });
    const sources = (
      compiled.root === "none"
        ? []
        : compiled.root === null
          ? [{ base: ROOT, pattern: "**/*", negated: false }]
          : [{ ...compiled.root, negated: false }]
    ).concat(compiled.sources);
    const scanner = new Scanner({ sources });
    const outputCss = compiled.build(scanner.scan());

    const definedAnywhere = new Set(
      [...CSS.matchAll(/--color-([a-z]+-\d+):/g)].map(([, token]) => token),
    );
    const shipped = new Set(
      [...outputCss.matchAll(new RegExp(`\\.(?:${UTILITIES})-([a-z]+-\\d+)\\b`, "g"))].map(
        ([, token]) => token,
      ),
    );

    const undefinedShipped = [...shipped]
      .filter((token) => {
        const hue = token.split("-").slice(0, -1).join("-");
        return AMBIGUOUS_HUES.has(hue) && !definedAnywhere.has(token);
      })
      .sort();

    expect(undefinedShipped).toEqual([]);
  }, 20_000);
});
