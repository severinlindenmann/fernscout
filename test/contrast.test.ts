import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

/**
 * The contrast audit, as arithmetic rather than as a memory.
 *
 * The palette failed in eight places at once because one token, `navy-500`,
 * carried 11px metadata, 12px body, icon strokes and disabled states across
 * three different grounds — and nothing in the repository could tell anyone
 * that. This file is what tells them. It reads the real hex values out of
 * `app/globals.css`, so editing a token to something prettier fails here
 * rather than in front of a reader.
 *
 * The bar is the audience's, not the specification's. Readers are past sixty,
 * on a phone, often outdoors:
 *
 *   - text under 16px          AAA, 7:1   (AA's 4.5 is a number that passes
 *                                          and a line that does not get read)
 *   - text at 16px and above   AA,  4.5:1
 *   - meaningful non-text      3:1        (icons, focus rings, underlines)
 */

const CSS = fs.readFileSync(path.join(process.cwd(), "app", "globals.css"), "utf8");

/** The tokens as declared, so this tests the shipped palette and not a copy. */
function token(name: string): string {
  const match = CSS.match(new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!match) throw new Error(`--color-${name} is not declared in app/globals.css`);
  return match[1];
}

function channels(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** WCAG 2.x relative luminance. */
function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Rounded the way the numbers are reported, so a failure message is
 * comparable to the audit table. */
const at = (a: string, b: string) => Number(ratio(a, b).toFixed(2));

/** Every surface text is set on. cream-200 and navy-200 are fills rather than
 * page grounds, but small labels do land on both. */
const GROUNDS = {
  white: "#ffffff",
  "cream-50": token("cream-50"),
  "cream-100": token("cream-100"),
} as const;

describe("the navy ramp is split by job", () => {
  test("navy-600 clears AAA on every ground text is set on", () => {
    const fg = token("navy-600");
    for (const [name, bg] of Object.entries(GROUNDS)) {
      expect(at(fg, bg), `navy-600 on ${name}`).toBeGreaterThanOrEqual(7);
    }
  });

  test("navy-700 and navy-900 clear AAA too, so the hierarchy is all readable", () => {
    for (const name of ["navy-700", "navy-900"]) {
      for (const [ground, bg] of Object.entries(GROUNDS)) {
        expect(at(token(name), bg), `${name} on ${ground}`).toBeGreaterThanOrEqual(7);
      }
    }
  });

  test("navy-600 stays visibly lighter than navy-700, or the step is pointless", () => {
    expect(luminance(token("navy-600"))).toBeGreaterThan(luminance(token("navy-700")));
    expect(luminance(token("navy-600"))).toBeLessThan(luminance(token("navy-500")));
  });

  test("navy-500 is a borders-and-icons token: 3:1 yes, but never AAA", () => {
    const fg = token("navy-500");
    for (const [name, bg] of Object.entries(GROUNDS)) {
      expect(at(fg, bg), `navy-500 on ${name}`).toBeGreaterThanOrEqual(4.5);
    }
    // The guard rail. If navy-500 ever clears 7:1 somebody has darkened it,
    // and the split this file exists to protect has quietly collapsed.
    expect(at(fg, GROUNDS["cream-100"])).toBeLessThan(7);
  });
});

describe("accents are fills, not words", () => {
  test("the light accents fail as text, which is why they are not used as text", () => {
    // Documented rather than merely assumed: these numbers are the reason
    // links are dark with a coloured underline instead of coloured text.
    for (const name of ["sky-500", "sky-400", "yellow-400", "coral-400", "green-500"]) {
      expect(at(token(name), GROUNDS["cream-50"]), `${name} on cream-50`).toBeLessThan(4.5);
    }
  });

  test("blue-500 clears 3:1 everywhere it is drawn as a ring or an underline", () => {
    const fg = token("blue-500");
    const surfaces = {
      ...GROUNDS,
      "cream-200": token("cream-200"),
      "navy-900": token("navy-900"),
      "yellow-400": token("yellow-400"),
    };
    for (const [name, bg] of Object.entries(surfaces)) {
      expect(at(fg, bg), `blue-500 focus ring on ${name}`).toBeGreaterThanOrEqual(3);
    }
  });

  test("yellow-950 on yellow-400 carries the primary button", () => {
    expect(at(token("yellow-950"), token("yellow-400"))).toBeGreaterThanOrEqual(7);
  });

  test("yellow-600 is a border, not an icon colour", () => {
    // 2.46:1 on white. It used to draw the selected tick in the language and
    // currency menus, where it needed 3:1 and did not have it.
    expect(at(token("yellow-600"), "#ffffff")).toBeLessThan(3);
  });

  test("coral-600 and green-700 carry 16px text and no smaller", () => {
    for (const name of ["coral-600", "green-700"]) {
      const value = at(token(name), GROUNDS["cream-100"]);
      expect(value, `${name} on cream-100`).toBeGreaterThanOrEqual(4.5);
      expect(value, `${name} on cream-100`).toBeLessThan(7);
    }
  });

  test("the dark text on a coral badge clears AAA, since badges are small", () => {
    expect(at(token("navy-900"), token("coral-300"))).toBeGreaterThanOrEqual(7);
  });
});

describe("no light accent is used as a text colour", () => {
  const FILL_ONLY = [
    "sky-300",
    "sky-400",
    "sky-500",
    "yellow-300",
    "yellow-400",
    "yellow-600",
    "green-500",
    "coral-300",
    "coral-400",
    "navy-200",
  ];

  /** The slideshow draws on a blacked-out backdrop, where the whole
   * relationship inverts and a light accent is the readable choice. */
  const DARK_GROUND = ["components/SlideShow.tsx"];

  function sources(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) return sources(full);
      return e.isFile() && full.endsWith(".tsx") ? [full] : [];
    });
  }

  test("every text-<accent> outside the slideshow is gone", () => {
    const offenders: string[] = [];
    for (const dir of ["app", "components"]) {
      for (const file of sources(path.join(process.cwd(), dir))) {
        const rel = path.relative(process.cwd(), file);
        if (DARK_GROUND.includes(rel)) continue;
        const text = fs.readFileSync(file, "utf8");
        for (const token of FILL_ONLY) {
          // `text-` only, and only as a whole class: `border-yellow-600` and
          // `decoration-sky-500` are the correct uses of these tokens.
          if (new RegExp(`(^|[\\s"'\`:])text-${token}(?![\\w-])`).test(text)) {
            offenders.push(`${rel}: text-${token}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
