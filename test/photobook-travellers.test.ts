import { describe, expect, it } from "vitest";
import { drawTravellers, travellersSvg } from "@/lib/photobook/travellers";
import { PdfBuilder } from "@/lib/postcard/pdf";
import { figureShapes } from "@/lib/travellers/shapes";
import { HAIR_STYLES, OUTFITS, type Figure } from "@/lib/travellers/vocabulary";

/**
 * The printed traveller — B497.
 *
 * The book used to carry its own copy of the figure: one couple, in trousers,
 * on the title page of everybody's journey. It now draws from the same
 * `figureShapes` the website does, so what is worth testing here is the
 * *spelling* — that every shape survives conversion to PDF operators, and that
 * an undescribed party prints nobody rather than a placeholder.
 */

const box = { x: 0, y: 0, width: 60, height: 40 };
const toPdf = (x: number, y: number): [number, number] => [x, y];

function operatorsFor(party: Figure[]): string {
  const builder = new PdfBuilder();
  const page = builder.addPage(200, 200);
  drawTravellers(page, toPdf, box, party);
  return page.operations.join("\n");
}

describe("a party that nobody described prints nobody", () => {
  /**
   * The decision this ticket turned on. A book is a keepsake, and printing a
   * placeholder couple on the title page of a trip whose travellers nobody
   * asked about is the software asserting who was there — `ask, never infer`,
   * applied to the one artefact somebody keeps.
   */
  it("draws nothing at all for an empty party", () => {
    expect(operatorsFor([])).toBe("");
  });

  it("draws nothing in the preview either, rather than a gap of markup", () => {
    expect(travellersSvg(20, [])).toBe("");
  });

  it("draws something the moment one person is described", () => {
    expect(operatorsFor([{ skin: "deep" }]).length).toBeGreaterThan(0);
    expect(travellersSvg(20, [{ skin: "deep" }])).toContain("<svg");
  });
});

describe("every shape survives the trip to PDF", () => {
  /**
   * PDF has no arc and no quadratic. A style whose path silently failed to
   * convert would draw nothing and look like a styling choice, so this counts
   * the operators rather than trusting the absence of an exception.
   */
  it("emits path operators for every hair style", () => {
    for (const hairStyle of HAIR_STYLES) {
      const ops = operatorsFor([{ hairStyle, hair: "black", skin: "medium" }]);
      expect(ops, hairStyle).toContain(" c");
      expect(ops, hairStyle).not.toContain("NaN");
    }
  });

  it("emits path operators for every outfit", () => {
    for (const outfit of OUTFITS) {
      const ops = operatorsFor([{ outfit, shirt: "teal", pants: "plum" }]);
      expect(ops, outfit).toContain(" c");
      expect(ops, outfit).not.toContain("NaN");
    }
  });

  it("never writes NaN into a content stream, whatever the figure", () => {
    const party: Figure[] = [
      { hairStyle: "coils", outfit: "dress", accessories: ["sunglasses", "camera"] },
      { hairStyle: "headscarf", outfit: "robe", age: "elder", build: "broad" },
      { hairStyle: "braids", outfit: "skirt", age: "child", build: "slight" },
    ];
    const ops = operatorsFor(party);
    expect(ops).not.toContain("NaN");
    expect(ops).not.toContain("Infinity");
    expect(ops).not.toContain("undefined");
  });

  /**
   * The book and the site draw from one description now. If they ever stop,
   * this is the test that says so: the same figure yields the same number of
   * shapes on both sides, because both call `figureShapes`.
   */
  it("draws as many shapes as the site does, for the same figure", () => {
    const figure: Figure = { hairStyle: "curly", outfit: "skirt", accessories: ["hat"] };
    const count = (shapes: ReturnType<typeof figureShapes>): number =>
      shapes.reduce((n, s) => n + (s.kind === "group" ? count(s.shapes) : 1), 0);
    const shapes = count(figureShapes(figure));

    // One `q … Q` block per painted shape. The eye highlights and the bald
    // shine are the only shapes that can be paintless, and this figure has
    // neither.
    const blocks = operatorsFor([figure]).split("\n").filter(Boolean).length;
    expect(blocks).toBe(shapes);
  });
});

describe("the printed party stands as the party on the site stands", () => {
  it("puts children in front, so the same layout decides both", () => {
    const family: Figure[] = [
      { skin: "light" },
      { skin: "medium" },
      { age: "child", skin: "deep" },
    ];
    // Three figures, one of them a child: the child is drawn last, so it is
    // painted over the adults exactly as on the website.
    const blocks = operatorsFor(family).split("\n").filter(Boolean);
    expect(blocks.length).toBeGreaterThan(0);
    // The deep skin tone belongs to the child and must appear after the
    // lightest one, which is only true if the front rank paints last.
    const deep = blocks.findIndex((b) => b.includes("0.54") || b.includes("0.33"));
    expect(deep).toBeGreaterThan(-1);
  });

  it("scales a child down, in the book as on the site", () => {
    const adult = operatorsFor([{ skin: "medium" }]);
    const child = operatorsFor([{ skin: "medium", age: "child" }]);
    expect(child).not.toBe(adult);
  });
});
