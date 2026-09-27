import { describe, expect, it } from "vitest";
import { FLOWS, type Flow } from "@/lib/messages/registry";
import { story } from "@/app/admin/messages/FlowStory";

const flow = (id: string) => (FLOWS as readonly Flow[]).find((f) => f.id === id)!;

describe("admin flow story (B2484)", () => {
  it("walks every flow to its end without losing a node", () => {
    for (const f of FLOWS as readonly Flow[]) {
      const seen = new Set<string>();
      const walk = (items: ReturnType<typeof story>) =>
        items.forEach((it) => ("lanes" in it ? it.lanes.forEach((l) => walk(l.items)) : seen.add(it.node.id)));
      walk(story(f, f.nodes[0].id, null));
      expect([...seen].sort(), f.id).toEqual(f.nodes.map((n) => n.id).sort());
    }
  });

  it("splits first-trip nudge into labelled lanes that rejoin at stop", () => {
    const items = story(flow("firsttrip"), "created", null);
    const fork = items.find((it) => "lanes" in it)!;
    expect("lanes" in fork && fork.lanes.map((l) => l.label)).toEqual(["Yes", "No"]);
    expect(items.at(-1)).toMatchObject({ node: { id: "stop" } });
  });
});
