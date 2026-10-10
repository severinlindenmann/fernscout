"use client";

import { useState } from "react";
import type { ProviderRow, ProvidersReport } from "@/lib/providers/read";

const CARD = "rounded-3xl border border-line-quiet bg-surface-raised p-5";
const TAG = "rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-wide";

function ago(then: string, now: number): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(then)) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h ago` : `${Math.round(hours / 24)} d ago`;
}

function figure(row: ProviderRow): string {
  if (!row.amount) return "";
  return `${row.amount.currency ?? ""} ${row.amount.value.toFixed(2)}`.trim();
}

/**
 * The operator's Providers section — B1646: what each provider holds, and
 * every print order across journals. The figures were read on the server
 * (`lib/providers/read.ts`); this only draws them and asks for a fresh read.
 */
export default function ProvidersOrders({ initial, nowIso }: { initial: ProvidersReport; nowIso: string }) {
  const [report, setReport] = useState(initial);
  const [now, setNow] = useState(Date.parse(nowIso));
  const [busy, setBusy] = useState(false);
  const [wrong, setWrong] = useState<string | null>(null);

  async function refresh() {
    setBusy(true);
    setWrong(null);
    try {
      const response = await fetch("/api/admin/providers", { method: "POST" });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setReport((await response.json()) as ProvidersReport);
      setNow(Date.now());
    } catch (error) {
      setWrong(error instanceof Error ? error.message : "Refresh failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-center justify-end gap-3">
        <span className="text-sm text-ink-secondary">Read from the providers {ago(report.readAt, now)}</span>
        <button
          type="button"
          disabled={busy}
          onClick={refresh}
          className="min-h-11 rounded-xl border border-line-quiet bg-surface-raised px-3.5 text-sm font-semibold text-ink-strong disabled:opacity-60"
        >
          {busy ? "Reading…" : "Refresh"}
        </button>
      </div>
      {wrong ? (
        <p role="alert" className="mt-2 text-right text-sm text-coral-600">
          Could not refresh: {wrong}
        </p>
      ) : null}
      <div className={`mt-5 grid gap-5 ${report.orders ? "lg:grid-cols-2" : ""}`}>
        <section className={CARD}>
          <h2 className="font-display text-lg font-semibold text-ink-strong">Balances</h2>
          <p className="mt-1 text-sm text-ink-body">
            Only what a provider&apos;s own API returns, in the currency it returns it. Where it returns nothing, the
            link is where you look.
          </p>
          <ul className="mt-3 border-t border-line-faint">
            {report.rows.map((row) => (
              <Row key={row.id} row={row} now={now} />
            ))}
          </ul>
        </section>
        {report.orders ? (
          <section className={CARD}>
            <h2 className="font-display text-lg font-semibold text-ink-strong">Print orders</h2>
            <p className="mt-1 text-sm text-ink-body">Every journal, newest first.</p>
            {report.orders.length === 0 ? (
              <p className="mt-3 text-sm text-ink-body">No print orders on this instance yet.</p>
            ) : (
              <ul className="mt-3 border-t border-line-faint">
                {report.orders.map((order) => (
                  <li
                    key={order.id}
                    className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line-faint py-3 last:border-b-0"
                  >
                    <span className="min-w-0">
                      <span className="font-semibold text-ink-strong">
                        {order.kind === "photobook" ? "Photobook" : "Postcard"} · {order.owner}
                      </span>{" "}
                      <span className="font-mono text-xs text-ink-secondary">{order.id.slice(0, 8)}</span>
                      <span className="block text-sm text-ink-secondary">{ago(order.createdAt, now)}</span>
                    </span>
                    <span className="flex items-center gap-2">
                      <span
                        className={`${TAG} ${order.attention ? "bg-coral-600 text-on-deep" : "bg-surface-muted text-ink-secondary"}`}
                      >
                        {order.status}
                      </span>
                      {order.attention ? (
                        <a href={`#journals/${encodeURIComponent(order.owner)}`} className="text-sm text-ink-body underline">
                          Open journal
                        </a>
                      ) : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}
      </div>
    </div>
  );
}

function Row({ row, now }: { row: ProviderRow; now: number }) {
  const tag =
    row.state === "simulated" ? (
      <span className={`${TAG} bg-surface-subtle text-amber-700`}>Simulated</span>
    ) : row.state === "not_set_up" ? (
      <span className={`${TAG} bg-surface-muted text-ink-secondary`}>Not set up</span>
    ) : row.state === "failed" ? (
      <span className={`${TAG} border border-coral-600 bg-coral-50 text-coral-600`}>Could not read</span>
    ) : row.state === "unreadable" || (row.state === "link" && row.id !== "meta") ? (
      <span className={`${TAG} bg-surface-muted text-ink-secondary`}>Not readable</span>
    ) : row.low === true ? (
      <span className={`${TAG} bg-coral-600 text-on-deep`}>Low</span>
    ) : row.low === false ? (
      <span className={`${TAG} bg-green-100 text-green-700`}>Above {row.lowBelow?.toFixed(2)}</span>
    ) : null;

  return (
    <li className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-line-faint py-3 last:border-b-0">
      <span className="min-w-0 basis-56 flex-1">
        <span className="font-semibold text-ink-strong">{row.label}</span>{" "}
        <span className="text-sm text-ink-secondary">· {row.role}</span>
        <span className="block text-sm text-ink-secondary">
          {row.note}
          {row.state === "failed" ? ` ${row.error}.` : ""}
          {row.state === "ok" && row.lowBelow === null ? "No threshold set (providers config)." : ""}
        </span>
      </span>
      <span className="text-right">
        {row.amount ? (
          <span className="font-mono text-ink-strong">
            {figure(row)}
            {row.state === "failed" && row.readAt ? (
              <span className="ml-1 text-xs text-ink-secondary">read {ago(row.readAt, now)}</span>
            ) : null}
          </span>
        ) : null}{" "}
        {tag}
        {row.link && (row.state === "link" || row.state === "failed" || row.state === "unreadable" || row.state === "not_set_up") ? (
          <a href={row.link.href} target="_blank" rel="noreferrer" className="ml-2 text-sm text-ink-body underline">
            {row.link.label}
          </a>
        ) : null}
      </span>
    </li>
  );
}
