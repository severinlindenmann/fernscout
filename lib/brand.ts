/**
 * The brand, read off the files that define it.
 *
 * Everything here derives; nothing here asserts. The palette is whatever
 * `app/globals.css` currently says, the contrast ratios are computed from
 * those hexes, and the verdict beside each one falls out of the number rather
 * than being typed next to it.
 *
 * That is the whole point of the module (B575). The hexes used to be written
 * out again in `docs/branding/BRAND.md`, and the ratios a third time in
 * `.claude/skills/apply-the-brand/SKILL.md` — three copies of a measured
 * number, which is three chances for the copy somebody reads to be the one
 * nobody updated. `/docs/branding/identity` renders this instead.
 */

import { readRepoFile, section } from "./docs";

export type Swatch = { token: string; hex: string };

/**
 * Every `--color-*` token in `app/globals.css`, in file order.
 *
 * File order matters: the ramps are written light-to-dark within a hue and
 * grouped by hue, which is the order a person wants to look at them in and is
 * not recoverable from the names alone (`navy-900` before `navy-200`).
 *
 * Only the `:root` definitions are wanted, not the `@theme` block that
 * re-exports each token to Tailwind as `var(--color-…)` — hence the hex
 * literal in the pattern rather than any value at all.
 */
export function palette(css = readRepoFile("app/globals.css")): Swatch[] {
  return [...css.matchAll(/--color-([a-z]+-\d+):\s*(#[0-9a-fA-F]{6})/g)].map(([, token, hex]) => ({
    token,
    hex: hex.toLowerCase(),
  }));
}

/** WCAG 2.x relative luminance of a `#rrggbb`. */
function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio between two `#rrggbb`, 1–21, order-independent. */
export function contrast(a: string, b: string): number {
  const [dark, light] = [luminance(a), luminance(b)].sort((x, y) => x - y);
  return (light + 0.05) / (dark + 0.05);
}

/**
 * What a ratio permits, as a word.
 *
 * The floors are WCAG 2.2's: 7:1 is AAA for body-size text, 4.5:1 is AA, 3:1
 * is AA for large text (18.66px bold or 24px) and for the non-text things a
 * focus ring is. Below that a colour may be a fill and nothing else.
 *
 * Readers here are past sixty, on a phone, often outdoors — the note in
 * `globals.css` explains why the small type is held to AAA rather than AA —
 * so "AA" on this page is a pass, not a recommendation.
 */
export function verdict(ratio: number): "AAA" | "AA" | "large text only" | "fill only" {
  if (ratio >= 7) return "AAA";
  if (ratio >= 4.5) return "AA";
  if (ratio >= 3) return "large text only";
  return "fill only";
}

/**
 * The grounds text is ever set on here, which is what makes a contrast table
 * finite. White is a card, `cream-50` is the page, `cream-100` is a well or an
 * inset; `navy-900` is the inverse surface and `yellow-400` is the brand
 * button. Anything else is decoration and does not carry words.
 */
export const GROUNDS = ["cream-50", "cream-100", "navy-900", "yellow-400"] as const;

/**
 * The lockups, read out of `BRAND.md` §3's own table.
 *
 * Parsed rather than listed, for the reason the whole module exists: a second
 * list is a list that will disagree. Adding a variant to the manual puts it on
 * the bench with no code change, and the `.svg` filter is what keeps the
 * derived PNG out — it is not a source and the page says so elsewhere.
 */
export function lockups(brand = readRepoFile("docs/branding/BRAND.md")): {
  file: string;
  slot: string;
}[] {
  return [...section(brand, "3. Lockups").matchAll(/^\|\s*`([\w-]+\.svg)`\s*\|\s*(.+?)\s*\|$/gm)].map(
    // The slot is rendered as plain text beside the drawing, so the table's
    // own code-span backticks come off here rather than as a second markdown pass.
    ([, file, slot]) => ({ file, slot: slot.replace(/`/g, "") }),
  );
}

/** One lockup's markup, straight out of `docs/branding/`. Repo-owned files —
 * the same trust as any other component in the checkout. */
export function lockup(file: string): string {
  return readRepoFile(`docs/branding/${file}`);
}
