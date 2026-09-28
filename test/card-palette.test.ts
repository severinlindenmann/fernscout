import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { CARD_DARK, CARD_LIGHT } from "@/lib/map/cardPalette";

/**
 * B2538 — `lib/map/cardPalette.ts` copies concrete hex out of
 * `app/globals.css` (the same reason, and the same risk of drift,
 * `lib/map/printPalette.ts` already has its own version of this test for).
 * Catches a value that changed in one file and not the other.
 */

const CSS = fs.readFileSync(path.join(process.cwd(), "app", "globals.css"), "utf8");

function block(selector: string): string {
  const start = CSS.indexOf(selector);
  if (start === -1) throw new Error(`${selector} not found in app/globals.css`);
  const open = CSS.indexOf("{", start);
  let depth = 1;
  let i = open + 1;
  for (; i < CSS.length && depth > 0; i++) {
    if (CSS[i] === "{") depth++;
    else if (CSS[i] === "}") depth--;
  }
  return CSS.slice(open + 1, i - 1);
}

const LIGHT_BLOCK = block(":root {");
const DARK_BLOCK = block(':root[data-theme="dark"] {');

/** `--map-…` token name → `CardPalette` key. */
const TOKENS: Record<string, keyof typeof CARD_LIGHT> = {
  "--map-land": "land",
  "--map-sea": "sea",
  "--map-water": "water",
  "--map-border": "border",
  "--map-visited": "visited",
  "--map-road": "road",
  "--map-road-casing": "roadCasing",
  "--map-selected-fill": "selectedFill",
  "--map-cluster-fill": "clusterFill",
  "--map-planned-leg": "plannedLeg",
  "--map-leg-chip-fill": "legChipFill",
  "--map-leg-chip-border": "legChipBorder",
  "--map-leg-chip-icon": "legChipIcon",
  "--map-label-town": "labelTown",
  "--map-label-stop-halo": "labelStopHalo",
  "--map-accent-navy": "accentNavy",
};

function valueOf(cssBlock: string, token: string): string {
  const m = cssBlock.match(new RegExp(`${token}:\\s*([^;]+);`));
  if (!m) throw new Error(`${token} not found in the given block`);
  return m[1].trim();
}

describe("cardPalette matches app/globals.css", () => {
  test.each(Object.entries(TOKENS))("%s", (token, key) => {
    expect(CARD_LIGHT[key]).toBe(valueOf(LIGHT_BLOCK, token));
    expect(CARD_DARK[key]).toBe(valueOf(DARK_BLOCK, token));
  });
});
