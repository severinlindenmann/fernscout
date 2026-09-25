"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/components/LocaleProvider";
import { useOnline } from "@/components/studio/useOnline";
import { COST_CATEGORIES, type CostCategory } from "@/lib/costFormat";
import { looksLikeStay, nearestStopIndex, nearestStopWithin, sequenceContext } from "@/lib/planner/schedule";
import type { ParsedThing, PlaceCandidate, PlanStop } from "@/lib/planner/types";
import type { TranslationKey } from "@/lib/i18n";

const KINDS = ["place", "coordinates", "link", "cost"] as const;
type Kind = (typeof KINDS)[number];

type Resolved = {
  name: string;
  lat: number;
  lng: number;
  country?: string;
  countryCode?: string;
  source: string;
  /** The full lookup label ("Matsuyama, Ehime Prefecture, Japan") when the
   * name is its first segment — shown under the name, never stored. */
  label?: string;
};

export type StopOutcome =
  | { action: "visit"; stopId: string; place: Resolved }
  | { action: "newStop"; place: Resolved; insertAt: number; nights?: number }
  | { action: "stay"; stopId: string; place: Resolved }
  | { action: "cost"; label: string; amount: number; currency: string; category: CostCategory; stopId?: string }
  | { action: "link"; label: string; url: string; stopId?: string };

const DEBOUNCE_MS = 350;

/** OSM answers the same label more than once (a town and its admin area);
 * one row per label — B2086. */
export function uniqueCandidates(list: PlaceCandidate[]): PlaceCandidate[] {
  const seen = new Set<string>();
  return list.filter((c) => !seen.has(c.displayName) && Boolean(seen.add(c.displayName)));
}

function guessCategory(text: string): CostCategory | undefined {
  const words: string[] = text.toLowerCase().match(/[\p{L}]+/gu) ?? [];
  const map: Partial<Record<CostCategory, string[]>> = {
    flights: ["flight", "flights"],
    accommodation: ["hotel", "hotels", "hostel"],
    transport: ["train", "trains", "bus", "taxi"],
  };
  for (const cat of COST_CATEGORIES) {
    if ((map[cat] ?? []).some((w) => words.includes(w))) return cat;
  }
  return undefined;
}

/**
 * B2011's paste-first composer — one box that takes a place, a link, a cost
 * or coordinates, reads it through B2010's classifier before anything is
 * written, and hands a finished `StopOutcome` up once the person confirms.
 * Nothing here writes; `PlannerFlow` owns the route/costs/links state and
 * the one PATCH every confirmed outcome goes through.
 */
export default function Composer({
  username,
  route,
  lastCurrency,
  currencies,
  onCommit,
}: {
  username: string;
  route: PlanStop[];
  lastCurrency: string;
  /** The journal's currencies, base first — the only codes offered (B2143). */
  currencies: string[];
  onCommit: (outcome: StopOutcome) => void;
}) {
  const { t, tn } = useI18n();
  const online = useOnline();
  const [text, setText] = useState("");
  const [hintKind, setHintKind] = useState<Kind | null>(null);
  const [parsed, setParsed] = useState<ParsedThing | null>(null);
  const [overrideKind, setOverrideKind] = useState<Kind | null>(null);
  const [candidates, setCandidates] = useState<PlaceCandidate[]>([]);
  const [pasteHint, setPasteHint] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Composer-local fields, reset whenever the text changes meaningfully.
  const [name, setName] = useState("");
  const [linkTarget, setLinkTarget] = useState<string | null>(null); // stop id or null (trip)
  const [costLabel, setCostLabel] = useState("");
  const [costAmount, setCostAmount] = useState("");
  const [costCurrency, setCostCurrency] = useState(lastCurrency);
  const [costCategory, setCostCategory] = useState<CostCategory>("other");
  const [costTarget, setCostTarget] = useState<string | null>(null);

  // Confirm step (place kinds only).
  const [confirming, setConfirming] = useState<Resolved | null>(null);
  const [confirmChoice, setConfirmChoice] = useState<"visit" | "newStop" | "stay" | "seeElsewhere">("visit");
  const [insertAt, setInsertAt] = useState(route.length);
  const [nights, setNights] = useState(1);

  useEffect(() => {
    // B2330 — reading a pasted place or link, and the place search below,
    // both need a live lookup; offline they only ever come back empty. The
    // input itself is greyed out with one line why (see the render below)
    // rather than left to look like it works and then answer nothing.
    if (!online) return;
    const trimmed = text.trim();
    if (trimmed === "") {
      // Deferred a tick, same reason `LocationFlow.tsx`'s own `arm` timer
      // is: a synchronous setState inside an effect body is a lint error
      // (react-hooks/set-state-in-effect) even when it is exactly what
      // clearing a stale preview requires.
      const clear = setTimeout(() => {
        setParsed(null);
        setCandidates([]);
      }, 0);
      return () => clearTimeout(clear);
    }
    const id = setTimeout(() => {
      fetch(`/api/helper/${encodeURIComponent(username)}/plan/read`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: trimmed }),
      })
        .then((r) => r.json())
        .then((json: ParsedThing) => {
          setParsed(json);
          setOverrideKind(json.kind === "place-query" ? "place" : (json.kind as Kind));
          if (json.kind === "cost") {
            setCostLabel(json.label);
            setCostAmount(String(json.amount));
            // Only a code the journal keeps — anything else stays on the last one.
            if (json.currency && currencies.includes(json.currency)) setCostCurrency(json.currency);
            setCostCategory(json.category ?? guessCategory(json.label) ?? "other");
          }
          if (json.kind === "link") {
            setName(json.title ?? "");
          }
          if (json.kind === "coordinates") {
            setName("");
          }
        })
        .catch(() => setParsed(null));
      if (trimmed.length >= 3) {
        fetch(`/api/helper/${encodeURIComponent(username)}/plan/search?q=${encodeURIComponent(trimmed)}`)
          .then((r) => r.json())
          .then((json: { results?: PlaceCandidate[] }) => setCandidates(json.results ?? []))
          .catch(() => setCandidates([]));
      } else {
        setCandidates([]);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(id);
  }, [text, username, currencies]);

  async function doPaste() {
    try {
      const clip = await navigator.clipboard.readText();
      setText(clip);
      setPasteHint(false);
    } catch {
      setPasteHint(true);
      inputRef.current?.focus();
    }
  }

  function pickCandidate(c: PlaceCandidate) {
    // B2086: the stop is "Matsuyama", not the whole OSM label.
    startConfirm({
      name: c.displayName.split(",")[0].trim() || c.displayName,
      label: c.displayName,
      lat: c.lat,
      lng: c.lon,
      country: c.country,
      countryCode: c.countryCode,
      source: "typed",
    });
  }

  function startConfirm(place: Resolved, kmThreshold?: number) {
    const near = nearestStopWithin(route, place, kmThreshold);
    const hotel = looksLikeStay(place.name);
    setConfirming(place);
    if (near) {
      setConfirmChoice(hotel ? "stay" : "visit");
      setCostTarget(near.id ?? null);
    } else {
      setConfirmChoice(hotel ? "stay" : "newStop");
      const idx = nearestStopIndex(route, place);
      setInsertAt(idx === null ? route.length : idx + 1);
      setNights(1);
    }
  }

  function reset() {
    setText("");
    setParsed(null);
    setOverrideKind(null);
    setCandidates([]);
    setConfirming(null);
    setName("");
    setCostLabel("");
    setCostAmount("");
    setCostCategory("other");
    setLinkTarget(null);
  }

  function commitCost() {
    const amount = Number(costAmount);
    if (!Number.isFinite(amount) || amount <= 0 || costLabel.trim() === "") return;
    onCommit({ action: "cost", label: costLabel.trim(), amount, currency: costCurrency, category: costCategory, stopId: costTarget ?? undefined });
    reset();
  }

  function commitLink() {
    if (parsed?.kind !== "link") return;
    // B2086: the title is optional — an untitled link is named by its host.
    let label = name.trim();
    if (label === "") {
      try {
        label = new URL(parsed.url).hostname;
      } catch {
        label = parsed.url;
      }
    }
    onCommit({ action: "link", label, url: parsed.url, stopId: linkTarget ?? undefined });
    reset();
  }

  function commitConfirm() {
    if (!confirming) return;
    if (confirmChoice === "visit" || confirmChoice === "seeElsewhere") {
      const near = nearestStopWithin(route, confirming);
      if (!near?.id) return;
      onCommit({ action: "visit", stopId: near.id, place: confirming });
    } else if (confirmChoice === "stay") {
      const targetId = costTarget ?? nearestStopWithin(route, confirming)?.id ?? route[route.length - 1]?.id;
      if (!targetId) return;
      onCommit({ action: "stay", stopId: targetId, place: confirming });
    } else {
      onCommit({ action: "newStop", place: confirming, insertAt, nights });
    }
    reset();
  }

  const near = confirming ? nearestStopWithin(route, confirming) : null;
  const seq = confirming && confirmChoice === "newStop" ? sequenceContext(route, insertAt) : null;

  // "A duplicate place is flagged before adding" — never blocked, only
  // said, same as a mode-switch gap: a stop already named the same thing,
  // or a "see" entry already on the target stop's own list.
  const duplicateName = confirming
    ? confirmChoice === "newStop"
      ? route.find((s) => s.location.trim().toLowerCase() === confirming.name.trim().toLowerCase())?.location
      : (near?.see ?? []).find((s) => s.name.trim().toLowerCase() === confirming.name.trim().toLowerCase())?.name
    : undefined;

  return (
    <div className="rounded-2xl border border-line-strong p-4">
      {!confirming && (
        <>
          {/* B2137: Paste fills the box, it adds nothing — a normal-sized
              control before it ("Paste", "or type a place…"), not a
              full-width navy primary. Each kind's own add button below
              stays the screen's one commit. */}
          <div className={`flex gap-2 ${online ? "" : "opacity-60"}`}>
            <button
              type="button"
              disabled={!online}
              onClick={() => void doPaste()}
              className="min-h-11 flex-none rounded-full border border-line-strong px-4 text-sm font-semibold text-ink-strong hover:bg-surface-subtle disabled:pointer-events-none"
            >
              {t("studio.plan.composer.paste")}
            </button>
            <input
              ref={inputRef}
              type="text"
              value={text}
              disabled={!online}
              onChange={(e) => setText(e.target.value)}
              placeholder={t("studio.plan.composer.placeholder")}
              className="min-h-11 min-w-0 flex-1 rounded-xl border border-line-strong px-3 text-base disabled:bg-surface-subtle"
            />
          </div>
          {!online && <p className="mt-1.5 text-sm text-ink-secondary">{t("studio.plan.composer.offline")}</p>}
          {pasteHint && <p role="alert" className="mt-1.5 text-sm text-coral-600">{t("studio.plan.composer.pasteHint")}</p>}

          {!parsed && (
          <>
          <p className="mt-3 text-xs font-semibold uppercase tracking-wide text-ink-secondary">
            {t("studio.plan.composer.addA")}
          </p>
          <div className="mt-1 flex flex-wrap gap-2">
            {KINDS.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setHintKind(k)}
                aria-pressed={hintKind === k}
                className={`min-h-11 rounded-full border px-4 text-sm font-semibold ${
                  hintKind === k ? "border-ink-strong bg-surface-subtle" : "border-line-strong text-ink-secondary"
                }`}
              >
                {t(`studio.plan.composer.kind.${k}` as TranslationKey)}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-ink-secondary">{t("studio.plan.composer.hint")}</p>
          </>
          )}

          {parsed && overrideKind && (
            <div className="mt-3 rounded-xl border border-line-strong bg-surface-subtle p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-ink-secondary">
                  {t(`studio.plan.composer.source.${parsed.kind}` as TranslationKey)}
                </span>
                <select
                  aria-label={t("studio.plan.composer.typeLabel")}
                  value={overrideKind}
                  onChange={(e) => setOverrideKind(e.target.value as Kind)}
                  className="min-h-11 rounded-full border border-line-strong bg-surface-base px-2 text-sm"
                >
                  {KINDS.map((k) => (
                    <option key={k} value={k}>
                      {t(`studio.plan.composer.kind.${k}` as TranslationKey)}
                    </option>
                  ))}
                </select>
              </div>

              {overrideKind === "place" && parsed.kind === "place" && (
                <>
                  <p className="mt-2 font-display text-base font-semibold text-ink-strong">
                    {parsed.name ?? t("studio.plan.composer.unnamed")}
                  </p>
                  <p className="font-mono text-xs text-ink-secondary">
                    {parsed.lat.toFixed(4)}, {parsed.lng.toFixed(4)}
                    {parsed.country ? ` · ${parsed.country}` : ""}
                  </p>
                  <button
                    type="button"
                    onClick={() =>
                      startConfirm({
                        name: parsed.name ?? text.trim(),
                        lat: parsed.lat,
                        lng: parsed.lng,
                        country: parsed.country,
                        countryCode: parsed.countryCode,
                        source: parsed.source,
                      })
                    }
                    className="mt-2 min-h-11 rounded-full bg-action-strong px-5 text-sm font-semibold text-on-action"
                  >
                    {t("studio.plan.composer.continue")}
                  </button>
                </>
              )}

              {overrideKind === "place" && parsed.kind === "place-query" && (
                <div className="mt-2 flex flex-col gap-1">
                  {candidates.length === 0 && (
                    <p className="text-sm text-ink-secondary">{t("studio.plan.composer.searching")}</p>
                  )}
                  {uniqueCandidates(candidates).slice(0, 5).map((c, i) => (
                    <button
                      key={`${c.displayName}-${i}`}
                      type="button"
                      onClick={() => pickCandidate(c)}
                      className="min-h-11 rounded-lg border border-line-strong px-3 py-2 text-left text-sm hover:bg-surface-subtle"
                    >
                      <span className="font-semibold text-ink-strong">{c.displayName}</span>
                      {c.country && !c.displayName.endsWith(c.country) && (
                        <span className="text-ink-secondary"> · {c.country}</span>
                      )}
                    </button>
                  ))}
                  <p className="mt-1 text-xs text-ink-secondary">{t("studio.plan.composer.attribution")}</p>
                </div>
              )}

              {overrideKind === "coordinates" && (parsed.kind === "coordinates" || parsed.kind === "place") && (
                <div className="mt-2">
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t("studio.plan.composer.nameRequired")}
                    className="min-h-11 w-full rounded-xl border border-line-strong px-3 text-base"
                  />
                  <p className="mt-1 font-mono text-xs text-ink-secondary">
                    {parsed.lat.toFixed(4)}, {parsed.lng.toFixed(4)}
                    {parsed.country ? ` · ${parsed.country}` : ""}
                  </p>
                  <button
                    type="button"
                    disabled={name.trim() === ""}
                    onClick={() =>
                      startConfirm({
                        name: name.trim(),
                        lat: parsed.lat,
                        lng: parsed.lng,
                        country: parsed.country,
                        countryCode: parsed.countryCode,
                        source: "coordinates",
                      })
                    }
                    className="mt-2 min-h-11 rounded-full bg-action-strong px-5 text-sm font-semibold text-on-action disabled:opacity-50"
                  >
                    {t("studio.plan.composer.continue")}
                  </button>
                </div>
              )}

              {overrideKind === "link" && parsed.kind === "link" && (
                <div className="mt-2">
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t("studio.plan.composer.linkTitle")}
                    className="min-h-11 w-full rounded-xl border border-line-strong px-3 text-base"
                  />
                  <p className="mt-1 text-xs text-ink-secondary">{t("studio.plan.composer.goesOn")}</p>
                  <div className="mt-1 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setLinkTarget(null)}
                      aria-pressed={linkTarget === null}
                      className={`min-h-11 rounded-full border px-3 text-sm ${linkTarget === null ? "border-ink-strong bg-surface-subtle" : "border-line-strong"}`}
                    >
                      {t("studio.plan.tripLevel")}
                    </button>
                    {route.map((s) => (
                      <button
                        key={s.id ?? s.location}
                        type="button"
                        onClick={() => setLinkTarget(s.id ?? null)}
                        aria-pressed={linkTarget === s.id}
                        className={`min-h-11 rounded-full border px-3 text-sm ${linkTarget === s.id ? "border-ink-strong bg-surface-subtle" : "border-line-strong"}`}
                      >
                        {s.location}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={commitLink}
                    className="mt-2 min-h-11 rounded-full bg-action-strong px-5 text-sm font-semibold text-on-action disabled:opacity-50"
                  >
                    {t("studio.plan.composer.addLink")}
                  </button>
                </div>
              )}

              {overrideKind === "cost" && (
                <div className="mt-2">
                  <div className="flex gap-2">
                    <input
                      type="number"
                      value={costAmount}
                      onChange={(e) => setCostAmount(e.target.value)}
                      className="min-h-11 w-28 rounded-xl border border-line-strong px-3 text-base"
                    />
                    <select
                      value={costCurrency}
                      onChange={(e) => setCostCurrency(e.target.value)}
                      aria-label={t("studio.plan.money.currency")}
                      className="min-h-11 w-24 rounded-xl border border-line-strong bg-surface-base px-3 text-base"
                    >
                      {currencies.map((code) => (
                        <option key={code} value={code}>
                          {code}
                        </option>
                      ))}
                    </select>
                  </div>
                  <input
                    type="text"
                    value={costLabel}
                    onChange={(e) => setCostLabel(e.target.value)}
                    placeholder={t("studio.plan.money.whatFor")}
                    className="mt-2 min-h-11 w-full rounded-xl border border-line-strong px-3 text-base"
                  />
                  <div className="mt-2 flex flex-wrap gap-2">
                    {COST_CATEGORIES.map((cat) => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setCostCategory(cat)}
                        aria-pressed={costCategory === cat}
                        className={`min-h-11 rounded-full border px-3 text-sm ${
                          costCategory === cat ? "border-ink-strong bg-surface-subtle" : "border-line-strong"
                        }`}
                      >
                        {t(`cost.cat.${cat}` as TranslationKey)}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={commitCost}
                    disabled={costLabel.trim() === "" || !Number.isFinite(Number(costAmount)) || Number(costAmount) <= 0}
                    className="mt-2 min-h-11 rounded-full bg-action-strong px-5 text-sm font-semibold text-on-action disabled:opacity-50"
                  >
                    {t("studio.plan.composer.addCost")}
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {confirming && (
        <div className="rounded-xl border border-line-strong bg-surface-subtle p-3">
          <p className="font-display text-base font-semibold text-ink-strong">{confirming.name}</p>
          {confirming.label && confirming.label !== confirming.name && (
            <p className="text-sm text-ink-secondary">{confirming.label}</p>
          )}
          <p className="font-mono text-xs text-ink-secondary">
            {confirming.lat.toFixed(4)}, {confirming.lng.toFixed(4)}
            {confirming.country ? ` · ${confirming.country}` : ""} · {t(`studio.plan.composer.source.${confirming.source === "typed" ? "place-query" : confirming.source === "coordinates" ? "coordinates" : "place"}` as TranslationKey)}
          </p>
          <svg
            aria-hidden
            viewBox="0 0 240 70"
            className="mt-2 w-full rounded-lg"
          >
            <rect width="240" height="70" fill="#8fe0ef" rx="8" />
            <circle cx="120" cy="36" r="6" fill="#ffd23f" stroke="#1e293b" strokeWidth="1.5" />
          </svg>

          {near && confirmChoice !== "newStop" && (
            <>
              <p className="mt-2 text-sm text-ink-body">
                {t("studio.plan.confirm.insideStop", { stop: near.location })}
              </p>
              <div className="mt-1 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmChoice(looksLikeStay(confirming.name) ? "stay" : "visit")}
                  aria-pressed={confirmChoice === "visit" || confirmChoice === "stay"}
                  className={`min-h-11 rounded-full border px-3 text-sm ${
                    confirmChoice === "visit" || confirmChoice === "stay" ? "border-ink-strong bg-surface-base" : "border-line-strong"
                  }`}
                >
                  {looksLikeStay(confirming.name)
                    ? t("studio.plan.confirm.sleepIn", { stop: near.location })
                    : t("studio.plan.confirm.visitIn", { stop: near.location })}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmChoice("newStop")}
                  aria-pressed={(confirmChoice as string) === "newStop"}
                  className={`min-h-11 rounded-full border px-3 text-sm ${
                    (confirmChoice as string) === "newStop" ? "border-ink-strong bg-surface-base" : "border-line-strong"
                  }`}
                >
                  {looksLikeStay(confirming.name) ? t("studio.plan.confirm.placeToVisit") : t("studio.plan.confirm.ownStop")}
                </button>
              </div>
            </>
          )}

          {confirmChoice === "newStop" && seq && (
            <>
              <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-ink-secondary">
                {t("studio.plan.confirm.whereInRoute")}
              </p>
              <p className="text-sm text-ink-body">
                {seq.before && `${seq.before} → `}
                <b>{confirming.name}</b>
                {seq.after && ` → ${seq.after}`}
              </p>
              <div className="mt-1 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setInsertAt((n) => Math.max(0, n - 1))}
                  className="min-h-11 rounded-full border border-line-strong px-3 text-sm"
                >
                  {t("studio.plan.confirm.changePosition")}
                </button>
              </div>
              <p className="mt-2 text-xs font-semibold uppercase tracking-wide text-ink-secondary">
                {t("studio.plan.confirm.nights")}
              </p>
              <div className="mt-1 inline-flex items-center rounded-full border border-line-strong">
                <button
                  type="button"
                  onClick={() => setNights((n) => Math.max(1, n - 1))}
                  className="min-h-11 min-w-11 px-3 text-lg"
                  aria-label={t("studio.plan.confirm.fewerNights")}
                >
                  −
                </button>
                <span className="min-w-[6rem] text-center text-sm">
                  {tn("studio.plan.confirm.nightCount", nights, { count: String(nights) })}
                </span>
                <button
                  type="button"
                  onClick={() => setNights((n) => n + 1)}
                  className="min-h-11 min-w-11 px-3 text-lg"
                  aria-label={t("studio.plan.confirm.moreNights")}
                >
                  +
                </button>
              </div>
            </>
          )}

          {duplicateName && (
            <p role="alert" className="mt-2 text-sm text-coral-600">{t("studio.plan.confirm.duplicate", { name: duplicateName })}</p>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={commitConfirm}
              className="min-h-11 rounded-full bg-action-strong px-5 text-sm font-semibold text-on-action"
            >
              {confirmChoice === "newStop"
                ? t("studio.plan.confirm.addStop")
                : confirmChoice === "stay"
                  ? t("studio.plan.confirm.saveStay", { stop: near?.location ?? "" })
                  : t("studio.plan.confirm.addVisit", { stop: near?.location ?? "" })}
            </button>
            <button
              type="button"
              onClick={reset}
              className="min-h-11 rounded-full border border-line-strong px-5 text-sm font-semibold text-ink-body"
            >
              {t("studio.plan.confirm.notThis")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
