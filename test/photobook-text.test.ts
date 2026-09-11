import { describe, expect, test } from "vitest";
import { advanceWidths, wrap } from "@/lib/photobook/text.ts";

/**
 * B1408. `wrap()` used to run the whole paragraph through `toWinAnsi` before
 * splitting it into lines, so what it returned was already WinAnsi-encoded —
 * a literal C1 control byte for marks like the en dash. `plan.ts` stores
 * exactly what `wrap()` returns, and `preview.ts` HTML-escapes it with no
 * decode, so a browser rendered that byte as nothing: a blank gap where a
 * dash belonged, and the words either side of it wrapped as if it were
 * missing.
 */
describe("wrap", () => {
  const PUNCTUATION = "– — … ‘ ’ “ ” •";

  test("typographic punctuation survives the round trip as real characters", () => {
    const lines = wrap(PUNCTUATION, 10, 1000);
    const text = lines.join(" ");
    for (const ch of ["–", "—", "…", "‘", "’", "“", "”", "•"]) {
      expect(text).toContain(ch);
    }
    // Never the WinAnsi-encoded byte a pre-split would have left behind.
    expect(text).not.toMatch(/[-]/);
  });

  test("a real en dash keeps the sentence spacing it had, unwrapped at this width", () => {
    const sentence =
      "Windig, und am Abend kalt und windig – gegessen wurde trotzdem glücklich.";
    const lines = wrap(sentence, 10, 5000);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe(sentence);
  });

});

/**
 * The eight WinAnsi marks that had no `EXTRA` width and fell through to the
 * `"n"` fallback — B1408. A real width means the layout `wrap()` computes and
 * the `/Widths` array the PDF declares agree, which is what `advanceWidths`
 * exists to guarantee.
 */
describe("advanceWidths", () => {
  // The advance Helvetica gives the base letter each mark is built on — an
  // accent adds no width in this face, which is the rule `base()` already
  // relies on for the accented Latin-1 letters (see its own doc comment).
  const EXPECTED: Record<string, { code: number; regular: number; bold: number }> = {
    florin: { code: 0x83, regular: 556, bold: 556 },
    circumflex: { code: 0x88, regular: 333, bold: 333 },
    Scaron: { code: 0x8a, regular: 667, bold: 667 }, // width of "S"
    Zcaron: { code: 0x8e, regular: 611, bold: 611 }, // width of "Z"
    tilde: { code: 0x98, regular: 333, bold: 333 },
    scaron: { code: 0x9a, regular: 500, bold: 556 }, // width of "s"
    zcaron: { code: 0x9e, regular: 500, bold: 500 }, // width of "z"
    Ydieresis: { code: 0x9f, regular: 667, bold: 667 }, // width of "Y"
  };

  test.each(Object.entries(EXPECTED))("%s (0x%s) has its real advance width, not a fallback", (_name, spec) => {
    const regular = advanceWidths("regular");
    const bold = advanceWidths("bold");
    // advanceWidths starts at code 32 (space).
    const index = spec.code - 32;
    expect(regular[index]).toBe(spec.regular);
    expect(bold[index]).toBe(spec.bold);
  });
});
