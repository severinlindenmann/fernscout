import { describe, expect, it } from "vitest";
import { closeAction, isStaleEntry } from "@/lib/useOverlayHistory";

describe("closeAction (B-2852)", () => {
  it("pops the entry we pushed while it is current", () => {
    expect(closeAction(true, { fernscoutOverlay: "a" }, "a")).toBe("back");
  });
  it("closes in place when we did not push", () => {
    expect(closeAction(false, { fernscoutOverlay: "a" }, "a")).toBe("direct");
  });
  it("closes in place when the current entry is not ours", () => {
    expect(closeAction(true, null, "a")).toBe("direct");
    expect(closeAction(true, { fernscoutOverlay: "b" }, "a")).toBe("direct");
  });
});

describe("isStaleEntry (B-2852)", () => {
  it("drops our leftover entry after a parent-driven close", () => {
    expect(isStaleEntry(false, true, { fernscoutOverlay: "a" }, "a")).toBe(true);
  });
  it("keeps it when live again (strict-mode re-run), already popped, or not ours", () => {
    expect(isStaleEntry(true, true, { fernscoutOverlay: "a" }, "a")).toBe(false);
    expect(isStaleEntry(false, false, { fernscoutOverlay: "a" }, "a")).toBe(false);
    expect(isStaleEntry(false, true, null, "a")).toBe(false);
  });
});
