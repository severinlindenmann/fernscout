"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ConfirmPanel from "@/components/ConfirmPanel";
import { useI18n } from "@/components/LocaleProvider";
import Composer, { type StopOutcome } from "@/components/studio/plan/Composer";
import MoneyPanel, { formatMoney } from "@/components/studio/plan/MoneyPanel";
import LinksPanel from "@/components/studio/plan/LinksPanel";
import { findGaps, moveStop, previewNightsSchedule } from "@/lib/planner/schedule";
import type { CostsDoc, PendingPin, PlanDoc, PlanStop } from "@/lib/planner/types";
import { hasOutbox, newIntent, openOutboxStore } from "@/lib/outbox";

const UNDO_MS = 60_000;

type View = "list" | "money" | "links";
type SaveStatus = "idle" | "saving" | "saved" | "failed" | "queued";

function slugFallback(location: string): string {
  return location.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "stop";
}

/**
 * `/[user]/studio/plan/[trip]` — B2011. The whole planner: composer, list
 * with nights/dates, inline stop editing, mode switch, money and links.
 *
 * **State lives here, the server's response is the truth.** Every write is
 * one PATCH to `/api/web/[user]/trips/[trip]/plan`, and — since that route
 * proxies `applyTripPatch`, which always echoes the merged document back —
 * the response body IS the re-read the ticket asks for: no second GET, and
 * no chance for a save and a read to disagree about what happened.
 */
export default function PlannerFlow({
  username,
  tripId,
  tripStart,
  initialPlan,
  initialCosts,
  baseCurrency,
  currencies,
  initialPins,
}: {
  username: string;
  tripId: string;
  tripStart: string;
  initialPlan: PlanDoc | null;
  initialCosts: CostsDoc | null;
  baseCurrency: string;
  /** `journalCurrencies` (`lib/rates.ts`), base first — B2143. */
  currencies: string[];
  addressLookupEnabled: boolean;
  initialPins?: PendingPin[];
}) {
  const { t, tn, formatLongDate, locale } = useI18n();
  const [plan, setPlan] = useState<PlanDoc>(initialPlan ?? { route: [] });
  const [costs, setCosts] = useState<CostsDoc>(initialCosts ?? {});
  const linkCount =
    (plan.private?.links?.length ?? 0) + Object.values(plan.private?.stops ?? {}).reduce((n, stop) => n + (stop?.links?.length ?? 0), 0);
  const [pins, setPins] = useState<PendingPin[]>(initialPins ?? []);
  const [view, setView] = useState<View>("list");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [dirty, setDirty] = useState(false);
  const [removing, setRemoving] = useState<PlanStop | null>(null);
  const [declineReason, setDeclineReason] = useState("");
  const [removeBusy, setRemoveBusy] = useState(false);
  const [undo, setUndo] = useState<{ plan: PlanDoc; costs: CostsDoc; expiresAt: number } | null>(null);
  const [switchingMode, setSwitchingMode] = useState(false);

  // Drag state — pointer events; Up/Down stays the accessible path (the
  // ticket's own line). Disabled while a stop is expanded, since a variable
  // row height would make the pointer math lie.
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const rowRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // The last-used code, when the journal still keeps it; else the base.
  const lastCurrency =
    [costs.items?.[0]?.currency, costs.budget?.currency].find((c) => c && currencies.includes(c)) ?? currencies[0] ?? baseCurrency;

  useEffect(() => {
    if (!dirty) return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(() => setUndo(null), undo.expiresAt - Date.now());
    return () => clearTimeout(timer);
  }, [undo]);

  async function save(nextPlan?: PlanDoc, nextCosts?: CostsDoc, declineWholePlan?: string): Promise<boolean> {
    setSaveStatus("saving");
    const body: Record<string, unknown> = {};
    if (declineWholePlan) {
      body.declined = { plan: declineWholePlan };
    } else if (nextPlan) {
      body.plan = nextPlan;
    }
    if (nextCosts) body.costs = nextCosts;
    const url = `/api/web/${encodeURIComponent(username)}/trips/${encodeURIComponent(tripId)}/plan`;
    try {
      const res = await fetch(url, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json().catch(() => null)) as { plan?: PlanDoc; costs?: CostsDoc; error?: string } | null;
      if (!res.ok || !json) {
        setSaveStatus("failed");
        return false;
      }
      setPlan(json.plan ?? { route: [] });
      setCosts(json.costs ?? {});
      setSaveStatus("saved");
      setDirty(false);
      return true;
    } catch {
      // B2330 — a network error (offline), not a rejection the server sent:
      // queued for replay rather than lost. This route (`.../plan/route.ts`)
      // carries no `If-Match`/version of its own — `PlannerFlow` never reads
      // one, so a live save here has always been last-write-wins the same
      // way a queued one now is; queuing changes nothing about that
      // contract, only when the write reaches the server. Applied to local
      // state at once (optimistic — the same "the response body IS the
      // re-read" trust `save`'s own doc comment already places in this
      // route, just without the response to read it back from yet).
      if (!hasOutbox()) {
        setSaveStatus("failed");
        return false;
      }
      const store = openOutboxStore();
      await store.add(newIntent({ user: username, kind: "plan.patch", method: "PATCH", url, body }));
      if (nextPlan) setPlan(nextPlan);
      if (nextCosts) setCosts(nextCosts);
      setSaveStatus("queued");
      setDirty(false);
      return true;
    }
  }

  /**
   * A pin's own owner-only door — B2014. Best effort: a failed delete leaves
   * the pin in the list rather than pretending it is gone, so the person can
   * try Ignore (or Use as a place) again rather than losing track of it.
   */
  async function removePin(id: string): Promise<boolean> {
    try {
      const res = await fetch(
        `/api/web/${encodeURIComponent(username)}/inbox/pins/${encodeURIComponent(id)}`,
        { method: "DELETE" },
      );
      if (!res.ok) return false;
    } catch {
      return false;
    }
    setPins((p) => p.filter((pin) => pin.id !== id));
    return true;
  }

  const previewRoute = useMemo(
    () => (plan.mode === "dates" ? plan.route : previewNightsSchedule(plan.route, tripStart)),
    [plan.route, plan.mode, tripStart],
  );

  async function commitOutcome(outcome: StopOutcome) {
    if (outcome.action === "cost") {
      const items = [...(costs.items ?? []), { label: outcome.label, amount: outcome.amount, currency: outcome.currency, category: outcome.category, stop: outcome.stopId }];
      void save(undefined, { ...costs, items });
      return;
    }
    if (outcome.action === "link") {
      const link = { label: outcome.label, url: outcome.url };
      const nextPrivate = { ...(plan.private ?? {}) };
      if (outcome.stopId) {
        const stops = { ...(nextPrivate.stops ?? {}) };
        const existing = stops[outcome.stopId] ?? {};
        stops[outcome.stopId] = { ...existing, links: [...(existing.links ?? []), link] };
        nextPrivate.stops = stops;
      } else {
        nextPrivate.links = [...(nextPrivate.links ?? []), link];
      }
      void save({ ...plan, private: nextPrivate });
      return;
    }
    if (outcome.action === "visit") {
      const route = plan.route.map((s) =>
        s.id === outcome.stopId ? { ...s, see: [...(s.see ?? []), { name: outcome.place.name, lat: outcome.place.lat, lng: outcome.place.lng, source: outcome.place.source }] } : s,
      );
      const ok = await save({ ...plan, route });
      if (ok && outcome.place.pinId) void removePin(outcome.place.pinId);
      return;
    }
    if (outcome.action === "stay") {
      const nextPrivate = { ...(plan.private ?? {}) };
      const stops = { ...(nextPrivate.stops ?? {}) };
      const existing = stops[outcome.stopId] ?? {};
      stops[outcome.stopId] = { ...existing, stay: { name: outcome.place.name, lat: outcome.place.lat, lng: outcome.place.lng } };
      nextPrivate.stops = stops;
      const ok = await save({ ...plan, private: nextPrivate });
      if (ok && outcome.place.pinId) void removePin(outcome.place.pinId);
      return;
    }
    // newStop
    const id = slugFallback(outcome.place.name);
    const stop: PlanStop = {
      id,
      location: outcome.place.name,
      lat: outcome.place.lat,
      lng: outcome.place.lng,
      country: outcome.place.country,
      countryCode: outcome.place.countryCode,
      nights: outcome.nights,
      source: outcome.place.source,
    };
    const route = [...plan.route];
    route.splice(outcome.insertAt, 0, stop);
    const ok = await save({ ...plan, route });
    if (ok && outcome.place.pinId) void removePin(outcome.place.pinId);
  }

  function handleMove(from: number, to: number) {
    const nextRoute = moveStop(plan.route, from, to);
    void save({ ...plan, route: nextRoute });
  }

  function requestRemove(stop: PlanStop) {
    setDeclineReason("");
    setRemoving(stop);
  }

  async function confirmRemove() {
    if (!removing) return;
    setRemoveBusy(true);
    const isLast = plan.route.length <= 1;
    const snapshot = { plan, costs };
    if (isLast) {
      const reason = declineReason.trim() || t("studio.plan.list.remove.defaultReason");
      const ok = await save(undefined, undefined, reason);
      if (ok) setUndo({ ...snapshot, expiresAt: Date.now() + UNDO_MS });
    } else {
      const route = plan.route.filter((s) => s.id !== removing.id);
      const nextPrivate = { ...(plan.private ?? {}) };
      if (nextPrivate.stops?.[removing.id ?? ""]) {
        const stops = { ...nextPrivate.stops };
        delete stops[removing.id ?? ""];
        nextPrivate.stops = stops;
      }
      const nextCosts = { ...costs, items: (costs.items ?? []).filter((c) => c.stop !== removing.id) };
      const ok = await save({ ...plan, route, private: nextPrivate }, nextCosts);
      if (ok) setUndo({ ...snapshot, expiresAt: Date.now() + UNDO_MS });
    }
    setRemoveBusy(false);
    setRemoving(null);
    setExpandedId(null);
  }

  function doUndo() {
    if (!undo) return;
    void save(undo.plan, undo.costs);
    setUndo(null);
  }

  function switchMode(to: "nights" | "dates") {
    void save({ ...plan, mode: to });
    setSwitchingMode(false);
  }

  const currentMode = plan.mode ?? "nights";
  const gaps = currentMode === "dates" ? findGaps(plan.route) : [];
  // B2086: the nudge shows once, under the first stop without nights.
  const firstWithoutNights = previewRoute.findIndex((s) => s.nights === undefined);

  if (plan.route.length === 0 && view === "list") {
    return (
      <>
        <p className="mt-1 text-sm text-ink-secondary">{t("studio.plan.empty.subtitle")}</p>
        <div className="mt-4">
          <Composer
            username={username}
            route={plan.route}
            lastCurrency={lastCurrency}
              currencies={currencies}
            onCommit={commitOutcome}
            pins={pins}
            onIgnorePin={(id) => void removePin(id)}
          />
        </div>
        <p className="mt-4 text-sm text-ink-secondary" role="status">
          {saveStatus === "saving" && t("studio.plan.saving")}
          {saveStatus === "saved" && t("studio.plan.saved")}
          {saveStatus === "queued" && t("studio.plan.queued")}
          {saveStatus === "failed" && t("studio.plan.failed")}
        </p>
      </>
    );
  }

  return (
    <>

      {view === "list" && (
        <>
          <div className="mt-4">
            <Composer
              username={username}
              route={plan.route}
              lastCurrency={lastCurrency}
              currencies={currencies}
              onCommit={commitOutcome}
              pins={pins}
              onIgnorePin={(id) => void removePin(id)}
            />
          </div>

          <div className="mt-4 flex rounded-full border border-line-strong text-sm">
            <button
              type="button"
              onClick={() => (currentMode === "dates" ? setSwitchingMode(true) : undefined)}
              aria-pressed={currentMode === "nights"}
              className={`min-h-11 flex-1 rounded-full ${currentMode === "nights" ? "bg-action-strong text-on-action" : ""}`}
            >
              {t("studio.plan.mode.nights")}
            </button>
            <button
              type="button"
              onClick={() => (currentMode === "nights" ? setSwitchingMode(true) : undefined)}
              aria-pressed={currentMode === "dates"}
              className={`min-h-11 flex-1 rounded-full ${currentMode === "dates" ? "bg-action-strong text-on-action" : ""}`}
            >
              {t("studio.plan.mode.dates")}
            </button>
          </div>

          {switchingMode && (
            <div className="mt-2 rounded-xl border border-line-strong bg-surface-subtle p-3">
              <p className="text-sm text-ink-body">
                {currentMode === "nights" ? t("studio.plan.mode.toDatesPreview") : t("studio.plan.mode.toNightsPreview")}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => switchMode(currentMode === "nights" ? "dates" : "nights")}
                  className="min-h-11 rounded-full bg-action-strong px-4 text-sm font-semibold text-on-action"
                >
                  {t("studio.plan.mode.apply")}
                </button>
                <button
                  type="button"
                  onClick={() => setSwitchingMode(false)}
                  className="min-h-11 rounded-full border border-line-strong px-4 text-sm"
                >
                  {t("studio.plan.mode.keep")}
                </button>
              </div>
            </div>
          )}

          {gaps.length > 0 && (
            <div className="mt-2 rounded-xl border border-line-strong bg-surface-subtle p-3 text-sm">
              <p className="font-semibold text-ink-strong">
                {tn("studio.plan.mode.gapCount", gaps.length, { count: String(gaps.length) })}
              </p>
              <p className="text-ink-secondary">{t("studio.plan.mode.gapExplain", { date: formatLongDate(gaps[0]) })}</p>
            </div>
          )}

          {dragOver !== null && dragFrom !== null && dragOver !== dragFrom && (
            <div className="mt-2 rounded-xl border border-line-strong bg-surface-raised p-3 shadow-lg" role="status">
              <p className="font-display text-sm font-semibold text-ink-strong">
                {t("studio.plan.list.dragging", { stop: plan.route[dragFrom]?.location ?? "" })}
              </p>
              {(() => {
                const preview = previewNightsSchedule(moveStop(plan.route, dragFrom, dragOver), tripStart);
                return preview.map((s) => (
                  <p key={s.id ?? s.location} className="text-xs text-ink-secondary">
                    {s.location}: {s.arrive ? formatLongDate(s.arrive) : "—"} → {s.leave ? formatLongDate(s.leave) : "—"}
                  </p>
                ));
              })()}
            </div>
          )}

          <ul className="mt-4 flex flex-col">
            {previewRoute.map((stop, index) => {
              const raw = plan.route[index];
              const expanded = expandedId === stop.id;
              const privateStop = stop.id ? plan.private?.stops?.[stop.id] : undefined;
              const stopCosts = (costs.items ?? []).filter((c) => c.stop === stop.id);
              return (
                <div
                  key={stop.id ?? `${stop.location}-${index}`}
                  ref={(el) => {
                    if (el) rowRefs.current.set(index, el);
                    else rowRefs.current.delete(index);
                  }}
                  className="grid grid-cols-[1fr_auto] items-start gap-2 border-b border-line-faint py-3"
                >
                  <div>
                    <button
                      type="button"
                      onClick={() => setExpandedId(expanded ? null : (stop.id ?? null))}
                      className="flex min-h-11 items-center gap-1 text-left font-display text-base font-semibold text-ink-strong"
                    >
                      <span aria-hidden>{expanded ? "▾" : "▸"}</span>
                      {stop.location}
                    </button>
                    {currentMode === "nights" ? (
                      stop.nights === undefined ? (
                        index === firstWithoutNights && (
                          <p className="text-sm text-action-strong">{t("studio.plan.list.setNights")}</p>
                        )
                      ) : (
                        <p className="text-sm text-ink-secondary">
                          {stop.arrive && stop.leave
                            ? tn("studio.plan.list.nightsAndDates", stop.nights, {
                                nights: String(stop.nights),
                                arrive: formatLongDate(stop.arrive),
                                leave: formatLongDate(stop.leave),
                              })
                            : tn("studio.plan.confirm.nightCount", stop.nights, { count: String(stop.nights) })}
                        </p>
                      )
                    ) : (
                      <p className="text-sm text-ink-secondary">
                        {stop.arrive && stop.leave
                          ? `${formatLongDate(stop.arrive)} → ${formatLongDate(stop.leave)}`
                          : t("studio.plan.list.datesOpen")}
                      </p>
                    )}
                    {!expanded && stop.note && <p className="text-sm text-ink-secondary">{stop.note}</p>}

                    {expanded && (
                      <StopEditor
                        stop={raw}
                        privateStop={privateStop}
                        costs={stopCosts}
                        onChange={(patch) => {
                          const route = plan.route.map((s) => (s.id === stop.id ? { ...s, ...patch } : s));
                          setPlan((p) => ({ ...p, route }));
                          setDirty(true);
                        }}
                        onSave={() => void save(plan)}
                        nightsStep={(delta) => {
                          const n = Math.max(0, (raw.nights ?? 0) + delta);
                          const route = plan.route.map((s) => (s.id === stop.id ? { ...s, nights: n || undefined } : s));
                          void save({ ...plan, route });
                        }}
                        onUp={index > 0 ? () => handleMove(index, index - 1) : undefined}
                        onDown={index < plan.route.length - 1 ? () => handleMove(index, index + 1) : undefined}
                        onRemove={() => requestRemove(raw)}
                        saveStatus={saveStatus}
                      />
                    )}
                  </div>

                  <div
                    className="min-h-11 min-w-11 cursor-grab touch-none select-none px-2 pt-2 text-ink-secondary"
                    aria-hidden={expanded}
                    onPointerDown={(e) => {
                      if (expanded) return;
                      e.currentTarget.setPointerCapture(e.pointerId);
                      setDragFrom(index);
                      setDragOver(index);
                    }}
                    onPointerMove={(e) => {
                      if (dragFrom === null) return;
                      const heights = [...rowRefs.current.values()].map((el) => el.getBoundingClientRect().height);
                      const rowHeight = heights.length ? heights.reduce((a, b) => a + b, 0) / heights.length : 64;
                      const startEl = rowRefs.current.get(dragFrom);
                      if (!startEl) return;
                      const startTop = startEl.getBoundingClientRect().top;
                      const delta = e.clientY - startTop;
                      const offset = Math.round(delta / rowHeight);
                      const next = Math.min(plan.route.length - 1, Math.max(0, dragFrom + offset));
                      setDragOver(next);
                    }}
                    onPointerUp={() => {
                      if (dragFrom !== null && dragOver !== null && dragOver !== dragFrom) {
                        handleMove(dragFrom, dragOver);
                      }
                      setDragFrom(null);
                      setDragOver(null);
                    }}
                  >
                    ⠿
                  </div>
                </div>
              );
            })}
          </ul>

          <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
            <button type="button" onClick={() => setView("money")} className="min-h-11 underline">
              {/* B2139 — the links say what is behind them: "Money · CHF 120", "Links · 1". */}
              {t("studio.plan.list.moneyLink")}
              {(costs.items?.length ?? 0) > 0 &&
                ` · ${formatMoney((costs.items ?? []).reduce((sum, item) => sum + item.amount, 0), baseCurrency, locale)}`}
            </button>
            <button type="button" onClick={() => setView("links")} className="min-h-11 underline">
              {t("studio.plan.list.linksLink")}
              {linkCount > 0 && ` · ${new Intl.NumberFormat(locale).format(linkCount)}`}
            </button>
            {saveStatus === "failed" ? (
              <span role="alert" className="text-coral-600">{t("studio.plan.failed")}</span>
            ) : (
              <span role="status" className="text-action-strong">
                {saveStatus === "saving" && t("studio.plan.saving")}
                {saveStatus === "saved" && t("studio.plan.saved")}
          {saveStatus === "queued" && t("studio.plan.queued")}
              </span>
            )}
          </div>

          {removing && (
            <div className="mt-4">
              <ConfirmPanel
                label={t("studio.plan.list.remove.label")}
                question={
                  plan.route.length <= 1
                    ? t("studio.plan.list.remove.lastQuestion")
                    : t("studio.plan.list.remove.question", { stop: removing.location })
                }
                confirmLabel={t("studio.plan.list.remove.confirm")}
                tone="destructive"
                busy={removeBusy}
                onConfirm={() => void confirmRemove()}
                onCancel={() => setRemoving(null)}
              >
                {plan.route.length <= 1 && (
                  <textarea
                    value={declineReason}
                    onChange={(e) => setDeclineReason(e.target.value)}
                    placeholder={t("studio.plan.list.remove.reasonPlaceholder")}
                    className="mt-2 min-h-16 w-full rounded-xl border border-line-strong px-3 py-2 text-sm"
                  />
                )}
              </ConfirmPanel>
            </div>
          )}

          {undo && (
            <div className="mt-3 rounded-xl border border-line-strong bg-surface-subtle p-3 text-sm">
              <button type="button" onClick={doUndo} className="min-h-11 font-semibold text-action-strong underline">
                {t("studio.plan.list.undo")}
              </button>
            </div>
          )}
        </>
      )}

      {view === "money" && (
        <MoneyPanel
          costs={costs}
          route={plan.route}
          baseCurrency={baseCurrency}
          currencies={currencies}
          tripDays={Math.max(1, Math.round((Date.parse(plan.route.at(-1)?.leave ?? "") - Date.parse(tripStart)) / 86_400_000)) || undefined}
          onSave={(next) => void save(undefined, next)}
          onBack={() => setView("list")}
          saveStatus={saveStatus}
        />
      )}

      {view === "links" && (
        <LinksPanel
          plan={plan}
          onSave={(next) => void save(next)}
          onBack={() => setView("list")}
          onAddLink={() => setView("list")}
          saveStatus={saveStatus}
        />
      )}
    </>
  );
}

function StopEditor({
  stop,
  privateStop,
  costs,
  onChange,
  onSave,
  nightsStep,
  onUp,
  onDown,
  onRemove,
  saveStatus,
}: {
  stop: PlanStop;
  privateStop?: { stay?: { name: string; lat: number; lng: number }; links?: { label: string; url: string }[] };
  costs: { label: string; amount: number; currency?: string }[];
  onChange: (patch: Partial<PlanStop>) => void;
  onSave: () => void;
  nightsStep: (delta: number) => void;
  onUp?: () => void;
  onDown?: () => void;
  onRemove: () => void;
  saveStatus: SaveStatus;
}) {
  const { t, tn } = useI18n();
  const [note, setNote] = useState(stop.note ?? "");

  return (
    <div className="mt-2 flex flex-col gap-3 rounded-xl border border-line-faint p-3">
      <div className="inline-flex w-fit items-center rounded-full border border-line-strong">
        <button type="button" onClick={() => nightsStep(-1)} className="min-h-11 min-w-11 px-3 text-lg" aria-label="−">
          −
        </button>
        <span className="min-w-[6rem] text-center text-sm">
          {tn("studio.plan.confirm.nightCount", stop.nights ?? 0, { count: String(stop.nights ?? 0) })}
        </span>
        <button type="button" onClick={() => nightsStep(1)} className="min-h-11 min-w-11 px-3 text-lg" aria-label="+">
          +
        </button>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">{t("studio.plan.stop.everyone")}</p>
        <textarea
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
            onChange({ note: e.target.value || undefined });
          }}
          onBlur={onSave}
          placeholder={t("studio.plan.stop.notePlaceholder")}
          className="mt-1 min-h-11 w-full rounded-xl border border-line-strong px-3 py-2 text-sm"
        />
        <p className="mt-1 text-sm text-ink-secondary">
          {t("studio.plan.stop.toSee", { list: (stop.see ?? []).map((s) => s.name).join(", ") || t("studio.plan.stop.none") })}
        </p>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">{t("studio.plan.stop.private")}</p>
        <p className="text-sm text-ink-body">
          {privateStop?.stay ? t("studio.plan.stop.stay", { name: privateStop.stay.name }) : t("studio.plan.stop.noStay")}
        </p>
        <p className="text-sm text-ink-body">
          {t("studio.plan.stop.links", { count: String(privateStop?.links?.length ?? 0) })}
        </p>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">{t("studio.plan.stop.costs")}</p>
        {costs.length === 0 && <p className="text-sm text-ink-secondary">{t("studio.plan.stop.none")}</p>}
        {costs.map((c) => (
          <p key={c.label} className="text-sm text-ink-body">
            {c.label} · {c.amount} {c.currency ?? ""}
          </p>
        ))}
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">{t("studio.plan.stop.order")}</p>
        <div className="mt-1 flex gap-2">
          {onUp && (
            <button type="button" onClick={onUp} className="min-h-11 rounded-full border border-line-strong px-3 text-sm">
              {t("studio.plan.stop.up")}
            </button>
          )}
          {onDown && (
            <button type="button" onClick={onDown} className="min-h-11 rounded-full border border-line-strong px-3 text-sm">
              {t("studio.plan.stop.down")}
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-line-faint pt-2">
        {saveStatus === "failed" ? (
          <span role="alert" className="text-sm text-coral-600">{t("studio.plan.failed")}</span>
        ) : (
          <span role="status" className="text-sm text-action-strong">
            {saveStatus === "saving" && t("studio.plan.saving")}
            {saveStatus === "saved" && t("studio.plan.saved")}
          {saveStatus === "queued" && t("studio.plan.queued")}
          </span>
        )}
        <button type="button" onClick={onRemove} className="min-h-11 text-sm text-coral-600 underline">
          {t("studio.plan.stop.remove")}
        </button>
      </div>
    </div>
  );
}
