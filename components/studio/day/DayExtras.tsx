"use client";

import { useId, useState } from "react";
import { X } from "lucide-react";
import { useI18n } from "@/components/LocaleProvider";
import { TAG_MAX_LENGTH, TRANSPORT_MODES } from "@/lib/validate/entry";
import type { TranslationKey } from "@/lib/i18n";

/** One cost line as it is typed: the amount stays text until it is sent. */
export type CostLine = { label: string; amount: string; currency: string; category?: string };
export type DayExtrasValue = { costs: CostLine[]; transportMode: string; tags: string[] };
export const NO_EXTRAS: DayExtrasValue = { costs: [], transportMode: "", tags: [] };

/** The day schema's own ceiling on tags (`lib/api/v2/schemas/day.ts`). */
const MAX_TAGS = 10;

/** "Street Food" → "street-food": the slug shape every tag is held to. */
export function tagOf(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, TAG_MAX_LENGTH)
    .replace(/-+$/, "");
}

/** A line nobody typed on is ignored; a started one must be whole. */
const blankLine = (c: CostLine) => c.label.trim() === "" && c.amount.trim() === "";
export const lineProblem = (c: CostLine) =>
  !blankLine(c) && (c.label.trim() === "" || !(Number(c.amount) > 0) || !/^[A-Z]{3}$/.test(c.currency));

/** What a write sends: only what was actually given, never an empty answer. */
export function extrasToWrite(v: DayExtrasValue): { costs?: object[]; transportMode?: string; tags?: string[] } {
  const costs = v.costs
    .filter((c) => !blankLine(c))
    .map((c) => ({ label: c.label.trim(), amount: Number(c.amount), currency: c.currency, ...(c.category ? { category: c.category } : {}) }));
  return {
    ...(costs.length ? { costs } : {}),
    ...(v.transportMode ? { transportMode: v.transportMode } : {}),
    ...(v.tags.length ? { tags: v.tags } : {}),
  };
}

const LABEL = "block text-xs font-semibold uppercase tracking-wide text-ink-secondary";
const FIELD = "mt-1 block min-h-11 w-full rounded-xl border border-line-strong bg-surface-base px-3 text-sm text-ink-body";
const LINK = "min-h-11 text-left text-sm font-semibold text-ink-body underline underline-offset-2";

/**
 * Costs, how the day travelled and tags — B2233. Shared by the one-page day's
 * "More details" and "Change a day". Nothing here writes: the parent sends
 * `extrasToWrite(value)` with its own save.
 *
 * `keep` (Change a day) names the sections the stored day already answers:
 * those cannot be emptied here, since an empty list is not an answer and a
 * decline is the owner's own words, not this form's.
 */
export default function DayExtras({
  value,
  onChange,
  currencies,
  keep = { costs: false, transportMode: false, tags: false },
}: {
  value: DayExtrasValue;
  onChange: (next: DayExtrasValue) => void;
  /** `journalCurrencies`, base first. */
  currencies: string[];
  keep?: { costs: boolean; transportMode: boolean; tags: boolean };
}) {
  const { t } = useI18n();
  const [tagDraft, setTagDraft] = useState("");
  const tagId = useId();
  // A stored line in a currency the journal no longer lists is still offered.
  const codes = [...new Set([...currencies, ...value.costs.map((c) => c.currency).filter(Boolean)])];

  const setLine = (at: number, patch: Partial<CostLine>) =>
    onChange({ ...value, costs: value.costs.map((c, i) => (i === at ? { ...c, ...patch } : c)) });
  const canRemoveLine = !keep.costs || value.costs.length > 1;
  const canRemoveTag = !keep.tags || value.tags.length > 1;

  function addTag() {
    const tag = tagOf(tagDraft);
    setTagDraft("");
    if (!tag || value.tags.includes(tag) || value.tags.length >= MAX_TAGS) return;
    onChange({ ...value, tags: [...value.tags, tag] });
  }

  return (
    <div data-day-extras className="space-y-4">
      <fieldset>
        <legend className={LABEL}>{t("studio.day.field.costs")}</legend>
        {value.costs.map((line, at) => (
          <div key={at} data-cost-line className="mt-2 rounded-xl border border-line-strong p-3">
            <label className={LABEL}>
              {t("cost.what")}
              <input type="text" value={line.label} onChange={(e) => setLine(at, { label: e.target.value })} className={FIELD} />
            </label>
            <div className="mt-2 flex gap-2">
              <label className={`min-w-0 flex-1 ${LABEL}`}>
                {t("cost.amount")}
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={line.amount}
                  onChange={(e) => setLine(at, { amount: e.target.value })}
                  className={FIELD}
                />
              </label>
              <label className={`w-28 ${LABEL}`}>
                {t("cost.currency")}
                <select value={line.currency} onChange={(e) => setLine(at, { currency: e.target.value })} className={FIELD}>
                  {codes.map((code) => (
                    <option key={code} value={code}>
                      {code}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {lineProblem(line) && (
              <p role="alert" className="mt-1 text-sm text-coral-600">
                {t("studio.day.extras.costIncomplete")}
              </p>
            )}
            {canRemoveLine && (
              <button type="button" onClick={() => onChange({ ...value, costs: value.costs.filter((_, i) => i !== at) })} className={LINK}>
                {t("studio.day.extras.removeCost")}
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          onClick={() => onChange({ ...value, costs: [...value.costs, { label: "", amount: "", currency: currencies[0] ?? "" }] })}
          className={LINK}
        >
          {t("studio.day.extras.addCost")}
        </button>
      </fieldset>

      <label className={LABEL}>
        {t("studio.day.field.transportMode")}
        <select name="transportMode" value={value.transportMode} onChange={(e) => onChange({ ...value, transportMode: e.target.value })} className={FIELD}>
          {!keep.transportMode && <option value="">{t("studio.day.extras.noTransport")}</option>}
          {TRANSPORT_MODES.map((mode) => (
            <option key={mode} value={mode}>
              {t(`studio.day.transport.${mode}` as TranslationKey)}
            </option>
          ))}
        </select>
      </label>

      <div>
        <label htmlFor={tagId} className={LABEL}>
          {t("studio.day.field.tags")}
        </label>
        {value.tags.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-2">
            {value.tags.map((tag) => (
              <li key={tag} data-tag={tag} className="inline-flex min-h-9 items-center gap-1 rounded-full border border-line-strong bg-surface-raised pl-3 pr-1 text-sm text-ink-strong">
                {tag}
                {canRemoveTag && (
                  <button
                    type="button"
                    aria-label={t("studio.day.extras.removeTag", { tag })}
                    onClick={() => onChange({ ...value, tags: value.tags.filter((x) => x !== tag) })}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-full hover:bg-surface-subtle"
                  >
                    <X aria-hidden className="h-4 w-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {value.tags.length < MAX_TAGS && (
          <div className="mt-1 flex gap-2">
            <input
              id={tagId}
              type="text"
              value={tagDraft}
              onChange={(e) => setTagDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === ",") {
                  e.preventDefault();
                  addTag();
                }
              }}
              className={`${FIELD} mt-0 flex-1`}
            />
            <button type="button" onClick={addTag} disabled={!tagOf(tagDraft)} className="min-h-11 rounded-full border border-line-strong px-4 text-sm font-semibold text-ink-strong disabled:opacity-50">
              {t("studio.day.extras.addTag")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
