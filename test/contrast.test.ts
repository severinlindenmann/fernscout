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

  test("navy-900 on coral-400 carries the upload retry button (B1862)", () => {
    // UploadStep's own retry button used to fill with coral-600, the hue
    // B1798 chose to be *text* on a dark surface — reading fine in light
    // mode by accident (5.22:1) and all but disappearing in dark mode
    // (2.23:1), because coral-600 gets a whole different hex there.
    // coral-400 and navy-900 neither one gets a `:root[data-theme="dark"]`
    // override (unlike coral-600/green-700 below), so this pairing is the
    // one ratio, not a light-mode number that quietly changes underneath.
    const darkBlock = CSS.match(/:root\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    expect(darkBlock).not.toMatch(/--color-coral-400:/);
    expect(darkBlock).not.toMatch(/--color-navy-900:/);
    expect(at(token("navy-900"), token("coral-400"))).toBeGreaterThanOrEqual(4.5);
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

  test("the light badge fills these two hues sit on clear 4.5:1 too (B1841)", () => {
    // OrderDocket, RecordButton's role="alert", CheckWording,
    // AccountPageContent, extract's DayBoard/PhotoTile/AskCard/UploadStep and
    // LandingSections all pair text-green-700 with bg-green-100, or
    // text-coral-600 with bg-coral-100, in light mode. Both fills failed
    // (4.30:1 and 4.26:1) before this test was written — the same trap
    // B1798 closed in dark mode, one theme earlier.
    expect(at(token("green-700"), token("green-100"))).toBeGreaterThanOrEqual(4.5);
    expect(at(token("coral-600"), token("coral-100"))).toBeGreaterThanOrEqual(4.5);
  });
});

describe("the dark theme's own text hues clear the floor (B1798)", () => {
  /** `--color-<token>` as declared under `:root[data-theme="dark"]`, not the
   *  light value `token()` above finds first. */
  function darkToken(name: string): string {
    const block = CSS.match(/:root\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    const match = block.match(new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`));
    if (!match) throw new Error(`--color-${name} has no dark override in app/globals.css`);
    return match[1];
  }

  /** The dark theme's own surface roles, read the same way `screenPalette`
   *  does — the grounds `green-700` and `coral-600` text is actually set on. */
  const DARK_GROUNDS = ["surface-base", "surface-raised", "surface-subtle", "surface-neutral", "surface-neutral-strong"];
  function darkSurface(role: string): string {
    const block = CSS.match(/:root\[data-theme="dark"\]\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
    const match = block.match(new RegExp(`--${role}:\\s*(#[0-9a-fA-F]{6})`));
    if (!match) throw new Error(`--${role} has no dark value in app/globals.css`);
    return match[1];
  }

  test("green-700 and coral-600 both got a dark override", () => {
    expect(darkToken("green-700")).not.toBe(token("green-700"));
    expect(darkToken("coral-600")).not.toBe(token("coral-600"));
  });

  test("both clear 4.5:1 against every surface role text sits on in dark mode", () => {
    for (const name of ["green-700", "coral-600"]) {
      const fg = darkToken(name);
      for (const role of DARK_GROUNDS) {
        expect(at(fg, darkSurface(role)), `${name} on ${role}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  test("the light fills these two hues sit on in a badge flip too, and still clear 4.5:1", () => {
    // ApproveButton, PaymentCheckout, TripHero, admin/page.tsx and
    // AccountPageContent all pair `text-green-700` with `bg-green-100`;
    // OrderDocket and admin/page.tsx pair `text-coral-600` with
    // `bg-coral-50`/`bg-coral-100`. Left literal, these fills stay pale in
    // dark mode and the brighter dark text above would fail against them
    // (1.95:1 measured for green-100 before this test was written) —
    // exactly the trap one layer further in.
    expect(at(darkToken("green-700"), darkToken("green-100"))).toBeGreaterThanOrEqual(4.5);
    expect(at(darkToken("coral-600"), darkToken("coral-50"))).toBeGreaterThanOrEqual(4.5);
    expect(at(darkToken("coral-600"), darkToken("coral-100"))).toBeGreaterThanOrEqual(4.5);
  });

  test("the dark overrides are mirrored in the prefers-color-scheme fallback block", () => {
    // `:root[data-theme="dark"]` is the explicit toggle; the auto/system
    // choice goes through `@media (prefers-color-scheme: dark) { :root:not([data-theme]) {} }`
    // instead, and nothing keeps the two in sync but a person remembering to.
    const media = CSS.match(
      /@media \(prefers-color-scheme: dark\)[\s\S]*?:root:not\(\[data-theme\]\)\s*\{([\s\S]*?)\n {2}\}/,
    )?.[1];
    if (!media) throw new Error("prefers-color-scheme dark block not found");
    for (const name of ["green-700", "coral-600", "green-100", "coral-50", "coral-100"]) {
      const explicit = darkToken(name);
      const auto = media.match(new RegExp(`--color-${name}:\\s*(#[0-9a-fA-F]{6})`))?.[1];
      expect(auto, `--color-${name} in the auto-dark block`).toBe(explicit);
    }
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
    for (const dir of ["app", "components", ...(fs.existsSync(path.join(process.cwd(), "paid")) ? ["paid"] : [])]) {
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

describe("no role ink under 7:1 carries small text (B2063)", () => {
  /**
   * The FILL_ONLY scan above knows brand-hue names; the role tokens alias
   * them (`--ink-faint` is navy-400's #8490a2) and walked straight past it.
   * The weak inks are computed, not listed: every `--ink-*` role whose light
   * value is under 7:1 on cream-50, the page ground.
   */
  const rootBlock = CSS.match(/:root\s*\{([\s\S]*?)\n\}/)?.[1] ?? "";
  const WEAK_INKS = [...rootBlock.matchAll(/--(ink-[\w-]+):\s*(#[0-9a-fA-F]{6})/g)]
    .filter(([, , hex]) => ratio(hex, GROUNDS["cream-50"]) < 7)
    .map(([, name]) => name);

  /** Under 16px: text-xs (12), text-sm (14), text-[10px]..text-[15px]. */
  const SMALL = /(^|[\s:"'`{])text-(xs|sm|\[1[0-5]px\])(?![\w-])/;
  const WEAK = new RegExp(`(^|[\\s:"'\`{])text-(${WEAK_INKS.join("|")})(?![\\w-])`);

  /**
   * Existing small weak-ink text outside the studio, counted per file so an
   * edit elsewhere in the file does not move a line number out from under
   * it, and a new offender in a listed file still fails. Every entry is
   * B2097 ("small text below 7:1 outside the studio"), which carries the
   * file:line snapshot; each count may only go down.
   */
  const ALLOWED: Record<string, number> = {
    "paid/photobook/routes/[user]/(trip)/photobook/BookOrderPanel.tsx": 1,
    "paid/photobook/routes/[user]/(trip)/photobook/BookSettingsPanel.tsx": 2,
    "paid/photobook/routes/[user]/(trip)/photobook/DayStopControls.tsx": 8,
    "paid/photobook/routes/[user]/(trip)/photobook/GuidedPass.tsx": 3,
    "paid/photobook/routes/[user]/(trip)/photobook/LeftOutSheet.tsx": 2,
    "paid/photobook/routes/[user]/(trip)/photobook/PhotobookPageContent.tsx": 1,
    "paid/photobook/routes/[user]/(trip)/photobook/stopControls.tsx": 5,
    "app/[user]/account/AccountPageContent.tsx": 1,
    "app/[user]/me/MePageContent.tsx": 1,
    "paid/postcard/routes/[user]/postcards/[id]/PostcardBack.tsx": 2,
    "paid/postcard/routes/[user]/postcards/[id]/PostcardSteps.tsx": 1,
    "paid/postcard/routes/[user]/postcards/[id]/page.tsx": 1,
    "app/admin/Charts.tsx": 7,
    "app/admin/Invites.tsx": 2,
    "app/admin/Journals.tsx": 3,
    "app/admin/SpendChart.tsx": 2,
    "app/admin/page.tsx": 26,
    "app/docs/api/page.tsx": 6,
    "app/docs/branding/identity/page.tsx": 2,
    "app/docs/branding/page.tsx": 1,
    "components/AddressLookupField.tsx": 1,
    "components/ContactForm.tsx": 1,
    "components/ContactManage.tsx": 1,
    "components/EditDay.tsx": 1,
    "components/HelperConsentList.tsx": 2,
    "components/LandingSections.tsx": 1,
    "components/PushInstallOnboarding.tsx": 1,
    "components/PushOptIn.tsx": 2,
    "components/PushPrompt.tsx": 1,
    "components/SearchBox.tsx": 1,
    "components/StoryPager.tsx": 3,
    "components/TripMap.tsx": 2,
    "components/branding/AnimationWorkbench.tsx": 1,
    "paid/photobook/components/branding/DayBench.tsx": 1,
    "paid/printOrder/components/branding/OrderBench.tsx": 1,
    "paid/photobook/components/branding/PhotobookBench.tsx": 7,
    "paid/postcard/components/branding/PostcardBench.tsx": 3,
    "components/extract/CheckWording.tsx": 1,
    "components/extract/ResumeScreen.tsx": 1,
    "paid/printOrder/components/order/OrderDocket.tsx": 1,
  };

  function sources(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) return sources(full);
      return e.isFile() && full.endsWith(".tsx") ? [full] : [];
    });
  }

  function offenders(): Map<string, number[]> {
    const found = new Map<string, number[]>();
    for (const dir of ["app", "components", ...(fs.existsSync(path.join(process.cwd(), "paid")) ? ["paid"] : [])]) {
      for (const file of sources(path.join(process.cwd(), dir))) {
        const rel = path.relative(process.cwd(), file);
        const text = fs.readFileSync(file, "utf8");
        // Line by line: a className sits on one line in this codebase, and a
        // conditional ink (`text-xs ${blocked ? "text-ink-faint" : …}`) is
        // still that element's colour. Comment lines are prose, not classes.
        text.split("\n").forEach((l, i) => {
          if (/^\s*(\/\/|\*|\/\*)/.test(l)) return;
          if (SMALL.test(l) && WEAK.test(l)) found.set(rel, [...(found.get(rel) ?? []), i + 1]);
        });
      }
    }
    return found;
  }

  test("the weak inks are found from globals.css, and ink-faint is one", () => {
    expect(WEAK_INKS).toContain("ink-faint");
    expect(WEAK_INKS).not.toContain("ink-secondary");
    expect(WEAK_INKS).not.toContain("ink-strong");
  });

  test("the scan catches text-xs text-ink-faint", () => {
    const cls = "text-xs font-semibold uppercase text-ink-faint";
    expect(SMALL.test(cls) && WEAK.test(cls)).toBe(true);
    expect(WEAK.test("text-xs text-ink-secondary")).toBe(false);
  });

  test("small text never uses a weak ink beyond the counted allow-list", () => {
    const over: string[] = [];
    for (const [file, lines] of offenders()) {
      if (lines.length > (ALLOWED[file] ?? 0)) over.push(`${file}:${lines.join(",")}`);
    }
    expect(over).toEqual([]);
  });

  test("the allow-list holds nothing already fixed, and nothing in the studio", () => {
    const found = offenders();
    for (const [file, count] of Object.entries(ALLOWED)) {
      if (file.startsWith("paid/") && !fs.existsSync(path.join(process.cwd(), "paid"))) continue;
      expect(file, "the studio is fixed, not allowed").not.toMatch(/^(components\/studio\/|app\/\[user\]\/studio\/)/);
      expect(found.get(file)?.length ?? 0, `${file}: lower its count`).toBe(count);
    }
  });
});
