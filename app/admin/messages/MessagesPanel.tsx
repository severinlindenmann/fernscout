"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { FAMILIES, FLOWS, TEMPLATES, templateDef, type Family, type Flow, type TemplateId } from "@/lib/messages/registry";

const ALL_FLOWS = FLOWS as readonly Flow[];
import ChannelChip, { CHANNEL_LABEL } from "./ChannelIcon";
import FlowGraph from "./FlowGraph";
import MessageSwitch from "./Switch";
import Preview from "./Preview";

const CARD = "rounded-3xl border border-line-quiet bg-surface-raised p-5";

const FAMILY_LABEL: Record<Family, string> = {
  code: "Code",
  invite: "Invite",
  news: "News",
  nudge: "Nudge",
  receipt: "Receipt",
  notice: "Notice",
  operator: "Operator",
  chat: "Conversation",
};

const CLASS_LABEL: Record<(typeof FAMILIES)[Family]["class"], string> = {
  required: "Required",
  service: "Service",
  optional: "Optional",
};

type SwitchRow = { key: string; updatedBy: string; updatedAt: string };
type Counts = Record<string, { sent: number; skipped: number }>;

type Tab = "catalogue" | "flows" | "templates" | "person" | "log" | "sms";
const TABS: { id: Tab; label: string }[] = [
  { id: "catalogue", label: "Catalogue" },
  { id: "flows", label: "Flows" },
  { id: "templates", label: "Templates" },
  { id: "person", label: "Person" },
  { id: "log", label: "Log" },
  { id: "sms", label: "SMS threads" },
];

const FAMILY_ORDER: Family[] = ["code", "invite", "news", "nudge", "notice", "receipt", "operator", "chat"];

function labelForSwitchKey(key: string): string {
  const [maybeFlow, maybeTemplate] = key.split("/");
  if (maybeTemplate && maybeTemplate in TEMPLATES) {
    return `${templateDef(maybeTemplate as TemplateId).kind} in “${ALL_FLOWS.find((f) => f.id === maybeFlow)?.label ?? maybeFlow}”`;
  }
  if (key in TEMPLATES) return templateDef(key as TemplateId).kind;
  const flow = ALL_FLOWS.find((f) => f.id === key);
  return flow ? `Everything in “${flow.label}”` : key;
}

export default function MessagesPanel({
  counts,
  initialOff,
  smsThreads,
}: {
  counts: Counts;
  initialOff: SwitchRow[];
  smsThreads: ReactNode;
}) {
  const [tab, setTab] = useState<Tab>("catalogue");
  const [off, setOff] = useState<Set<string>>(new Set(initialOff.map((r) => r.key)));
  const [personQuery, setPersonQuery] = useState("");
  const [previewId, setPreviewId] = useState<TemplateId | null>(null);
  const [channelFilter, setChannelFilter] = useState<string>("all");
  const [flowId, setFlowId] = useState<string>(ALL_FLOWS[0]?.id ?? "");
  const [selectedNode, setSelectedNode] = useState<string | null>(null);

  const flow = ALL_FLOWS.find((f) => f.id === flowId) ?? ALL_FLOWS[0];
  const selected = flow?.nodes.find((n) => n.id === selectedNode) ?? null;

  const templateIds = useMemo(() => Object.keys(TEMPLATES) as TemplateId[], []);

  function markOff(key: string, isOff: boolean) {
    setOff((prev) => {
      const next = new Set(prev);
      if (isOff) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  return (
    <div className="mt-6 flex flex-col gap-4">
      {off.size > 0 ? (
        <div className="rounded-2xl bg-coral-50 px-4 py-2 text-sm font-semibold text-coral-600">
          Off right now: {[...off].map(labelForSwitchKey).join(" · ")}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-1 border-b border-line-quiet">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`border-b-[3px] px-3 py-2 text-sm font-semibold ${
              tab === t.id ? "border-yellow-400 text-ink-strong" : "border-transparent text-ink-secondary"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "catalogue" ? (
        <div className={CARD}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-lg text-ink-strong">Every message, one row per kind</h2>
              <p className="mt-1 text-sm text-ink-secondary">
                {templateIds.length} templates. Click a row to preview it.
              </p>
            </div>
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                setTab("person");
              }}
            >
              <input
                type="search"
                value={personQuery}
                onChange={(e) => setPersonQuery(e.target.value)}
                placeholder="Find a person: email or phone"
                aria-label="Find a person"
                className="min-h-9 rounded-xl border border-line-strong bg-surface-base px-3 text-sm"
              />
              <button type="submit" className="min-h-9 rounded-xl border border-line-strong px-3 text-sm font-semibold">
                Look up
              </button>
            </form>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-ink-secondary">
                  <th className="border-b border-line-quiet px-2 py-2">Message</th>
                  <th className="border-b border-line-quiet px-2 py-2">Channel</th>
                  <th className="border-b border-line-quiet px-2 py-2">Class</th>
                  <th className="border-b border-line-quiet px-2 py-2 text-right">Sent 7d</th>
                  <th className="border-b border-line-quiet px-2 py-2 text-right">Skipped 7d</th>
                  <th className="border-b border-line-quiet px-2 py-2">Switch</th>
                </tr>
              </thead>
              <tbody>
                {FAMILY_ORDER.flatMap((fam) => {
                  const ids = templateIds.filter((id) => TEMPLATES[id].family === fam);
                  if (!ids.length) return [];
                  return [
                    <tr key={`grp-${fam}`}>
                      <td colSpan={6} className="bg-surface-subtle px-2 py-1.5 text-xs font-bold uppercase tracking-wide text-ink-secondary">
                        {FAMILY_LABEL[fam]} · {CLASS_LABEL[FAMILIES[fam].class]}
                      </td>
                    </tr>,
                    ...ids.map((id) => {
                      const def = templateDef(id);
                      const locked = FAMILIES[def.family].class === "required";
                      const c = counts[id] ?? { sent: 0, skipped: 0 };
                      return (
                        <tr key={id} className="border-b border-line-faint">
                          <td className="px-2 py-2">
                            <button type="button" className="text-left font-semibold text-ink-strong underline-offset-2 hover:underline" onClick={() => setPreviewId(id)}>
                              {def.kind}
                            </button>
                            <div className="text-xs text-ink-secondary">{def.audience}</div>
                          </td>
                          <td className="px-2 py-2">
                            <ChannelChip channel={def.channel} label={false} />
                          </td>
                          <td className="px-2 py-2 text-xs">{CLASS_LABEL[FAMILIES[def.family].class]}</td>
                          <td className="px-2 py-2 text-right tabular-nums">{c.sent}</td>
                          <td className="px-2 py-2 text-right tabular-nums">{c.skipped}</td>
                          <td className="px-2 py-2">
                            <MessageSwitch
                              messageKey={id}
                              initialOff={off.has(id)}
                              locked={locked}
                              confirmQuestion={
                                FAMILIES[def.family].class === "service"
                                  ? `Turn off ${def.kind}? It stays off until you turn it back on.`
                                  : undefined
                              }
                              confirmLabel={`Turn off ${def.kind}`}
                              onChanged={(isOff) => markOff(id, isOff)}
                            />
                          </td>
                        </tr>
                      );
                    }),
                  ];
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {tab === "templates" ? (
        <div className={CARD}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-lg text-ink-strong">All templates</h2>
            <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by channel">
              <button
                type="button"
                onClick={() => setChannelFilter("all")}
                className={`rounded-full px-3 py-1 text-xs font-semibold ${channelFilter === "all" ? "bg-action-strong text-on-action" : "border border-line-quiet"}`}
              >
                All
              </button>
              {(Object.keys(CHANNEL_LABEL) as (keyof typeof CHANNEL_LABEL)[]).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setChannelFilter(c)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${channelFilter === c ? "bg-action-strong text-on-action" : "border border-line-quiet"}`}
                >
                  {CHANNEL_LABEL[c]}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {templateIds
              .filter((id) => channelFilter === "all" || TEMPLATES[id].channel === channelFilter)
              .map((id) => {
                const def = templateDef(id);
                return (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setPreviewId(id)}
                    className="flex flex-col gap-1.5 rounded-2xl border border-line-quiet bg-surface-raised p-3 text-left hover:border-ink-strong"
                  >
                    <ChannelChip channel={def.channel} label={false} />
                    <b className="text-sm text-ink-strong">{def.kind}</b>
                    <span className="text-xs text-ink-secondary">To: {def.audience}</span>
                  </button>
                );
              })}
          </div>
        </div>
      ) : null}

      {tab === "flows" ? (
        <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)_360px]">
          <nav className={`${CARD} flex flex-col gap-1`} aria-label="Flows">
            {ALL_FLOWS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => {
                  setFlowId(f.id);
                  setSelectedNode(null);
                }}
                className={`rounded-xl px-2 py-1.5 text-left text-sm ${flowId === f.id ? "bg-surface-subtle font-semibold text-ink-strong" : "text-ink-body hover:bg-surface-subtle"} ${off.has(f.id) ? "opacity-50 line-through" : ""}`}
              >
                {f.label}
              </button>
            ))}
          </nav>
          <section className={`${CARD} overflow-x-auto`}>
            {flow ? (
              <>
                <h2 className="font-display text-lg text-ink-strong">{flow.label}</h2>
                <div className="mt-3">
                  <FlowGraph flow={flow} offKeys={off} selected={selectedNode} onSelect={setSelectedNode} />
                </div>
              </>
            ) : null}
          </section>
          <aside className={`${CARD} flex flex-col gap-3`}>
            {!selected ? (
              <p className="text-sm text-ink-secondary">Click a node. A node with a coloured badge sends something and opens a preview.</p>
            ) : (
              <>
                <div>
                  <div className="text-xs uppercase tracking-wide text-ink-secondary">{selected.type}</div>
                  <h3 className="font-display text-base text-ink-strong">
                    {selected.template ? templateDef(selected.template).kind : selected.label}
                  </h3>
                </div>
                {selected.template && FAMILIES[TEMPLATES[selected.template].family].class !== "required" ? (
                  <MessageSwitch
                    messageKey={`${flow.id}/${selected.template}`}
                    initialOff={off.has(`${flow.id}/${selected.template}`) || off.has(selected.template)}
                    confirmQuestion={
                      FAMILIES[TEMPLATES[selected.template].family].class === "service"
                        ? `Turn off ${templateDef(selected.template).kind} in “${flow.label}”? It stays off until you turn it back on.`
                        : undefined
                    }
                    confirmLabel={`Turn off ${templateDef(selected.template).kind}`}
                    onChanged={(isOff) => markOff(`${flow.id}/${selected.template}`, isOff)}
                  />
                ) : selected.template ? (
                  <p className="text-xs text-ink-secondary">Locked on — required, cannot be switched off.</p>
                ) : null}
                {selected.template ? <Preview template={selected.template} /> : null}
              </>
            )}
          </aside>
        </div>
      ) : null}

      {tab === "person" ? <PersonTab initialQuery={personQuery} /> : null}
      {tab === "log" ? <LogTab /> : null}
      {tab === "sms" ? <div className="mt-2">{smsThreads}</div> : null}

      {previewId ? (
        <div role="dialog" aria-modal="true" aria-label="Preview" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[85vh] w-full max-w-2xl overflow-auto rounded-3xl bg-surface-raised p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-display text-lg text-ink-strong">{templateDef(previewId).kind}</h2>
              <button type="button" onClick={() => setPreviewId(null)} className="rounded-full border border-line-strong px-3 py-1 text-sm font-semibold">
                Close
              </button>
            </div>
            <Preview template={previewId} />
          </div>
        </div>
      ) : null}
    </div>
  );
}

type LogRow = {
  id: string;
  template: string;
  channel: string;
  flow: string | null;
  recipientMask: string;
  locale: string | null;
  status: string;
  reason: string | null;
  createdAt: string;
};

function PersonTab({ initialQuery }: { initialQuery: string }) {
  const [query, setQuery] = useState(initialQuery);
  const [rows, setRows] = useState<LogRow[] | null>(null);
  const [loading, setLoading] = useState(false);

  async function search(q: string) {
    if (!q.trim()) {
      setRows([]);
      return;
    }
    setLoading(true);
    try {
      const response = await fetch(`/api/admin/messages/person?query=${encodeURIComponent(q)}`);
      const json = (await response.json().catch(() => ({}))) as { rows?: LogRow[] };
      setRows(json.rows ?? []);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (initialQuery) void search(initialQuery);
    // Only on first mount for the query handed over from the catalogue.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className={CARD}>
      <h2 className="font-display text-lg text-ink-strong">Who got what</h2>
      <p className="mt-1 text-sm text-ink-secondary">
        Type an email or phone. It is hashed the same way the log hashed it on the way in — the raw address is never
        listed, only a masked form (`m•••@example.com`).
      </p>
      <form
        className="mt-3 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void search(query);
        }}
      >
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Email or phone"
          aria-label="Email or phone"
          className="min-h-9 flex-1 rounded-xl border border-line-strong bg-surface-base px-3 text-sm"
        />
        <button type="submit" className="min-h-9 rounded-xl bg-action-strong px-4 text-sm font-semibold text-on-action">
          Look up
        </button>
      </form>
      {loading ? <p className="mt-3 text-sm text-ink-secondary">Looking…</p> : null}
      {rows && rows.length === 0 && !loading ? <p className="mt-3 text-sm text-ink-secondary">Nothing for that address or number.</p> : null}
      {rows && rows.length > 0 ? (
        <ul className="mt-4 flex flex-col gap-3 border-l-2 border-line-quiet pl-4">
          {rows.map((r) => (
            <li key={r.id} className="relative">
              <div className="font-mono text-xs text-ink-secondary">{new Date(r.createdAt).toLocaleString()}</div>
              <div className="flex items-center gap-2 text-sm font-semibold text-ink-strong">
                <ChannelChip channel={r.channel as never} label={false} />
                {templateDef(r.template as TemplateId).kind}
                <span className={`text-xs font-bold ${r.status === "sent" ? "text-green-700" : r.status === "skipped" ? "text-coral-600" : "text-ink-secondary"}`}>
                  {r.status}
                </span>
              </div>
              {r.reason ? <div className="text-xs text-ink-secondary">{r.reason}</div> : null}
              <div className="font-mono text-xs text-ink-secondary">{r.recipientMask}</div>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function LogTab() {
  const [status, setStatus] = useState<string>("all");
  const [rows, setRows] = useState<LogRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    const qs = status === "all" ? "" : `?status=${status}`;
    fetch(`/api/admin/messages/log${qs}`)
      .then((r) => r.json())
      .then((json: { rows?: LogRow[] }) => setRows(json.rows ?? []))
      .finally(() => setLoading(false));
  }, [status]);

  return (
    <div className={CARD}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-display text-lg text-ink-strong">Send log</h2>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Filter by status">
          {["all", "sent", "skipped", "held", "failed", "test"].map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStatus(s)}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${status === s ? "bg-action-strong text-on-action" : "border border-line-quiet"}`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
      {loading ? (
        <p className="mt-3 text-sm text-ink-secondary">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="mt-3 text-sm text-ink-secondary">Nothing logged yet.</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-ink-secondary">
                <th className="border-b border-line-quiet px-2 py-2">When</th>
                <th className="border-b border-line-quiet px-2 py-2">Message</th>
                <th className="border-b border-line-quiet px-2 py-2">To</th>
                <th className="border-b border-line-quiet px-2 py-2">Lang</th>
                <th className="border-b border-line-quiet px-2 py-2">Status</th>
                <th className="border-b border-line-quiet px-2 py-2">Why</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-line-faint">
                  <td className="whitespace-nowrap px-2 py-2 font-mono text-xs">{new Date(r.createdAt).toLocaleString()}</td>
                  <td className="px-2 py-2">
                    <span className="flex items-center gap-2">
                      <ChannelChip channel={r.channel as never} label={false} />
                      {r.template}
                    </span>
                  </td>
                  <td className="px-2 py-2 font-mono text-xs">{r.recipientMask}</td>
                  <td className="px-2 py-2 font-mono text-xs">{r.locale ?? "—"}</td>
                  <td className="px-2 py-2">
                    <span className={`text-xs font-bold ${r.status === "sent" ? "text-green-700" : r.status === "skipped" ? "text-coral-600" : "text-ink-secondary"}`}>
                      {r.status}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-xs text-ink-secondary">{r.reason ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
