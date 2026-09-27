import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { mapAccent, mapStyle } from "@/lib/map/style";
import { ratio } from "./contrast.test";

/**
 * B2417 (Phase 0, docs/plans/map-redesign.md). `lib/map/style.ts` must never
 * hold a hex — every colour it hands a component is a `var(--map-…)`
 * reference — and every one of those tokens must actually exist, in all
 * three places a theme is declared in app/globals.css, not just the one a
 * component happens to render under during development.
 */

const ROOT = process.cwd();
const CSS_PATH = path.join(ROOT, "app", "globals.css");
const CSS = fs.readFileSync(CSS_PATH, "utf8");
const STYLE_TS = fs.readFileSync(path.join(ROOT, "lib", "map", "style.ts"), "utf8");

/** The text between `selector {` and its own matching `}`, brace-counted so
 * a selector nested inside another rule (the `prefers-color-scheme` mirror)
 * doesn't get cut off at the first unrelated `}`. */
function block(css: string, selector: string): string {
  const start = css.indexOf(selector);
  if (start === -1) throw new Error(`${selector} not found in app/globals.css`);
  const open = css.indexOf("{", start);
  let depth = 1;
  let i = open + 1;
  for (; i < css.length && depth > 0; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}") depth--;
  }
  return css.slice(open + 1, i - 1);
}

const THEME_BLOCKS = {
  light: block(CSS, ":root {"),
  dark: block(CSS, ':root[data-theme="dark"] {'),
  darkMedia: block(CSS, ":root:not([data-theme]) {"),
};

/** Every `--map-…` custom property lib/map/style.ts's `var(--map-…)`
 * references and `mapAccent`'s lookup table name. */
function referencedTokens(source: string): string[] {
  const matches = source.matchAll(/var\((--map-[a-z0-9-]+)\)/g);
  return [...new Set([...matches].map((m) => m[1]))];
}

describe("map tokens (B2417)", () => {
  const tokens = referencedTokens(STYLE_TS);

  test("lib/map/style.ts actually references some --map-* tokens", () => {
    expect(tokens.length).toBeGreaterThan(0);
  });

  test("mapStyle and mapAccent hand back var(--map-…) references", () => {
    for (const value of Object.values(mapStyle)) {
      expect(value).toMatch(/^var\(--map-[a-z0-9-]+\)$/);
    }
    for (const accent of ["sky", "yellow", "green", "coral", "navy"] as const) {
      expect(mapAccent(accent)).toMatch(/^var\(--map-accent-[a-z]+\)$/);
    }
  });

  test.each(tokens)("%s is declared in all three theme blocks", (name) => {
    for (const [theme, css] of Object.entries(THEME_BLOCKS)) {
      expect(css, `${name} missing from the ${theme} block`).toMatch(new RegExp(`${name}:\\s*#[0-9a-fA-F]{6}`));
    }
  });

  test("lib/map/style.ts holds no hex literal", () => {
    expect(STYLE_TS).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });

  test("the light sky and yellow map accent steps clear 3:1 on --map-land", () => {
    const land = THEME_BLOCKS.light.match(/--map-land:\s*(#[0-9a-fA-F]{6})/)?.[1];
    const sky = THEME_BLOCKS.light.match(/--map-accent-sky:\s*(#[0-9a-fA-F]{6})/)?.[1];
    const yellow = THEME_BLOCKS.light.match(/--map-accent-yellow:\s*(#[0-9a-fA-F]{6})/)?.[1];
    if (!land || !sky || !yellow) throw new Error("map-land/map-accent-sky/map-accent-yellow not all declared");
    expect(ratio(sky, land), "sky on land").toBeGreaterThanOrEqual(3);
    expect(ratio(yellow, land), "yellow on land").toBeGreaterThanOrEqual(3);
  });
});
