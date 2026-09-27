"use client";

import { useState } from "react";
import { FAMILIES, FLOWS, TEMPLATES, templateDef, type Flow, type TemplateId } from "@/lib/messages/registry";
import { ChannelBadge, CHANNEL_LABEL } from "./ChannelIcon";
import MessageSwitch from "./Switch";
import Preview from "./Preview";

type FlowNode = Flow["nodes"][number];
type Counts = Record<string, { sent: number; skipped: number }>;
type Item = { node: FlowNode } | { from: FlowNode; lanes: { label: string; items: Item[] }[] };

/** Every template's flows, so a count shared by two flows can say so (the
 * log counts per template, not per flow). */
const FLOWS_BY_TEMPLATE = new Map<string, number>();
for (const f of FLOWS as readonly Flow[]) {
  for (const t of new Set(f.nodes.map((n) => n.template).filter(Boolean))) {
    FLOWS_BY_TEMPLATE.set(t!, (FLOWS_BY_TEMPLATE.get(t!) ?? 0) + 1);
  }
}

function nodeOf(flow: Flow, id: string): FlowNode {
  const n = flow.nodes.find((x) => x.id === id);
  if (!n) throw new Error(`Flow ${flow.id} has no node ${id}`);
  return n;
}

/** Shortest distance from `id` to every node it reaches. */
function reach(flow: Flow, id: string): Map<string, number> {
  const seen = new Map([[id, 0]]);
  const queue = [id];
  while (queue.length) {
    const at = queue.shift()!;
    for (const e of nodeOf(flow, at).to) {
      if (!seen.has(e.id)) {
        seen.set(e.id, seen.get(at)! + 1);
        queue.push(e.id);
      }
    }
  }
  return seen;
}

/**
 * A flow as a list read top to bottom: a node with several `to` becomes
 * side-by-side lanes, each followed until the nearest node every lane reaches
 * (most flows' shared `stop`), where the list carries on.
 */
export function story(flow: Flow, id: string | null, until: string | null): Item[] {
  const items: Item[] = [];
  while (id && id !== until) {
    const node = nodeOf(flow, id);
    items.push({ node });
    if (node.to.length > 1) {
      const maps = node.to.map((e) => reach(flow, e.id));
      let join: string | null = null;
      for (const [cand, d] of maps[0]) {
        if (maps.every((m) => m.has(cand)) && (join === null || d < maps[0].get(join)!)) join = cand;
      }
      items.push({
        from: node,
        lanes: node.to.map((e, i) => ({ label: e.label ?? `Path ${i + 1}`, items: story(flow, e.id, join) })),
      });
      id = join;
    } else {
      id = node.to[0]?.id ?? null;
    }
  }
  return items;
}

const VERB: Record<FlowNode["type"], string> = { trigger: "When", check: "If", wait: "Wait", send: "Send", stop: "Ends" };

export function flowTotals(flow: Flow, counts: Counts) {
  const templates = [...new Set(flow.nodes.map((n) => n.template).filter((t): t is TemplateId => Boolean(t)))];
  return {
    templates,
    sent: templates.reduce((s, t) => s + (counts[t]?.sent ?? 0), 0),
    skipped: templates.reduce((s, t) => s + (counts[t]?.skipped ?? 0), 0),
  };
}

export function isFlowNodeOff(flow: Flow, template: string, off: Set<string>) {
  return off.has(flow.id) || off.has(template) || off.has(`${flow.id}/${template}`);
}

export default function FlowStory({
  flow,
  counts,
  off,
  markOff,
}: {
  flow: Flow;
  counts: Counts;
  off: Set<string>;
  markOff: (key: string, isOff: boolean) => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const first = flow.nodes[0];
  const totals = flowTotals(flow, counts);
  const audiences = [...new Set(totals.templates.map((t) => templateDef(t).audience))].join(", ");

  function sendRow(node: FlowNode) {
    const id = node.template as TemplateId;
    const def = templateDef(id);
    const cls = FAMILIES[TEMPLATES[id].family].class;
    const isOff = isFlowNodeOff(flow, id, off);
    const c = counts[id] ?? { sent: 0, skipped: 0 };
    return (
      <div className={`grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 gap-y-2 rounded-2xl border border-line-quiet bg-surface-raised p-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] ${isOff ? "opacity-60" : ""}`}>
        <ChannelBadge channel={def.channel} size="lg" />
        <div className="min-w-0">
          <div className="font-semibold text-ink-strong">{def.kind}</div>
          <div className="flex flex-wrap gap-x-3 text-xs text-ink-secondary">
            <span>{node.label}</span>
            <span>→ {def.audience}</span>
            <span>{CHANNEL_LABEL[def.channel]}</span>
            {isOff ? <span className="rounded-full bg-coral-50 px-2 font-bold text-coral-600">off</span> : null}
          </div>
        </div>
        <div className="col-start-2 text-sm tabular-nums text-ink-secondary sm:col-start-3 sm:text-right">
          <b className="text-base text-ink-strong">{c.sent}</b> sent 7d
          {c.skipped ? <span> · {c.skipped} skipped</span> : null}
          {(FLOWS_BY_TEMPLATE.get(id) ?? 0) > 1 ? <div className="text-xs">all flows</div> : null}
        </div>
        <div className="col-start-2 flex flex-wrap items-center gap-3 sm:col-end-4">
          {cls === "required" ? (
            <span className="text-xs font-semibold text-ink-secondary">Required, always on</span>
          ) : (
            <MessageSwitch
              key={`${flow.id}/${id}`}
              messageKey={`${flow.id}/${id}`}
              initialOff={isOff}
              confirmQuestion={cls === "service" ? `Turn off ${def.kind} in “${flow.label}”? It stays off until you turn it back on.` : undefined}
              confirmLabel={`Turn off ${def.kind}`}
              onChanged={(o) => markOff(`${flow.id}/${id}`, o)}
            />
          )}
          <button
            type="button"
            aria-expanded={open === node.id}
            onClick={() => setOpen(open === node.id ? null : node.id)}
            className="rounded-full border border-line-strong px-3 py-0.5 text-xs font-semibold text-ink-strong"
          >
            {open === node.id ? "Hide preview" : "Preview"}
          </button>
        </div>
        {open === node.id ? (
          <div className="col-span-full">
            <Preview template={id} />
          </div>
        ) : null}
      </div>
    );
  }

  function body(node: FlowNode) {
    if (node.type === "send") return sendRow(node);
    return (
      <p className="pt-1 text-sm text-ink-secondary">
        <b className="font-semibold text-ink-strong">{VERB[node.type]}</b> {node.label}
      </p>
    );
  }

  function list(items: Item[], nested: boolean) {
    return items.map((it, i) => {
      if ("lanes" in it) {
        return (
          <li key={`fork-${it.from.id}`} className={nested ? "" : "pl-8"}>
            <div className="grid gap-3 md:grid-cols-[repeat(auto-fit,minmax(240px,1fr))]">
              {it.lanes.map((lane) => (
                <div key={lane.label} className="flex flex-col gap-2 border-l-2 border-dashed border-line-strong pl-3">
                  <span className="text-xs font-bold uppercase tracking-wide text-ink-strong">{lane.label}</span>
                  <ol className="flex flex-col gap-2">{list(lane.items, true)}</ol>
                </div>
              ))}
            </div>
          </li>
        );
      }
      if (nested) return <li key={it.node.id}>{body(it.node)}</li>;
      return (
        <li key={`${it.node.id}-${i}`} className="relative pl-8">
          <span
            aria-hidden
            className={`absolute left-2 top-2.5 h-3 w-3 rounded-full border-2 border-line-strong ${it.node.type === "stop" ? "bg-line-strong" : "bg-surface-raised"} ${it.node.type === "wait" ? "border-dashed" : ""}`}
          />
          {body(it.node)}
        </li>
      );
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line-quiet pb-4">
        <div className="flex min-w-0 flex-col gap-2">
          <h2 className="font-display text-lg text-ink-strong">{flow.label}</h2>
          <div className="flex w-fit max-w-full items-center gap-2 rounded-full bg-ink-strong px-3 py-1 text-sm font-semibold text-on-action">
            <span className="text-[10px] font-bold uppercase tracking-wide opacity-70">{VERB[first.type]}</span>
            {first.label}
          </div>
        </div>
        <dl className="flex gap-5 tabular-nums">
          <div>
            <dd className="font-display text-xl text-ink-strong">{totals.sent}</dd>
            <dt className="text-xs text-ink-secondary">sent 7d</dt>
          </div>
          <div>
            <dd className="font-display text-xl text-ink-strong">{totals.skipped}</dd>
            <dt className="text-xs text-ink-secondary">skipped</dt>
          </div>
          <div>
            <dd className="pt-1 font-semibold text-ink-strong">{audiences}</dd>
            <dt className="text-xs text-ink-secondary">receives</dt>
          </div>
        </dl>
      </div>
      <ol className="relative flex flex-col gap-3 before:absolute before:bottom-3 before:left-[13px] before:top-3 before:w-0.5 before:bg-line-quiet">
        {list(story(flow, first.id, null).slice(1), false)}
      </ol>
    </div>
  );
}
