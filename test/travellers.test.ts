import { describe, expect, it } from "vitest";
import { arrangeParty, frontRank, stepFraction, tightestHeadGap, MIN_STEP } from "@/lib/travellers/layout";
import { parseTravellers, partyFor } from "@/lib/travellers/parse";
import { PRESET_NAMES, STARTING_POINTS, resolvePreset } from "@/lib/travellers/presets";
import { renderFigure } from "@/lib/travellers/render";
import { HAIR_STYLES, MAX_FIGURES, OUTFITS, type Figure } from "@/lib/travellers/vocabulary";

const adult = (): Figure => ({ skin: "medium", hair: "black", hairStyle: "short" });
const child = (): Figure => ({ ...adult(), age: "child" });

describe("the party is a composition, not a row", () => {
  /**
   * The acceptance criterion for the overlap, and the reason it is a test
   * rather than a look: bodies may cross, heads may not. The number comes out
   * of the drawing — a head is a circle of r=16 in a 64-wide viewBox, so it
   * spans half a figure — and the failure it guards against is somebody
   * tightening the spacing by eye until one traveller stands squarely in
   * front of another.
   */
  it("never draws one head over another, at any size up to the ceiling", () => {
    for (let n = 2; n <= MAX_FIGURES; n++) {
      const adults = Array.from({ length: n }, adult);
      expect(tightestHeadGap(adults), `${n} adults`).toBeGreaterThan(0);

      // And with children in it, which is the case that puts a smaller figure
      // in front of a larger one.
      const family = adults.map((f, i) => (i % 3 === 2 ? { ...f, age: "child" as const } : f));
      expect(tightestHeadGap(family), `${n} with children`).toBeGreaterThan(0);
    }
  });

  it("closes the gap as the party grows, and never below the floor", () => {
    expect(stepFraction(2)).toBeGreaterThan(stepFraction(5));
    for (let n = 1; n <= 40; n++) {
      expect(stepFraction(n)).toBeGreaterThanOrEqual(MIN_STEP);
    }
  });

  it("puts children and teenagers in front, at any party size", () => {
    // Two parents and two children: four figures, the young ones in front.
    const family = [adult(), adult(), child(), child()];
    expect(frontRank(family)).toEqual([false, false, true, true]);

    // Even at three, where adults alone would stay in a single row.
    expect(frontRank([adult(), child(), adult()])).toEqual([false, true, false]);
  });

  it("keeps one to three adults in a single row, and alternates from four", () => {
    expect(frontRank([adult(), adult()])).toEqual([false, false]);
    expect(frontRank([adult(), adult(), adult()])).toEqual([false, false, false]);
    expect(frontRank(Array.from({ length: 5 }, adult))).toEqual([
      false,
      true,
      false,
      true,
      false,
    ]);
  });

  /**
   * The bug this arrangement exists to avoid, pinned so it cannot come back.
   *
   * The obvious implementation centres each rank and nudges the front one half
   * a step into the gaps. With two behind and three in front that puts both
   * ranks on exactly the same x and the adults disappear entirely — and it is
   * invisible at every other count, which is what makes it worth a test.
   */
  it("gives every figure its own column, including two behind and three in front", () => {
    const family = [adult(), adult(), child(), child(), child()];
    const { placements } = arrangeParty(family, 100);
    const xs = placements.map((p) => p.x).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) {
      expect(xs[i] - xs[i - 1], "two figures share a column").toBeGreaterThan(1);
    }
  });

  it("draws the back rank first, so the front rank overlaps it", () => {
    const { placements } = arrangeParty(Array.from({ length: 5 }, adult), 100);
    const firstFront = placements.findIndex((p) => p.front);
    const lastBack = placements.map((p) => p.front).lastIndexOf(false);
    expect(firstFront).toBeGreaterThan(lastBack);
  });

  it("gives each figure its own gait, derived from its index", () => {
    const delays = arrangeParty(Array.from({ length: 4 }, adult), 100).placements.map(
      (p) => p.delay,
    );
    expect(new Set(delays).size).toBe(4);
    // Twice, identically: an arrangement that reshuffles on a refresh would
    // disagree with the photobook about where a family stood.
    const again = arrangeParty(Array.from({ length: 4 }, adult), 100).placements.map((p) => p.x);
    const once = arrangeParty(Array.from({ length: 4 }, adult), 100).placements.map((p) => p.x);
    expect(again).toEqual(once);
  });
});

describe("travellers: parses on its own, and fails open", () => {
  it("drops one malformed entry and keeps the rest of the party", () => {
    const figures = parseTravellers([{ hair: "black" }, "not a figure", { hair: "red" }], "t");
    expect(figures).toHaveLength(2);
    expect(figures.map((f) => f.hair)).toEqual(["black", "red"]);
  });

  it("keeps a figure whose hair colour is nonsense, and draws it", () => {
    const [figure] = parseTravellers([{ hair: "chartreuse-ish", hairStyle: "coils" }], "t");
    expect(figure.hairStyle).toBe("coils");
    // The word survives to the renderer, which resolves it to the default in
    // one place rather than two.
    expect(renderFigure(figure)).toContain("<svg");
  });

  it("ignores an unknown hairStyle rather than dropping the figure", () => {
    const [figure] = parseTravellers([{ hair: "black", hairStyle: "mullet" }], "t");
    expect(figure.hairStyle).toBeUndefined();
    expect(figure.hair).toBe("black");
  });

  it("is not a list, so nothing is drawn from it and nothing throws", () => {
    expect(parseTravellers("nope", "t")).toEqual([]);
    expect(parseTravellers({ hair: "black" }, "t")).toEqual([]);
  });

  it("keeps the first ten and no more", () => {
    const many = Array.from({ length: 14 }, () => ({ hair: "black" }));
    expect(parseTravellers(many, "t")).toHaveLength(MAX_FIGURES);
  });

  it("falls back trip, then journal, then one neutral figure", () => {
    const trip = [{ hair: "red" }];
    const journal = [{ hair: "blond" }];
    expect(partyFor(trip, journal)).toEqual(trip);
    expect(partyFor([], journal)).toEqual(journal);
    expect(partyFor([], [])).toEqual([{}]);
  });
});

describe("starting points resolve, and never reach a file", () => {
  it("hands back plain attributes with no name attached", () => {
    const figure = resolvePreset("west-african");
    expect(figure).toBeTruthy();
    expect(figure).not.toHaveProperty("name");
    expect(figure).not.toHaveProperty("preset");
    expect(Object.keys(figure!).every((k) => k !== "name")).toBe(true);
  });

  it("copies, so adjusting one figure does not edit the table", () => {
    const first = resolvePreset("european")!;
    first.hair = "black";
    expect(resolvePreset("european")!.hair).toBe("blond");
  });

  it("spans more than one part of the world — the whole point of the task", () => {
    expect(PRESET_NAMES.length).toBeGreaterThanOrEqual(10);
    const tones = new Set(STARTING_POINTS.map((p) => p.figure.skin));
    expect(tones.size).toBeGreaterThanOrEqual(4);
    const styles = new Set(STARTING_POINTS.map((p) => p.figure.hairStyle));
    expect(styles.size).toBeGreaterThanOrEqual(6);
  });

  it("is not something parseTravellers will accept as a field", () => {
    const [figure] = parseTravellers([{ preset: "european", hair: "black" }], "t");
    expect(figure).not.toHaveProperty("preset");
  });
});

describe("the renderer", () => {
  it("draws every hair style without throwing, and always a head", () => {
    for (const hairStyle of HAIR_STYLES) {
      const svg = renderFigure({ hairStyle });
      expect(svg, hairStyle).toContain('<circle cx="32" cy="24" r="16"');
      expect(svg, hairStyle).toContain("</svg>");
    }
  });

  it("has no skin or hair colour of its own — an empty figure still draws", () => {
    expect(renderFigure({})).toContain("<svg");
  });

  it("draws every outfit without throwing", () => {
    for (const outfit of OUTFITS) {
      const svg = renderFigure({ outfit, shirt: "teal", pants: "plum" });
      expect(svg, outfit).toContain("</svg>");
    }
  });

  /**
   * Everybody used to be drawn in trousers, so `trousers` has to stay the
   * default byte for byte — every figure written before B498 renders exactly
   * as it did, and the change is purely additive.
   */
  it("is byte-identical with no outfit and with trousers", () => {
    const figure = { skin: "medium", hair: "black", shirt: "teal", pants: "slate" };
    expect(renderFigure({ ...figure, outfit: "trousers" })).toBe(renderFigure(figure));
  });

  /**
   * The colour rule, and the one thing a person writing the block by hand
   * gets wrong: whatever covers the torso takes `shirt`, a separate lower
   * garment takes `pants`.
   */
  it("colours a dress and a robe from shirt, and a skirt from pants", () => {
    const teal = "#159a9a";
    const plum = "#7d5ba6";

    for (const outfit of ["dress", "robe"] as const) {
      const svg = renderFigure({ outfit, shirt: "teal", pants: "plum" });
      expect(svg, outfit).toContain(teal);
      expect(svg, `${outfit} must not use pants`).not.toContain(plum);
    }

    const skirt = renderFigure({ outfit: "skirt", shirt: "teal", pants: "plum" });
    expect(skirt).toContain(teal);
    expect(skirt).toContain(plum);
  });

  it("shows skin below the hem of shorts, a skirt and a dress", () => {
    const skin = "#d9a273";
    for (const outfit of ["shorts", "skirt", "dress"] as const) {
      // The legs are drawn in skin and the garment over the top of them.
      expect(renderFigure({ outfit, skin: "medium" }), outfit).toContain(skin);
    }
    // A robe reaches the ankles, so it does not.
    const robe = renderFigure({ outfit: "robe", skin: "medium", shirt: "sand" });
    const legRects = [...robe.matchAll(/<rect[^>]*fill="#d9a273"/g)];
    expect(legRects).toHaveLength(0);
  });

  it("draws each outfit at child scale without losing it", () => {
    for (const outfit of OUTFITS) {
      const svg = renderFigure({ outfit, age: "child", shirt: "teal", pants: "plum" });
      expect(svg, outfit).toContain("scale(0.7)");
      expect(svg, outfit).toContain("</svg>");
    }
  });

  it("draws a headscarf in cloth rather than in the hair colour", () => {
    // In the hair colour it just reads as long hair, which is what the first
    // preset sheet showed.
    const scarf = renderFigure({ hair: "black", hairStyle: "headscarf", shirt: "plum" });
    expect(scarf).toContain("#7d5ba6");
  });

  it("hides a decorative figure from assistive technology", () => {
    expect(renderFigure({}, { decorative: true })).toContain('aria-hidden="true"');
    expect(renderFigure({}, { decorative: true })).not.toContain("role=");
    expect(renderFigure({}, { label: "Ana" })).toContain('aria-label="Ana"');
  });

  it("escapes a label rather than letting it close the attribute", () => {
    expect(renderFigure({}, { label: 'a" onload="x' })).not.toContain('onload="x"');
  });

  /**
   * A colour name is looked up with `Object.hasOwn`, not `map[value]`.
   * A plain index lookup reaches Object.prototype, so `hair: "constructor"`
   * resolved to the Object constructor and stringified into the markup as
   * `fill="function Object() { [native code] }"`. It carried no quote, so it
   * could not break out of the attribute — but a value arriving in the output
   * from `Object.prototype` is a bug whether or not this particular one is
   * exploitable.
   */
  it("does not treat an inherited property as a colour", () => {
    for (const attack of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
      const svg = renderFigure({ hair: attack, skin: attack, shirt: attack });
      expect(svg, attack).not.toContain("native code");
      expect(svg, attack).not.toContain("[object Object]");
      expect(svg, attack).not.toContain("function ");
    }
  });

  it("only ever emits a hex colour or a token from its own table", () => {
    const svg = renderFigure({ hair: "#a1b2c3", skin: "not-a-tone", shirt: "javascript:x" });
    expect(svg).toContain("#a1b2c3");
    expect(svg).not.toContain("javascript:");
    expect(svg).not.toContain("not-a-tone");
    // Every fill is a hex colour or the one CSS variable the shadow uses.
    for (const [, value] of svg.matchAll(/fill="([^"]*)"/g)) {
      expect(value === "none" || value.startsWith("#") || value.startsWith("var(--") || value.startsWith("rgba("), value).toBe(true);
    }
  });
});
