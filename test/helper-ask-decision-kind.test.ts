import { describe, expect, test } from "vitest";
import { decisionKind } from "@/components/HelperAsk";
import { TOOLS } from "@/lib/helper/tools";

/**
 * B1122 — a card's colour comes from the tool's own name, never from a list
 * this file keeps in step with the registry by hand. This is the one
 * runnable check for that: it names the tools whose classification the
 * ticket actually cares about, and then walks every write tool in the real
 * registry to be sure the function never throws and always lands on one of
 * the four kinds — the thing a hand-kept list could quietly drift out of
 * step with.
 */
describe("decisionKind", () => {
  test("grants access", () => {
    expect(decisionKind("invite_guest")).toBe("grant");
    expect(decisionKind("trip_people")).toBe("grant");
    expect(decisionKind("set_visibility")).toBe("grant");
  });

  test("spends credits", () => {
    expect(decisionKind("buy_room")).toBe("spend");
  });

  test("destroys, even when the name also reads as a grant word", () => {
    expect(decisionKind("revoke_invite")).toBe("destroy");
    expect(decisionKind("revoke_key")).toBe("destroy");
    expect(decisionKind("discard_file")).toBe("destroy");
    expect(decisionKind("remove_photo")).toBe("destroy");
    expect(decisionKind("unpublish_day")).toBe("destroy");
    expect(decisionKind("cleanup")).toBe("destroy");
  });

  test("an ordinary edit gets no warning colour", () => {
    expect(decisionKind("set_day_words")).toBe("edit");
    expect(decisionKind("add_cost")).toBe("edit");
    expect(decisionKind("photobook")).toBe("edit");
    expect(decisionKind("propose_postcards")).toBe("edit");
  });

  test("every write tool in the real registry classifies without throwing", () => {
    const kinds = new Set(["grant", "spend", "destroy", "edit"]);
    for (const tool of TOOLS) {
      if (tool.kind !== "write") continue;
      expect(kinds.has(decisionKind(tool.name))).toBe(true);
    }
  });
});
