"use client";

import { useState } from "react";
import { useI18n } from "@/components/LocaleProvider";
import { COST_CATEGORIES, type CostCategory } from "@/lib/costFormat";
import type { CostsDoc, PlanStop } from "@/lib/planner/types";
import type { TranslationKey } from "@/lib/i18n";

export function formatMoney(amount: number, currency: string, locale: string): string {
  try {
    return `${currency} ${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(amount)}`;
  } catch {
    return `${currency} ${Math.round(amount)}`;
  }
}

/**
 * The Money screen — D9, "made friendlier": the total first, one labelled
 * editor with amount/currency/label/category/stop, the planned budget with
 * its own per-day figure. Every write is the whole `costs` section, same
 * merge-patch-replaces-the-key contract as the plan itself.
 */
export default function MoneyPanel({
  costs,
  route,
  baseCurrency,
  currencies,
  tripDays,
  onSave,
  onBack,
  saveStatus,
}: {
  costs: CostsDoc;
  route: PlanStop[];
  baseCurrency: string;
  /** The journal's currencies, base first — the only codes offered (B2143). */
  currencies: string[];
  tripDays?: number;
  onSave: (next: CostsDoc) => void;
  onBack: () => void;
  saveStatus: "idle" | "saving" | "saved" | "failed";
}) {
  const { t, locale } = useI18n();
  const items = costs.items ?? [];
  const total = items.reduce((sum, item) => sum + item.amount, 0);

  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(
    currencies.includes(costs.budget?.currency ?? "") ? costs.budget!.currency! : (currencies[0] ?? baseCurrency),
  );
  const [label, setLabel] = useState("");
  const [category, setCategory] = useState<CostCategory>("other");
  const [stopId, setStopId] = useState<string | null>(null);
  const [budgetTotal, setBudgetTotal] = useState(String(costs.budget?.total ?? ""));

  function addCost() {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0 || label.trim() === "") return;
    onSave({ ...costs, items: [...items, { label: label.trim(), amount: value, currency, category, stop: stopId ?? undefined }] });
    setAmount("");
    setLabel("");
    setCategory("other");
    setStopId(null);
  }

  function removeCost(index: number) {
    onSave({ ...costs, items: items.filter((_, i) => i !== index) });
  }

  function saveBudget() {
    const value = Number(budgetTotal);
    if (!Number.isFinite(value) || value <= 0) return;
    onSave({ ...costs, budget: { ...costs.budget, total: value, currency: costs.budget?.currency ?? baseCurrency, days: costs.budget?.days ?? tripDays } });
  }

  return (
    <div>
      <button type="button" onClick={onBack} className="min-h-11 text-sm underline">
        {t("studio.plan.back")}
      </button>
      <h2 className="mt-2 font-display text-xl font-semibold text-ink-strong">
        {t("studio.plan.money.known", { amount: formatMoney(total, baseCurrency, locale) })}
      </h2>

      <ul className="mt-3 flex flex-col gap-1">
        {items.map((item, i) => (
          <li key={`${item.label}-${i}`} className="flex items-center justify-between border-b border-line-faint py-2 text-sm">
            <span>
              {item.label}
              {item.category && <>{" "}<span className="ml-1 text-ink-secondary">{t(`cost.cat.${item.category}` as TranslationKey)}</span></>}
            </span>
            <span className="flex items-center gap-2">
              {formatMoney(item.amount, item.currency ?? baseCurrency, locale)}
              <button type="button" onClick={() => removeCost(i)} className="min-h-11 text-coral-600 underline">
                {t("studio.plan.money.delete")}
              </button>
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-4 rounded-xl border border-line-strong p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">{t("studio.plan.money.addCost")}</p>
        <div className="mt-1 flex gap-2">
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={t("studio.plan.money.amount")}
            className="min-h-11 flex-1 rounded-xl border border-line-strong px-3 text-base"
          />
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
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
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={t("studio.plan.money.whatFor")}
          className="mt-2 min-h-11 w-full rounded-xl border border-line-strong px-3 text-base"
        />
        <div className="mt-2 flex flex-wrap gap-2">
          {COST_CATEGORIES.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setCategory(cat)}
              aria-pressed={category === cat}
              className={`min-h-11 rounded-full border px-3 text-sm ${category === cat ? "border-ink-strong bg-surface-subtle" : "border-line-strong"}`}
            >
              {t(`cost.cat.${cat}` as TranslationKey)}
            </button>
          ))}
        </div>
        {route.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setStopId(null)}
              aria-pressed={stopId === null}
              className={`min-h-11 rounded-full border px-3 text-sm ${stopId === null ? "border-ink-strong bg-surface-subtle" : "border-line-strong"}`}
            >
              {t("studio.plan.tripLevel")}
            </button>
            {route.map((s) => (
              <button
                key={s.id ?? s.location}
                type="button"
                onClick={() => setStopId(s.id ?? null)}
                aria-pressed={stopId === s.id}
                className={`min-h-11 rounded-full border px-3 text-sm ${stopId === s.id ? "border-ink-strong bg-surface-subtle" : "border-line-strong"}`}
              >
                {s.location}
              </button>
            ))}
          </div>
        )}
        <button type="button" onClick={addCost} className="mt-2 min-h-11 rounded-full bg-action-strong px-5 text-sm font-semibold text-on-action">
          {t("studio.plan.money.addCostButton")}
        </button>
      </div>

      <div className="mt-4 rounded-xl border border-line-strong p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">{t("studio.plan.money.budget")}</p>
        <input
          type="number"
          value={budgetTotal}
          onChange={(e) => setBudgetTotal(e.target.value)}
          className="mt-1 min-h-11 w-full rounded-xl border border-line-strong px-3 text-base"
        />
        {costs.budget && (
          <p className="mt-1 text-sm text-ink-secondary">
            {t("studio.plan.money.perDay", {
              amount: formatMoney(costs.budget.total / (costs.budget.days ?? tripDays ?? 1), costs.budget.currency ?? baseCurrency, locale),
              days: String(costs.budget.days ?? tripDays ?? 1),
            })}
          </p>
        )}
        <button type="button" onClick={saveBudget} className="mt-2 min-h-11 rounded-full bg-action-strong px-5 text-sm font-semibold text-on-action">
          {t("studio.plan.money.saveBudget")}
        </button>
      </div>

      {saveStatus === "failed" ? (
        <p role="alert" className="mt-3 text-sm text-coral-600">{t("studio.plan.failed")}</p>
      ) : (
        <p role="status" className="mt-3 text-sm text-action-strong">
          {saveStatus === "saving" && t("studio.plan.saving")}
          {saveStatus === "saved" && t("studio.plan.saved")}
        </p>
      )}
    </div>
  );
}
