import { describe, expect, it } from "vitest";
import { COMMENTS_SHOWN, commentWindow } from "@/lib/commentWindow";

describe("comment window (B-2980)", () => {
  it("keeps the day page default of three", () => {
    expect(COMMENTS_SHOWN).toBe(3);
    expect(commentWindow(3, 5, COMMENTS_SHOWN, false)).toEqual({ shown: 3, canExpand: true, canCollapse: false });
  });
  it("the reader shows the 2 most recent, then all in place", () => {
    expect(commentWindow(3, 7, 2, false)).toEqual({ shown: 2, canExpand: true, canCollapse: false });
    expect(commentWindow(7, 7, 2, true)).toEqual({ shown: 7, canExpand: false, canCollapse: true });
  });
  it("offers nothing when there is no more to show", () => {
    expect(commentWindow(2, 2, 2, false)).toEqual({ shown: 2, canExpand: false, canCollapse: false });
    expect(commentWindow(0, 0, 2, false).shown).toBe(0);
  });
});
