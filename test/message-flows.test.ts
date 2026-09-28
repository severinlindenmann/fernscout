import { describe, expect, test } from "vitest";
import { FLOWS, TEMPLATES, type TemplateId } from "../lib/messages/registry";

/**
 * B2490 — every template admin can switch has to be visible in a flow, or
 * its "sent 7d" number has nowhere to show up and its switch has nothing to
 * turn off. Complements `message-registry.test.ts` (which checks a flow's
 * own internal shape); this checks flow *coverage* against the full
 * template list.
 */

describe("message flows cover every template", () => {
  const templatedInFlows = new Set<string>();
  for (const flow of FLOWS) {
    for (const node of flow.nodes) {
      if ("template" in node && node.template) templatedInFlows.add(node.template);
    }
  }

  test("every template id in TEMPLATES appears in at least one flow", () => {
    const missing: TemplateId[] = [];
    for (const id of Object.keys(TEMPLATES) as TemplateId[]) {
      if (!templatedInFlows.has(id)) missing.push(id);
    }
    expect(missing, `template id(s) drawn in no flow: ${missing.join(", ")}`).toEqual([]);
  });
});
