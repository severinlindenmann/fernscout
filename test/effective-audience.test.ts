import { describe, expect, test } from "vitest";
import { AUDIENCES, effectiveAudience, strictestVisibility } from "@/lib/photos";

/**
 * B1585 — what a badge is allowed to say.
 *
 * The badge exists because absence used to mean two things: a day with no
 * `visibility:` of its own could be on the open internet or held back by the
 * trip above it, and nothing on the page told the owner which. So the one
 * thing worth pinning is that the word follows the *gate*, never the field —
 * and that it can only ever narrow, because a label that widened would be a
 * way past a trip's gate rather than a note about it.
 */
describe("effectiveAudience", () => {
  test("no label of its own means whatever the gate above says", () => {
    expect(effectiveAudience("public", undefined)).toBe("public");
    expect(effectiveAudience("guest", undefined)).toBe("guest");
    expect(effectiveAudience("private", undefined)).toBe("private");
  });

  test("a label narrows", () => {
    expect(effectiveAudience("public", "guest")).toBe("guest");
    expect(effectiveAudience("public", "private")).toBe("private");
    expect(effectiveAudience("guest", "private")).toBe("private");
  });

  /**
   * The rule the whole vocabulary rests on (lib/photos.ts, `PHOTO_VISIBILITIES`).
   * A `guest` photograph inside a `private` trip is private — if this ever
   * returned `guest`, a badge would be telling the owner that a picture is
   * visible to people the trip refuses.
   */
  test("a label never widens what the gate above already closed", () => {
    expect(effectiveAudience("private", "guest")).toBe("private");
  });

  test("the order is the same one the label comparison already uses", () => {
    for (const own of ["guest", "private"] as const) {
      for (const above of AUDIENCES) {
        // Where both are expressible as labels, the two functions must agree —
        // one order, in one file, is the point of `AUDIENCES` sitting beside
        // `READER_LEVELS` rather than being spelled out at a call site.
        if (above === "public") continue;
        expect(effectiveAudience(above, own)).toBe(strictestVisibility(above, own));
      }
    }
  });
});
