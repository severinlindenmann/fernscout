import { FAMILIES, TEMPLATES, templateDef, type Flow } from "@/lib/messages/registry";
import { CHANNEL_ICON_PATHS } from "./ChannelIcon";

type FlowNode = Flow["nodes"][number];

const W = 184;
const H = 54;
const GX = 58;
const GY = 18;
const PAD = 20;

type Placed = FlowNode & { d: number; r: number };

/**
 * A tidy-tree layout for one flow's nodes — x by depth, y by leaf order.
 * Ported from the owner-approved draft's own `layout()`/`graph()`
 * (`messages-draft.html`), which is why it keeps the draft's one known
 * limitation: a node several parents point at (most flows' shared `stop`)
 * is placed once, at whichever parent reaches it first, so its edges can
 * curve rather than land squarely — true of the draft this shipped from,
 * and not worth a heavier algorithm for a documentation graph nobody
 * measures pixels on.
 */
function layout(flow: Flow) {
  const by = new Map<string, Placed>();
  let leaf = 0;
  let maxDepth = 0;

  function place(id: string, depth: number): Placed {
    const existing = by.get(id);
    if (existing) return existing;
    const source = flow.nodes.find((n) => n.id === id);
    if (!source) throw new Error(`Flow ${flow.id} has no node ${id}`);
    maxDepth = Math.max(maxDepth, depth);
    const placed: Placed = { ...source, d: depth, r: 0 };
    by.set(id, placed);
    const kids = source.to.map((e) => place(e.id, depth + 1));
    placed.r = kids.length ? (kids[0].r + kids[kids.length - 1].r) / 2 : leaf++;
    return placed;
  }
  place(flow.nodes[0].id, 0);

  const w = PAD * 2 + (maxDepth + 1) * W + maxDepth * GX;
  const h = PAD * 2 + Math.max(leaf, 1) * (H + GY) - GY;
  return { by, w, h };
}

const nx = (n: Placed) => PAD + n.d * (W + GX);
const ny = (n: Placed) => PAD + n.r * (H + GY);

/** Whether a switch would stop this node's own send — a whole-flow switch,
 * or one on the node's own template (bare, or `flow/template`). */
function nodeSwitchKey(flow: Flow, node: FlowNode): string[] {
  if (!node.template) return [];
  return [node.template, `${flow.id}/${node.template}`];
}

function isNodeOff(flow: Flow, node: FlowNode, offKeys: Set<string>): boolean {
  if (offKeys.has(flow.id)) return true;
  return nodeSwitchKey(flow, node).some((k) => offKeys.has(k));
}

function isLocked(node: FlowNode): boolean {
  return Boolean(node.template && FAMILIES[TEMPLATES[node.template].family].class === "required");
}

const TYPE_FILL: Record<FlowNode["type"], string> = {
  trigger: "fill-ink-strong stroke-ink-strong",
  check: "fill-surface-subtle stroke-line-strong",
  wait: "fill-yellow-50 stroke-line-strong [stroke-dasharray:4_3]",
  send: "fill-surface-raised stroke-line-strong",
  stop: "fill-surface-subtle stroke-none",
};

export default function FlowGraph({
  flow,
  offKeys,
  selected,
  onSelect,
}: {
  flow: Flow;
  offKeys: Set<string>;
  selected: string | null;
  onSelect: (nodeId: string) => void;
}) {
  const { by, w, h } = layout(flow);
  const nodes = [...by.values()];

  return (
    <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`Flow: ${flow.label}`} className="max-w-full">
      {nodes.flatMap((n) =>
        n.to
          .map((e) => by.get(e.id))
          .filter((k): k is Placed => Boolean(k))
          .map((k, i) => {
            const x1 = nx(n) + W;
            const y1 = ny(n) + H / 2;
            const x2 = nx(k);
            const y2 = ny(k) + H / 2;
            const mx = (x1 + x2) / 2;
            const dim = isNodeOff(flow, k, offKeys);
            return (
              <path
                key={`${n.id}-${k.id}-${i}`}
                d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`}
                className={`fill-none stroke-line-strong ${dim ? "opacity-30" : ""}`}
                strokeWidth={1.4}
              />
            );
          }),
      )}
      {nodes.map((n) => {
        const t = n.template ? templateDef(n.template) : null;
        const off = isNodeOff(flow, n, offKeys);
        const locked = isLocked(n);
        const x = nx(n);
        const y = ny(n);
        const eb = n.type === "trigger" ? "WHEN" : n.type === "check" ? "IF" : n.type.toUpperCase();
        const label = t ? t.kind : n.label;
        const textX = t ? x + 44 : x + 14;
        return (
          <g
            key={n.id}
            tabIndex={0}
            role="button"
            aria-label={`${t ? `${t.kind} — ` : ""}${label}${off ? " (switched off)" : ""}`}
            onClick={() => onSelect(n.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(n.id);
              }
            }}
            className={`cursor-pointer ${off ? "opacity-40" : ""}`}
          >
            <rect
              x={x}
              y={y}
              width={W}
              height={H}
              rx={n.type === "trigger" || n.type === "stop" ? 27 : 12}
              className={`${TYPE_FILL[n.type]} ${selected === n.id ? "stroke-2" : "stroke-1"}`}
            />
            {t ? (
              <>
                <rect x={x} y={y} width={6} height={H} rx={3} className="fill-yellow-400" />
                <rect x={x + 12} y={y + H / 2 - 14} width={28} height={28} rx={8} className="fill-ink-strong" />
                <svg
                  x={x + 16}
                  y={y + H / 2 - 10}
                  width={20}
                  height={20}
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="white"
                  strokeWidth={1.6}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d={CHANNEL_ICON_PATHS[t.channel]} />
                </svg>
              </>
            ) : null}
            <text x={textX} y={y + 17} className={`text-[9.5px] font-bold tracking-wide ${n.type === "trigger" ? "fill-on-action" : "fill-ink-secondary"}`}>
              {eb}
              {locked ? " · LOCKED" : ""}
              {off ? " · OFF" : ""}
            </text>
            <text x={textX} y={y + (n.sub ? 33 : 36)} className={`text-[12.5px] font-semibold ${n.type === "trigger" ? "fill-on-action" : "fill-ink-strong"}`}>
              {label.length > 26 ? `${label.slice(0, 25)}…` : label}
            </text>
            {n.sub ? (
              <text x={textX} y={y + H - 8} className="fill-ink-secondary text-[10px]">
                {n.sub.length > 34 ? `${n.sub.slice(0, 33)}…` : n.sub}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
