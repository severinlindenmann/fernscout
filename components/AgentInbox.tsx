"use client";

import { useState } from "react";
import ConfirmPanel from "@/components/ConfirmPanel";
import { useI18n } from "@/components/LocaleProvider";
import { COST_CATEGORIES, type CostCategory } from "@/lib/costFormat";
import { DATE_FORMATS, type ColumnMapping } from "@/importers/costs/mapping";
import type { InboxItem } from "@/lib/helper/server";
import type { WizardTrip } from "@/lib/helper/server";
import type { TranslationKey } from "@/lib/i18n";

/**
 * What is sitting in the inbox, and what each file could become — B689.
 *
 * Two files people actually have, and both are worth more to a journal than
 * anything they can type: a location export, and a bank statement. The screen
 * is one list and two flows, and the difference between them is the whole
 * point of the plan's Regelwerk:
 *
 * - **A location export costs nothing and asks nobody.** `importers/gps/`
 *   recognises it, code reads it, the fixes land in `gps/` and no route can
 *   read them back. There is no button here with a price on it.
 * - **A statement a bank we know wrote costs nothing either** —
 *   `importers/costs/` has its parser.
 * - **A statement nothing recognises is the one model call in this feature**,
 *   and it is one call for the whole file: the header row and five sample rows
 *   go out, a column mapping comes back, and this software applies it to every
 *   row. The mapping is shown with a preview of what the first rows become,
 *   and nothing is written until somebody has looked at it.
 *
 * **No category is ever chosen for anybody.** The last step is a picker per
 * row with nothing selected, and a row nobody categorises is a row nobody
 * writes — the same rule `importers/costs/schema.ts` states and the reason a
 * statement has always been two calls rather than one.
 */

type Offer = InboxItem["offer"];
type Row = { date: string; label: string; amount: number; currency: string };

type Read = {
  /** Absent when a known importer read it — then there is nothing to correct. */
  mapping?: ColumnMapping;
  header: string[];
  notes: string[];
  preview: Row[];
  format?: string;
};

const NONE = "";

export default function AgentInbox({
  username,
  items,
  trips,
  helper,
}: {
  username: string;
  items: InboxItem[];
  trips: WizardTrip[];
  helper: { enabled: boolean; consented: boolean; credits: number };
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [said, setSaid] = useState("");
  const [consenting, setConsenting] = useState(false);
  const [consented, setConsented] = useState(helper.consented);
  const [read, setRead] = useState<Read | null>(null);
  const [trip, setTrip] = useState(trips[0]?.id ?? "");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [categories, setCategories] = useState<Record<number, string>>({});
  const [removing, setRemoving] = useState<string | null>(null);
  const [gone, setGone] = useState<string[]>([]);

  const base = `/api/helper/${encodeURIComponent(username)}`;

  async function post(url: string, body: unknown): Promise<Record<string, unknown>> {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) throw new Error(String(json.error ?? response.status));
    return json;
  }

  function reset(id: string | null) {
    setOpen(id);
    setRead(null);
    setRows(null);
    setCategories({});
    setSaid("");
    setError("");
  }

  async function run(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await work();
    } catch (thrown) {
      setError(t("agent.failed", { error: (thrown as Error).message }));
    } finally {
      setBusy(false);
    }
  }

  const importGps = (id: string) =>
    run(async () => {
      const body = await post(`${base}/import`, { inbox: id });
      setSaid(
        t("agent.inboxGpsDone", {
          count: String(body.read ?? 0),
          from: String(body.from ?? "").slice(0, 10),
          to: String(body.to ?? "").slice(0, 10),
        }),
      );
    });

  const drawTrack = () =>
    run(async () => {
      const body = await post(`${base}/import`, { trip });
      const track = (body.track ?? {}) as { points?: number; segments?: number; written?: boolean };
      setSaid(
        track.written
          ? t("agent.inboxDrawn", {
              points: String(track.points ?? 0),
              segments: String(track.segments ?? 0),
            })
          : t("agent.inboxDrawnNone"),
      );
    });

  const readColumns = (id: string) =>
    run(async () => {
      const body = await post(`${base}/statement`, { inbox: id, idempotency_key: id });
      setRead({
        mapping: body.mapping as ColumnMapping | undefined,
        header: (body.header ?? []) as string[],
        notes: (body.notes ?? []) as string[],
        preview: (body.preview ?? []) as Row[],
        format: typeof body.format === "string" ? body.format : undefined,
      });
    });

  const readWholeFile = (id: string) =>
    run(async () => {
      const body = await post(`${base}/statement/apply`, {
        inbox: id,
        trip,
        mapping: read?.mapping,
        format: read?.format,
      });
      setRows((body.spending ?? []) as Row[]);
      setCategories({});
    });

  const write = () =>
    run(async () => {
      const chosen = (rows ?? [])
        .map((row, index) => ({ ...row, category: categories[index] }))
        .filter((row) => row.category !== undefined && row.category !== NONE);
      if (chosen.length === 0) throw new Error("no_rows");
      const body = await post(`${base}/statement/apply`, { trip, rows: chosen });
      const written = (body.written ?? {}) as {
        total?: number;
        written?: unknown[];
        orphaned?: { rows: number }[];
      };
      const orphaned = (written.orphaned ?? []).reduce((n, o) => n + o.rows, 0);
      setRows(null);
      setSaid(
        t("agent.inboxWritten", {
          count: String(written.total ?? 0),
          days: String(written.written?.length ?? 0),
        }) + (orphaned > 0 ? ` ${t("agent.inboxOrphaned", { count: String(orphaned) })}` : ""),
      );
    });

  const remove = (id: string) =>
    run(async () => {
      const response = await fetch(`${base}/inbox/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok) throw new Error(String(response.status));
      setGone((was) => [...was, id]);
      setRemoving(null);
      reset(null);
    });

  const consentThenRead = (id: string) =>
    run(async () => {
      await post(`${base}/consent`, { scope: "statement" });
      setConsented(true);
      setConsenting(false);
      await post(`${base}/statement`, { inbox: id, idempotency_key: id }).then((body) =>
        setRead({
          mapping: body.mapping as ColumnMapping | undefined,
          header: (body.header ?? []) as string[],
          notes: (body.notes ?? []) as string[],
          preview: (body.preview ?? []) as Row[],
          format: typeof body.format === "string" ? body.format : undefined,
        }),
      );
    });

  const visible = items.filter((item) => !gone.includes(item.entry.id));

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-8">
      <h1 className="text-2xl font-semibold text-navy-900">{t("agent.inboxTitle")}</h1>
      <p className="mt-2 text-sm leading-6 text-navy-700">{t("agent.inboxIntro")}</p>

      {visible.length === 0 && (
        <p className="mt-6 rounded-2xl border border-navy-200 bg-cream-50 p-4 text-sm text-navy-700">
          {t("agent.inboxEmpty")}
        </p>
      )}

      <ul className="mt-6 space-y-4">
        {visible.map((item) => {
          const id = item.entry.id;
          const isOpen = open === id;
          return (
            <li key={id} className="rounded-2xl border border-navy-200 bg-cream-50 p-4">
              <p className="break-words text-base font-semibold text-navy-900">
                {item.entry.filename}
              </p>
              <p className="mt-1 text-sm text-navy-600">
                {Math.max(1, Math.round(item.entry.bytes / 1024))} kB · {offerWords(item.offer, t)}
              </p>

              {!isOpen && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {item.offer.kind !== "unknown" && (
                    <button
                      type="button"
                      onClick={() => reset(id)}
                      className="min-h-11 rounded-full bg-yellow-400 px-5 text-base font-semibold text-yellow-950"
                    >
                      {item.offer.kind === "gps"
                        ? t("agent.inboxReadGps")
                        : t("agent.inboxStatement")}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setRemoving(id)}
                    className="min-h-11 rounded-full border border-navy-300 px-5 text-base font-semibold text-navy-700"
                  >
                    {t("agent.inboxRemove")}
                  </button>
                </div>
              )}

              {removing === id && (
                <div className="mt-3">
                  <ConfirmPanel
                    label={t("agent.inboxRemove")}
                    question={t("agent.inboxRemoveQuestion", { name: item.entry.filename })}
                    confirmLabel={t("agent.inboxRemoveConfirm")}
                    busy={busy}
                    onConfirm={() => remove(id)}
                    onCancel={() => setRemoving(null)}
                  />
                </div>
              )}

              {isOpen && item.offer.kind === "gps" && (
                <div className="mt-4 space-y-3">
                  <p className="text-sm leading-6 text-navy-700">{t("agent.inboxGpsFree")}</p>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => importGps(id)}
                    className="min-h-11 w-full rounded-full bg-yellow-400 px-5 text-base font-semibold text-yellow-950 disabled:opacity-50"
                  >
                    {t("agent.inboxReadGps")}
                  </button>
                  <TripPicker trips={trips} value={trip} onChange={setTrip} label={t("agent.inboxTripLabel")} />
                  <button
                    type="button"
                    disabled={busy || trip === ""}
                    onClick={drawTrack}
                    className="min-h-11 w-full rounded-full border border-navy-300 px-5 text-base font-semibold text-navy-700 disabled:opacity-50"
                  >
                    {t("agent.inboxDrawTrip")}
                  </button>
                </div>
              )}

              {isOpen && item.offer.kind === "statement" && (
                <div className="mt-4 space-y-3">
                  {"format" in item.offer ? (
                    <p className="text-sm leading-6 text-navy-700">
                      {t("agent.inboxStatementKnown", { label: item.offer.label })}
                    </p>
                  ) : !helper.enabled ? (
                    <p className="text-sm leading-6 text-navy-700">{t("agent.inboxOff")}</p>
                  ) : (
                    <p className="text-sm leading-6 text-navy-700">{t("agent.inboxColumnsHint")}</p>
                  )}

                  {!read && (helper.enabled || "format" in item.offer) && !consenting && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        "format" in item.offer
                          ? setRead({ header: [], notes: [], preview: [], format: item.offer.format })
                          : consented
                            ? readColumns(id)
                            : setConsenting(true)
                      }
                      className="min-h-11 w-full rounded-full bg-yellow-400 px-5 text-base font-semibold text-yellow-950 disabled:opacity-50"
                    >
                      {"format" in item.offer
                        ? t("agent.inboxReadAll")
                        : t("agent.inboxColumns", { credits: String(helper.credits) })}
                    </button>
                  )}

                  {consenting && (
                    <ConfirmPanel
                      label={t("agent.statementConsentLabel")}
                      question={t("agent.statementConsentShort")}
                      details={t("agent.statementConsent", { credits: String(helper.credits) })}
                      confirmLabel={t("agent.statementConsentConfirm")}
                      busy={busy}
                      onConfirm={() => consentThenRead(id)}
                      onCancel={() => setConsenting(false)}
                    />
                  )}

                  {read?.mapping && (
                    <Mapping
                      header={read.header}
                      mapping={read.mapping}
                      notes={read.notes}
                      preview={read.preview}
                      onChange={(mapping) => setRead({ ...read, mapping })}
                    />
                  )}

                  {read && !rows && (
                    <>
                      <TripPicker trips={trips} value={trip} onChange={setTrip} label={t("agent.inboxTripLabel")} />
                      <button
                        type="button"
                        disabled={busy || trip === ""}
                        onClick={() => readWholeFile(id)}
                        className="min-h-11 w-full rounded-full bg-yellow-400 px-5 text-base font-semibold text-yellow-950 disabled:opacity-50"
                      >
                        {t("agent.inboxReadAll")}
                      </button>
                    </>
                  )}

                  {rows && (
                    <Rows
                      rows={rows}
                      categories={categories}
                      onCategory={(index, value) =>
                        setCategories((was) => ({ ...was, [index]: value }))
                      }
                      onAll={(value) =>
                        setCategories(Object.fromEntries(rows.map((_, index) => [index, value])))
                      }
                      onWrite={write}
                      busy={busy}
                    />
                  )}
                </div>
              )}

              {isOpen && said && (
                <p role="status" className="mt-3 text-sm leading-6 text-navy-700">
                  {said}
                </p>
              )}
              {isOpen && error && (
                <p role="status" className="mt-3 text-sm text-coral-600">
                  {error}
                </p>
              )}
              {isOpen && (
                <button
                  type="button"
                  onClick={() => reset(null)}
                  className="mt-3 text-sm font-semibold text-navy-600 underline"
                >
                  {t("me.cancel")}
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </main>
  );
}

function offerWords(offer: Offer, t: (key: TranslationKey) => string): string {
  if (offer.kind === "gps") return `${t("agent.inboxIsGps")} · ${offer.label}`;
  if (offer.kind === "statement") return "label" in offer ? offer.label : t("agent.inboxIsStatement");
  return t("agent.inboxNothingToDo");
}

function TripPicker({
  trips,
  value,
  onChange,
  label,
}: {
  trips: WizardTrip[];
  value: string;
  onChange: (id: string) => void;
  label: string;
}) {
  return (
    <label className="block text-sm font-semibold text-navy-700">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 min-h-11 w-full rounded-xl border border-navy-300 bg-white px-3 text-base font-normal text-navy-900"
      >
        {trips.map((option) => (
          <option key={option.id} value={option.id}>
            {option.title}
          </option>
        ))}
      </select>
    </label>
  );
}

/** The mapping, editable. Every column is a picker over the file's own header
 *  row, so a person cannot name a column that is not there. */
function Mapping({
  header,
  mapping,
  notes,
  preview,
  onChange,
}: {
  header: string[];
  mapping: ColumnMapping;
  notes: string[];
  preview: Row[];
  onChange: (mapping: ColumnMapping) => void;
}) {
  const { t } = useI18n();
  const column = (
    label: TranslationKey,
    field: "date" | "amount" | "description" | "currency",
    optional = false,
  ) => (
    <label className="block text-sm font-semibold text-navy-700">
      {t(label)}
      <select
        value={mapping[field] ?? NONE}
        onChange={(event) => onChange({ ...mapping, [field]: event.target.value })}
        className="mt-1 min-h-11 w-full rounded-xl border border-navy-300 bg-white px-3 text-base font-normal text-navy-900"
      >
        {optional && <option value={NONE}>{t("agent.inboxColNone")}</option>}
        {header.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <div className="space-y-3 rounded-2xl border border-navy-200 bg-white p-3">
      <h2 className="text-base font-semibold text-navy-900">{t("agent.inboxMappingTitle")}</h2>
      <p className="text-sm leading-6 text-navy-700">{t("agent.inboxMappingHint")}</p>
      {column("agent.inboxColDate", "date")}
      {column("agent.inboxColAmount", "amount")}
      {column("agent.inboxColDescription", "description")}
      {column("agent.inboxColCurrency", "currency", true)}
      <label className="block text-sm font-semibold text-navy-700">
        {t("agent.inboxDateFormat")}
        <select
          value={mapping.dateFormat}
          onChange={(event) =>
            onChange({ ...mapping, dateFormat: event.target.value as ColumnMapping["dateFormat"] })
          }
          className="mt-1 min-h-11 w-full rounded-xl border border-navy-300 bg-white px-3 text-base font-normal text-navy-900"
        >
          {DATE_FORMATS.map((format) => (
            <option key={format} value={format}>
              {format}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2 text-sm text-navy-700">
        <input
          type="checkbox"
          checked={mapping.decimalComma === true}
          onChange={(event) => onChange({ ...mapping, decimalComma: event.target.checked })}
        />
        {t("agent.inboxDecimalComma")}
      </label>
      <label className="flex items-center gap-2 text-sm text-navy-700">
        <input
          type="checkbox"
          checked={mapping.outgoingPositive === true}
          onChange={(event) => onChange({ ...mapping, outgoingPositive: event.target.checked })}
        />
        {t("agent.inboxOutgoingPositive")}
      </label>

      {notes.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-navy-900">{t("agent.inboxMappingNotes")}</h3>
          <ul className="mt-1 list-disc pl-5 text-sm text-navy-700">
            {notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      )}

      {preview.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-navy-900">{t("agent.inboxPreview")}</h3>
          <ul className="mt-1 space-y-1 text-sm text-navy-700">
            {preview.map((row, index) => (
              <li key={index} className="flex flex-wrap justify-between gap-2">
                <span>
                  {row.date} · {row.label}
                </span>
                <span className="tabular-nums">
                  {row.amount} {row.currency}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** The rows, each with a category nobody has chosen yet. */
function Rows({
  rows,
  categories,
  onCategory,
  onAll,
  onWrite,
  busy,
}: {
  rows: Row[];
  categories: Record<number, string>;
  onCategory: (index: number, value: string) => void;
  onAll: (value: string) => void;
  onWrite: () => void;
  busy: boolean;
}) {
  const { t } = useI18n();
  const options = (
    <>
      <option value={NONE}>{t("agent.inboxCategoryNone")}</option>
      {COST_CATEGORIES.map((category: CostCategory) => (
        <option key={category} value={category}>
          {t(`cost.cat.${category}` as TranslationKey)}
        </option>
      ))}
    </>
  );

  return (
    <div className="space-y-3 rounded-2xl border border-navy-200 bg-white p-3">
      <h2 className="text-base font-semibold text-navy-900">
        {t("agent.inboxRowsTitle", { count: String(rows.length) })}
      </h2>
      <p className="text-sm leading-6 text-navy-700">{t("agent.inboxRowsHint")}</p>
      <label className="block text-sm font-semibold text-navy-700">
        {t("agent.inboxCategoryAll")}
        <select
          defaultValue={NONE}
          onChange={(event) => onAll(event.target.value)}
          className="mt-1 min-h-11 w-full rounded-xl border border-navy-300 bg-white px-3 text-base font-normal text-navy-900"
        >
          {options}
        </select>
      </label>
      <ul className="space-y-3">
        {rows.map((row, index) => (
          <li key={`${row.date}-${index}`} className="border-t border-navy-100 pt-2">
            <p className="flex flex-wrap justify-between gap-2 text-sm text-navy-700">
              <span>
                {row.date} · {row.label}
              </span>
              <span className="tabular-nums">
                {row.amount} {row.currency}
              </span>
            </p>
            <select
              value={categories[index] ?? NONE}
              onChange={(event) => onCategory(index, event.target.value)}
              className="mt-1 min-h-11 w-full rounded-xl border border-navy-300 bg-white px-3 text-base text-navy-900"
            >
              {options}
            </select>
          </li>
        ))}
      </ul>
      <button
        type="button"
        disabled={busy}
        onClick={onWrite}
        className="min-h-11 w-full rounded-full bg-yellow-400 px-5 text-base font-semibold text-yellow-950 disabled:opacity-50"
      >
        {t("agent.inboxWrite")}
      </button>
    </div>
  );
}
