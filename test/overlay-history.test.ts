import { describe, expect, it } from "vitest";
import { closeAction } from "@/lib/useOverlayHistory";

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
