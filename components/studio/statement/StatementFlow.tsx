"use client";

import { useState } from "react";
import StepPrimary from "@/components/studio/StepPrimary";
import SubmitError from "@/components/studio/SubmitError";
import { useI18n } from "@/components/LocaleProvider";
import WhatStep from "@/components/studio/WhatStep";
import StepIndicator from "@/components/extract/StepIndicator";
import DecideList from "@/components/studio/DecideList";
import DoneScreen from "@/components/studio/DoneScreen";
import { PhotoPicker } from "@/components/PhotoPicker";
import { COST_CATEGORIES } from "@/lib/costFormat";
import { costRowsFrom, groupByMerchant, guessMapping, leftOutCount } from "@/lib/studio/statementDecide";
import { useStep } from "@/lib/studio/useStep";
import { useSkipIntro } from "@/lib/studio/fromHub";
import type { TranslationKey } from "@/lib/i18n";
import type { DateFormat } from "@/importers/costs/mapping";
import type { MerchantGroup, SpendingRow } from "./types";
import StepBody from "@/components/studio/StepBody";
import StatementSample from "./StatementSample";

/** The screens a person counts, in `?step=` (B2079, B2083): which trip,
 *  the file, what was read (the column mapping for a bank nothing here
 *  knows is the same step), a category per merchant, and the check before
 *  the write. Done is the write's outcome, not a step. */
const STEPS = ["trip", "get", "read", "sort", "decide"] as const;

type InboxItem = { id: string; filename: string };
type InboxUploadResponse = { ok?: true; items?: InboxItem[]; error?: string };

type ApplyReadResponse = {
  ok?: true;
  format?: string;
  label?: string;
  unrecognized?: true;
  header?: string[];
  sample?: string[][];
  read?: number;
  outside?: number;
  wrongSign?: number;
  spending?: SpendingRow[];
  truncated?: number;
  error?: string;
};

type ApplyWriteResponse = {
  ok?: true;
  written?: {
    written: { date: string; slug: string; added: number; kept: number }[];
    filedToTrip: { date: string; rows: number }[];
    total: number;
  };
  filedToTrip?: number;
  error?: string;
};

const DATE_FORMATS: DateFormat[] = ["YYYY-MM-DD", "DD/MM/YYYY", "MM/DD/YYYY", "DD.MM.YYYY", "MMM D, YYYY", "D MMM YYYY"];

const READ_ERROR_KEYS: Record<string, TranslationKey> = {
  unreadable: "studio.statement.error.unreadable",
  bad_mapping: "studio.statement.error.badMapping",
  not_a_table: "studio.statement.error.notATable",
  unknown_inbox_file: "studio.statement.error.generic",
  unknown_trip: "studio.statement.error.generic",
};

/**
 * "A bank statement" — B1822, spec §7.7. The parsers are real
 * (`importers/costs/`) and `lib/statements/apply.ts` does the write; the gap
 * this closes is the decide step, the only screen the ticket names as
 * missing.
 *
 * **Nothing is written before `decide`'s own button.** Both the free read
 * (`peek`) and the manual-mapping screen for an unrecognised bank only ever
 * call `.../statement/apply` without `rows` — a read, never a write. The
 * final press sends the merchant-agreed rows, once.
 *
 * **D10** is handled entirely server-side (`lib/statements/apply.ts`'s own
 * `fileToTripCosts`, shared with the v2 API's `costs/apply` since B1844) —
 * this component only reads `filedToTrip` back and says so on the done
 * screen.
 */
export default function StatementFlow({
  username,
  trips,
  defaultTripId,
  currencies,
}: {
  username: string;
  /** `costsPublic` — the trip's own costs.visibility, so the done screen
   *  says truthfully who sees the money (B2130). */
  trips: { id: string; title: string; costsPublic: boolean }[];
  defaultTripId: string | null;
  /** `journalCurrencies` (`lib/rates.ts`), base first — the whole-file
   *  currency is chosen from these only (B2143). */
  currencies: string[];
}) {
  const { t, tn, formatShortDate, locale } = useI18n();
  // B2139 — amounts in the reader's own number format (12,40 in German).
  const money = (amount: number) => new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
  const [tripId, setTripId] = useState(defaultTripId ?? trips[0]?.id ?? "");

  const [file, setFile] = useState<File | null>(null);
  const [inboxId, setInboxId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<TranslationKey | null>(null);
  const [skipLines, setSkipLines] = useState(0);

  // C2✗ — the manual mapping a person points at for a bank nothing here
  // recognises. Free: no model, no credit (see the apply route's own note).
  const [header, setHeader] = useState<string[]>([]);
  const [sample, setSample] = useState<string[][]>([]);
  const [dateCol, setDateCol] = useState("");
  const [amountCol, setAmountCol] = useState("");
  const [descCol, setDescCol] = useState("");
  const [currencyCol, setCurrencyCol] = useState("");
  const [fixedCurrency, setFixedCurrency] = useState("");
  const [dateFormat, setDateFormat] = useState<DateFormat>("DD.MM.YYYY");
  const [decimalComma, setDecimalComma] = useState(false);
  const [outgoingPositive, setOutgoingPositive] = useState(false);
  // Set once a mapping was confirmed, so the peek screen can read the file
  // again with the sign flipped (B2056). A bank the repository knows has
  // its own parser and no mapping to flip.
  const [mapped, setMapped] = useState(false);

  const [readResult, setReadResult] = useState<ApplyReadResponse | null>(null);
  const [groups, setGroups] = useState<MerchantGroup[]>([]);

  const [writeBusy, setWriteBusy] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [result, setResult] = useState<ApplyWriteResponse | null>(null);

  // B2079 — the chosen trip, the mapping, what was read and every category
  // ride in the session draft, so a reload or Back keeps them. `set` trusts
  // only the shapes it expects.
  const { step: urlStep, total, go, back, reset } = useStep(STEPS, {
    flowId: `statement:${username}`,
    // B2136 (was B2079's `step`) — a reload or deep link past "get" with
    // nothing read to show (the draft could not be kept) lands on choosing
    // the file again, or on the column mapping when the header was read.
    complete: (s) => (s === "get" ? !!readResult || header.length > 0 : s === "read" ? !!readResult : true),
    draft: {
      get: () => ({
        tripId, inboxId, skipLines, header, sample, dateCol, amountCol, descCol, currencyCol, fixedCurrency,
        dateFormat, decimalComma, outgoingPositive, mapped, readResult, groups,
      }),
      set: (d) => {
        const str = (v: unknown, set: (s: string) => void) => typeof v === "string" && set(v);
        const bool = (v: unknown, set: (b: boolean) => void) => typeof v === "boolean" && set(v);
        if (typeof d.tripId === "string" && trips.some((tr) => tr.id === d.tripId)) setTripId(d.tripId);
        str(d.inboxId, setInboxId);
        if (typeof d.skipLines === "number") setSkipLines(d.skipLines);
        if (Array.isArray(d.header)) setHeader(d.header.filter((h): h is string => typeof h === "string"));
        if (Array.isArray(d.sample)) setSample(d.sample.filter((r): r is string[] => Array.isArray(r)));
        str(d.dateCol, setDateCol);
        str(d.amountCol, setAmountCol);
        str(d.descCol, setDescCol);
        str(d.currencyCol, setCurrencyCol);
        str(d.fixedCurrency, setFixedCurrency);
        if (DATE_FORMATS.includes(d.dateFormat as DateFormat)) setDateFormat(d.dateFormat as DateFormat);
        bool(d.decimalComma, setDecimalComma);
        bool(d.outgoingPositive, setOutgoingPositive);
        bool(d.mapped, setMapped);
        if (d.readResult && typeof d.readResult === "object") setReadResult(d.readResult as ApplyReadResponse);
        if (Array.isArray(d.groups)) setGroups(d.groups as MerchantGroup[]);
      },
    },
  });
  // B2141: from the hub, the flow opens on its first real step.
  const skipIntro = useSkipIntro();
  const step = urlStep === "trip" && skipIntro && trips.length <= 1 ? "get" : urlStep;

  async function callRead(body: Record<string, unknown>): Promise<ApplyReadResponse | null> {
    const res = await fetch(`/api/helper/${encodeURIComponent(username)}/statement/apply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ trip: tripId, inbox: inboxId, skipLines, ...body }),
    });
    const json = (await res.json().catch(() => null)) as ApplyReadResponse | null;
    if (!res.ok || !json?.ok) {
      setError(mapReadError(json?.error));
      return null;
    }
    return json;
  }

  // ── upload → read ────────────────────────────────────────────────────
  async function readFile() {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append("files", file, file.name);
      const staged = await fetch(`/api/helper/${encodeURIComponent(username)}/inbox`, { method: "POST", body: form });
      const stagedJson = (await staged.json().catch(() => null)) as InboxUploadResponse | null;
      const item = stagedJson?.items?.[0];
      if (!staged.ok || !item) {
        setError("studio.statement.error.generic");
        return;
      }
      setInboxId(item.id);

      const res = await fetch(`/api/helper/${encodeURIComponent(username)}/statement/apply`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ trip: tripId, inbox: item.id, skipLines }),
      });
      const json = (await res.json().catch(() => null)) as ApplyReadResponse | null;
      if (!res.ok || !json?.ok) {
        setError(mapReadError(json?.error));
        return;
      }
      setReadResult(null);
      if (json.unrecognized) {
        const cols = json.header ?? [];
        const rows = json.sample ?? [];
        // B2083 — preselect what the header and sample say, currency
        // included; the person confirms or changes every one of them.
        const guess = guessMapping(cols, rows);
        setHeader(cols);
        setSample(rows);
        setDateCol(guess.date);
        setAmountCol(guess.amount);
        setDescCol(guess.description);
        setCurrencyCol(guess.currency);
        setDateFormat(guess.dateFormat);
        setDecimalComma(guess.decimalComma);
        setMapped(false);
        go("read");
        return;
      }
      setHeader([]);
      setMapped(false);
      landOnPeek(json);
      go("read");
    } finally {
      setBusy(false);
    }
  }

  function landOnPeek(json: ApplyReadResponse) {
    setReadResult(json);
    setGroups(groupByMerchant(json.spending ?? []));
  }

  // ── C2✗ — manual mapping ─────────────────────────────────────────────
  async function confirmMapping(flip = outgoingPositive) {
    setBusy(true);
    setError(null);
    try {
      const json = await callRead({
        mapping: {
          date: dateCol,
          amount: amountCol,
          description: descCol,
          currency: currencyCol || undefined,
          fixedCurrency: fixedCurrency || undefined,
          dateFormat,
          decimalComma,
          outgoingPositive: flip,
        },
      });
      if (json) {
        setOutgoingPositive(flip);
        setMapped(true);
        landOnPeek(json);
      }
    } finally {
      setBusy(false);
    }
  }

  // ── C2 — decide, bulk-assign by merchant ─────────────────────────────
  function setCategory(merchant: string, category: string) {
    setGroups((prev) => prev.map((g) => (g.merchant === merchant ? { ...g, category } : g)));
  }
  function setLabel(merchant: string, label: string) {
    setGroups((prev) => prev.map((g) => (g.merchant === merchant ? { ...g, label } : g)));
  }

  async function commit() {
    const rows = costRowsFrom(groups);
    if (rows.length === 0) return;
    setWriteBusy(true);
    setWriteError(null);
    try {
      const res = await fetch(`/api/helper/${encodeURIComponent(username)}/statement/apply`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ trip: tripId, rows }),
      });
      const json = (await res.json().catch(() => null)) as ApplyWriteResponse | null;
      if (!res.ok || !json?.ok) {
        setWriteError(t("studio.statement.decide.error"));
        return;
      }
      setResult(json);
      reset();
    } catch {
      setWriteError(t("studio.statement.decide.error"));
    } finally {
      setWriteBusy(false);
    }
  }

  const tripTitle = trips.find((tr) => tr.id === tripId)?.title ?? tripId;
  const agreedRows = costRowsFrom(groups);
  const leftOut = leftOutCount(groups);
  // B2056 — lines read but not offered are said out loud, with the reason,
  // on both screens that show what was read.
  const outside = readResult?.outside ?? 0;
  const wrongSign = readResult?.wrongSign ?? 0;
  const notCounted =
    readResult && outside > 0 ? (
      <div className="mt-2 text-sm text-ink-body">
        <p className="font-semibold text-ink-strong">
          {tn("studio.statement.notCounted", readResult.read ?? 0, { read: String(readResult.read ?? 0), count: String(outside) })}
        </p>
        {wrongSign > 0 && <p className="mt-1">{t("studio.statement.notCounted.sign", { count: String(wrongSign) })}</p>}
        {outside > wrongSign && (
          <p className="mt-1">{t("studio.statement.notCounted.other", { count: String(outside - wrongSign) })}</p>
        )}
        {mapped && wrongSign > 0 && (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => void confirmMapping(!outgoingPositive)}
              className="mt-1 font-semibold underline underline-offset-2"
            >
              {t(
                outgoingPositive
                  ? "studio.statement.notCounted.unflip"
                  : "studio.statement.notCounted.flip",
              )}
            </button>
            {error && (
              <p role="alert" className="mt-1 text-sm text-coral-600">
                {t(error)}
              </p>
            )}
          </>
        )}
      </div>
    ) : null;
  const sumByCurrency = new Map<string, number>();
  for (const row of agreedRows) sumByCurrency.set(row.currency, (sumByCurrency.get(row.currency) ?? 0) + row.amount);

  const categoryName = (c: string) => t(`cost.cat.${c}` as TranslationKey);
  const mappingReady = !!dateCol && !!amountCol && !!descCol && (!!currencyCol || fixedCurrency.length === 3);
  const samplesOf = (col: string) => {
    const i = header.indexOf(col);
    return i < 0 ? [] : sample.map((row) => (row[i] ?? "").trim()).filter(Boolean).slice(0, 3);
  };

  return (
    <StepBody step={step}>
      {!result && step === "trip" && (
        <div className="mt-4">
          <StepIndicator total={total} current={1} label={t("studio.statement.what.stepLabel")} />
          {trips.length > 1 && (
            <label className="block text-xs font-semibold uppercase tracking-wide text-ink-secondary">
              {t("studio.statement.tripLabel")}
              <select
                value={tripId}
                onChange={(e) => setTripId(e.target.value)}
                className="mt-1 block min-h-11 w-full rounded-xl border border-line-strong bg-surface-base px-3 text-sm text-ink-body"
              >
                {trips.map((tr) => (
                  <option key={tr.id} value={tr.id}>
                    {tr.title}
                  </option>
                ))}
              </select>
            </label>
          )}
          <WhatStep
            inStudioBar
            title={t("studio.statement.what.title")}
            // B1900 — the flow's own <h1> above already announces this screen.
            hideHeading
            consequence={t("studio.statement.what.consequence")}
            cta={{ label: t("studio.statement.what.cta"), onContinue: () => go("get") }}
          />
          <StatementSample />
        </div>
      )}

      {!result && step === "get" && (
        <div className="mt-4">
          <StepIndicator total={total} current={2} label={t("studio.statement.upload.stepLabel")} />
          <h2 className="font-display text-lg font-semibold text-ink-strong">{t("studio.statement.upload.heading")}</h2>
          <p className="mt-2 text-sm text-ink-body">{t("studio.statement.upload.intro", { trip: tripTitle })}</p>

          <PhotoPicker
            id="statement-csv"
            accept=".csv,text/csv"
            chosen={file ? [file] : []}
            showChosen={!!file}
            onPick={(files) => setFile(files?.[0] ?? null)}
          />
          <StepPrimary busy={busy} disabled={!file} onClick={() => void readFile()} label={t("studio.statement.upload.button")} />
          {error && (
            <div className="mt-3">
              <p role="alert" className="text-sm text-coral-600">{t(error)}</p>
              {error === "studio.statement.error.notATable" && (
                <button
                  type="button"
                  onClick={() => {
                    setSkipLines((n) => n + 1);
                    setError(null);
                    void readFile();
                  }}
                  className="mt-1 min-h-11 text-sm font-semibold underline underline-offset-2"
                >
                  {t("studio.statement.upload.skipPreamble")}
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {!result && step === "read" && !readResult && header.length > 0 && (
        <div className="mt-4">
          <StepIndicator total={total} current={3} label={t("studio.statement.mapping.stepLabel")} />
          {/* B2139 — when every needed column was recognised from the
              headings this is a check, not an alarm. */}
          {dateCol && descCol && amountCol ? (
            <p className="rounded-xl border border-line-strong bg-surface-subtle px-4 py-3 text-sm text-ink-body">{t("studio.statement.mapping.guessed")}</p>
          ) : (
            <div className="rounded-xl border border-coral-300 bg-coral-50 px-4 py-3 text-sm text-ink-body">
              <p className="font-semibold text-ink-strong">{t("studio.statement.mapping.banner")}</p>
              <p className="mt-1">{t("studio.statement.mapping.detail")}</p>
            </div>
          )}

          <div className="mt-3 flex flex-col gap-3">
            <ColumnPicker label={t("studio.statement.mapping.date")} value={dateCol} onChange={setDateCol} header={header} samples={samplesOf(dateCol)} />
            <ColumnPicker label={t("studio.statement.mapping.what")} value={descCol} onChange={setDescCol} header={header} samples={samplesOf(descCol)} />
            <ColumnPicker label={t("studio.statement.mapping.amount")} value={amountCol} onChange={setAmountCol} header={header} samples={samplesOf(amountCol)} />
            <ColumnPicker
              label={t("studio.statement.mapping.currency")}
              value={currencyCol}
              onChange={setCurrencyCol}
              header={header}
              samples={samplesOf(currencyCol)}
              allowNone
            />
            {!currencyCol && (
              <label className="block text-xs font-semibold uppercase tracking-wide text-ink-secondary">
                {t("studio.statement.mapping.fixedCurrency")}
                <select
                  value={fixedCurrency}
                  onChange={(e) => setFixedCurrency(e.target.value)}
                  className="mt-1 block min-h-11 w-full rounded-xl border border-line-strong bg-surface-base px-3 text-sm text-ink-body"
                >
                  <option value="">—</option>
                  {currencies.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="block text-xs font-semibold uppercase tracking-wide text-ink-secondary">
              {t("studio.statement.mapping.dateFormat")}
              <select
                value={dateFormat}
                onChange={(e) => setDateFormat(e.target.value as DateFormat)}
                className="mt-1 block min-h-11 w-full rounded-xl border border-line-strong bg-surface-base px-3 text-sm text-ink-body"
              >
                {DATE_FORMATS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex min-h-11 items-center gap-2 text-sm text-ink-body">
              <input
                type="checkbox"
                checked={decimalComma}
                onChange={(e) => setDecimalComma(e.target.checked)}
                className="h-5 w-5"
              />
              {t("studio.statement.mapping.decimalComma")}
            </label>
            <label className="flex min-h-11 items-center gap-2 text-sm text-ink-body">
              <input
                type="checkbox"
                checked={outgoingPositive}
                onChange={(e) => setOutgoingPositive(e.target.checked)}
                className="h-5 w-5"
              />
              {t("studio.statement.mapping.outgoingPositive")}
            </label>
          </div>

          {/* B2083 — "read it again" only once there is something to read
              it with; before that the button says what is missing. */}
          <StepPrimary
            busy={busy}
            disabled={!mappingReady}
            onClick={() => void confirmMapping()}
            label={t(mappingReady ? "studio.statement.mapping.cta" : "studio.statement.mapping.ctaWaiting")}
          />
          <SubmitError message={error && t(error)} />
        </div>
      )}

      {!result && step === "read" && readResult && (
        <div className="mt-4">
          <StepIndicator total={total} current={3} label={t("studio.statement.peek.stepLabel")} />
          <h2 className="font-display text-lg font-semibold text-ink-strong">
            {tn("studio.statement.peek.heading", readResult.read ?? 0, { count: String(readResult.read ?? 0) })}
          </h2>
          {readResult.label && (
            <p className="mt-1 text-sm text-ink-body">{t("studio.statement.peek.knownBank", { label: readResult.label })}</p>
          )}
          {notCounted}
          <p className="mt-2 text-sm text-ink-secondary">{t("studio.statement.peek.notWritten")}</p>

          {(readResult.spending?.length ?? 0) > 0 && (
            <ul className="mt-3 divide-y divide-line-faint rounded-xl border border-line-strong">
              {(readResult.spending ?? []).slice(0, 12).map((row, i) => (
                <li key={i} className="flex items-center justify-between px-4 py-2 text-sm">
                  <span className="whitespace-nowrap text-ink-strong">{formatShortDate(row.date)}</span>
                  <span className="flex-1 truncate px-2 text-ink-body">{row.label}</span>
                  <span className="whitespace-nowrap font-mono text-ink-secondary">
                    {money(row.amount)} {row.currency}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {(readResult.spending?.length ?? 0) > 12 && (
            <p className="mt-1 text-xs text-ink-secondary">
              {t("studio.statement.peek.more", { count: String((readResult.spending?.length ?? 0) - 12) })}
            </p>
          )}
          {mapped && (
            <button
              type="button"
              onClick={() => setReadResult(null)}
              className="mt-3 block min-h-11 text-left text-sm font-semibold text-ink-body underline underline-offset-2"
            >
              {t("studio.statement.peek.remap")}
            </button>
          )}

          <StepPrimary disabled={groups.length === 0} onClick={() => go("sort")} label={t("studio.statement.peek.cta")} />
        </div>
      )}

      {!result && step === "sort" && (
        <div className="mt-4">
          <StepIndicator total={total} current={4} label={t("studio.statement.sort.stepLabel")} />
          <h2 className="font-display text-lg font-semibold text-ink-strong">{t("studio.statement.decide.heading")}</h2>
          <p className="mt-1 text-sm text-ink-secondary">{t("studio.statement.decide.fileTo", { trip: tripTitle })}</p>
          {notCounted}

          <div className="mt-3 flex flex-col gap-2">
            {groups.map((g) => (
              <div key={g.merchant} className="rounded-xl border border-line-strong px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <input
                    type="text"
                    value={g.label}
                    onChange={(e) => setLabel(g.merchant, e.target.value)}
                    className="min-w-0 flex-1 truncate border-b border-transparent bg-transparent text-sm font-semibold text-ink-strong focus:border-line-strong"
                  />
                  <span className="whitespace-nowrap font-mono text-xs text-ink-secondary">
                    {money(g.total)} {g.currency} · {g.rows.length}×
                  </span>
                </div>
                <select
                  value={g.category ?? ""}
                  onChange={(e) => setCategory(g.merchant, e.target.value)}
                  className="mt-2 min-h-11 rounded-full border border-line-strong bg-surface-base px-3 text-sm text-ink-body"
                >
                  <option value="" disabled>
                    {t("studio.statement.decide.pickCategory")}
                  </option>
                  {COST_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {categoryName(c)}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>

          {leftOut > 0 && (
            <p className="mt-3 text-sm text-ink-secondary">{tn("studio.statement.decide.leftOut", leftOut, { count: String(leftOut) })}</p>
          )}
          <StepPrimary disabled={agreedRows.length === 0} onClick={() => go("decide")} label={t("studio.statement.sort.cta")} />
        </div>
      )}

      {!result && step === "decide" && (
        <div className="mt-4">
          <StepIndicator total={total} current={5} label={t("studio.statement.decide.stepLabel")} />
          <h2 className="font-display text-lg font-semibold text-ink-strong">{t("studio.statement.check.heading")}</h2>
          <p className="mt-1 text-sm text-ink-secondary">{t("studio.statement.decide.fileTo", { trip: tripTitle })}</p>
          {/* B2083 — every line with its own date, so a person sees which
              day each cost lands on before anything is written. */}
          <DecideList
            rows={agreedRows.map((row) => ({
              label: `${formatShortDate(row.date)} · ${row.label}`,
              value: `${money(row.amount)} ${row.currency} · ${categoryName(row.category)}`,
              onEdit: back,
            }))}
            commitLabel={tn("studio.statement.decide.cta", agreedRows.length, { count: String(agreedRows.length), trip: tripTitle })}
            busy={writeBusy}
            onCommit={() => void commit()}
            inStudioBar
          />
          {leftOut > 0 && (
            <p className="mt-2 text-sm text-ink-secondary">{tn("studio.statement.decide.leftOut", leftOut, { count: String(leftOut) })}</p>
          )}
          <SubmitError message={writeError} />
        </div>
      )}

      {result?.written && (
        <>
          <DoneScreen
            username={username}
            done={`${tn("studio.statement.done.banner", agreedRows.length, { count: String(agreedRows.length), trip: tripTitle })} ${[
              ...sumByCurrency.entries(),
            ]
              .map(([currency, amount]) => `${money(amount)} ${currency}`)
              .join(" · ")}`}
            next={[
              {
                title: t("studio.statement.done.tripTitle", { trip: tripTitle }),
                body: t(trips.find((tr) => tr.id === tripId)?.costsPublic ? "studio.statement.done.public" : "studio.statement.done.private"),
                href: `/${username}/trips/${encodeURIComponent(tripId)}/costs`,
                label: t("studio.statement.done.seeTrip"),
              },
            ]}
          />
          <ul className="mt-4 divide-y divide-line-faint rounded-xl border border-line-strong">
            {result.written.written.map((w) => (
              <li key={w.slug} className="flex items-center justify-between px-4 py-2 text-sm">
                <span className="text-ink-strong">{formatShortDate(w.date)}</span>
                <span className="text-ink-secondary">{tn("studio.statement.done.landedOnDay", w.added, { count: String(w.added) })}</span>
              </li>
            ))}
            {/* B2139 — a cost with no day to land on is dated too, one row per date. */}
            {result.written.filedToTrip.map((f) => (
              <li key={f.date} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
                <span className="text-ink-strong">
                  {formatShortDate(f.date)} <span className="italic text-ink-secondary">· {t("studio.statement.done.noDay")}</span>
                </span>
                <span className="text-ink-secondary">{t("studio.statement.done.onTheTrip", { count: String(f.rows) })}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </StepBody>
  );
}

function ColumnPicker({
  label,
  value,
  onChange,
  header,
  samples,
  allowNone,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  header: string[];
  /** Up to three values of the chosen column, straight off the file — B2083. */
  samples: string[];
  allowNone?: boolean;
}) {
  return (
    <label className="block text-xs font-semibold uppercase tracking-wide text-ink-secondary">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 block min-h-11 w-full rounded-xl border border-line-strong bg-surface-base px-3 text-sm normal-case tracking-normal text-ink-body"
      >
        <option value="">{allowNone ? "—" : ""}</option>
        {header.map((h) => (
          <option key={h} value={h}>
            {h}
          </option>
        ))}
      </select>
      {samples.length > 0 && (
        <span className="mt-1 block truncate font-mono text-xs font-normal normal-case tracking-normal text-ink-secondary">
          {samples.join(" · ")}
        </span>
      )}
    </label>
  );
}

function mapReadError(code: string | undefined): TranslationKey {
  if (code && code in READ_ERROR_KEYS) return READ_ERROR_KEYS[code];
  return "studio.statement.error.generic";
}
