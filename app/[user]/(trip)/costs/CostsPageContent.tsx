"use client";

import { useState } from "react";
import { Table2, BarChart3, TrendingDown, TrendingUp } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import UnconvertedNotice from "@/components/UnconvertedNotice";
import { StackedShareBar, BarList, DailyColumns, CumulativeArea } from "@/components/charts/Charts";
import { useI18n } from "@/components/LocaleProvider";
import { useMoney } from "@/components/CurrencyProvider";
import { flagFor } from "@/lib/flags";
import {
  CATEGORY_STYLE,
  type BudgetPace,
  type BudgetStatus,
  type CostSummary,
  type CostCategory,
} from "@/lib/costFormat";
import type { TranslationKey } from "@/lib/i18n";

export default function CostsPageContent({
  summary,
  travellers,
}: {
  summary: CostSummary;
  travellers: string;
}) {
  const { t, formatShortDate } = useI18n();
  const { money, original, currency, base, approximate, asOf } = useMoney();
  const [showTable, setShowTable] = useState(false);

  const catLabel = (c: CostCategory) => t(`cost.cat.${c}` as TranslationKey);

  /**
   * Which page this is: the one about a trip that is happening, or the one
   * about a trip that is planned.
   *
   * Decided once, from the summary's own flag, and never re-derived from a
   * length or a zero further down — that is how the same bug comes back for
   * the next field that happens to be empty (B19). Everything conditional
   * below hangs off this line and off `budget.pace`, which is the same
   * decision made in the type.
   */
  const planned = !summary.hasBegun;

  const slices = summary.byCategory.map((c) => ({
    key: c.category,
    label: catLabel(c.category),
    value: c.amount,
    color: CATEGORY_STYLE[c.category].color,
  }));

  return (
    <div className="min-h-screen">
      <PageHeader />
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-navy-900 sm:text-4xl">
          {t("cost.title")}
        </h1>
        {/* Which of the two pages this is, said in a sentence, so a reader
            never has to work it out from a zero. */}
        <p className="mt-1 max-w-2xl text-sm text-navy-600">
          {planned ? t("cost.subtitlePlanned", { currency }) : t("cost.subtitle", { currency })}
        </p>

        {/* What the totals had to leave out, before the totals themselves. */}
        <UnconvertedNotice items={summary.unconverted} />

        {/* Headline numbers. Before departure the two rates — what a day
            costs, and what has gone on the road — are zero because there are
            no days yet, not because the trip is cheap. */}
        {planned ? (
          <dl className="mt-6 grid grid-cols-2 gap-3">
            <Stat label={t("cost.total")} value={money(summary.total)} hero />
            <Stat label={t("cost.prep")} value={money(summary.preparation)} />
          </dl>
        ) : (
          <dl className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label={t("cost.total")} value={money(summary.total)} hero />
            <Stat label={t("cost.perDay")} value={money(summary.perDay)} />
            <Stat label={t("cost.onTheRoad")} value={money(summary.onTheRoad)} />
            <Stat label={t("cost.prep")} value={money(summary.preparation)} />
          </dl>
        )}

        {/* The budget: how it is going, or — before there is a "going" — what
            it is. `pace` is present exactly when the trip has begun. */}
        {summary.budget &&
          (summary.budget.pace ? (
            <BudgetPanel budget={summary.budget} pace={summary.budget.pace} spent={summary.total} />
          ) : (
            <PlannedBudgetPanel budget={summary.budget} spent={summary.total} />
          ))}

        {/* Where the money went */}
        <Section title={t("cost.byCategory")}>
          <StackedShareBar slices={slices} format={(n) => money(n)} />
        </Section>

        {/* Per country */}
        {summary.byCountry.length > 0 && (
          <Section title={t("cost.byCountry")} note={t("cost.byCountryNote")}>
            <BarList
              rows={summary.byCountry.map((c) => ({
                key: c.country,
                label: `${flagFor(c.country, c.countryCode)} ${c.country}`,
                value: c.amount,
                sub: `${money(c.perDay)}/${t("cost.day")}`,
              }))}
              format={(n) => money(n)}
              accent={CATEGORY_STYLE.preparation.color}
            />
          </Section>
        )}

        {/* Day by day, and the running total. Both plot the days the trip
            has, so before departure there is nothing to draw — omitted the
            way `byCountry` above is, rather than drawn as empty axes under a
            heading promising a breakdown. */}
        {!planned && (
          <>
            <Section title={t("cost.perDayChart")}>
              <DailyColumns
                data={summary.byDay}
                average={summary.perDay}
                format={(n) => money(n)}
                formatDate={formatShortDate}
                accent={CATEGORY_STYLE.accommodation.color}
              />
            </Section>

            <Section title={t("cost.cumulative")} note={t("cost.cumulativeNote")}>
              <CumulativeArea
                data={summary.byDay}
                format={(n) => money(n)}
                formatDate={formatShortDate}
                accent={CATEGORY_STYLE.flights.color}
                reference={
                  summary.budget?.pace
                    ? { values: summary.budget.pace.curve, label: t("cost.plannedSpend") }
                    : undefined
                }
              />
            </Section>
          </>
        )}

        {/* Everything, itemised — also the accessible fallback for the charts */}
        <section className="mt-10">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-display text-xl font-semibold text-navy-900">
              {t("cost.everyExpense")}
            </h2>
            <button
              onClick={() => setShowTable((v) => !v)}
              className="flex min-h-11 items-center gap-1.5 rounded-full border border-navy-200 bg-white px-3.5 text-sm font-semibold text-navy-600 transition-colors hover:text-navy-900"
            >
              {showTable ? <BarChart3 className="h-3.5 w-3.5" /> : <Table2 className="h-3.5 w-3.5" />}
              {showTable ? t("cost.hideTable") : t("cost.showTable")}
            </button>
          </div>

          {showTable && (
            <div className="mt-3 overflow-x-auto rounded-xl border border-navy-200 bg-white">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-navy-200 text-xs text-navy-600">
                  <tr>
                    <th className="px-4 py-2 font-semibold">{t("cost.when")}</th>
                    <th className="px-4 py-2 font-semibold">{t("cost.what")}</th>
                    <th className="px-4 py-2 font-semibold">{t("cost.category")}</th>
                    <th className="px-4 py-2 text-right font-semibold">{t("cost.amount")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-navy-200">
                  {summary.items.map((item, i) => (
                    <tr key={`${item.label}-${i}`}>
                      <td className="whitespace-nowrap px-4 py-2 text-xs text-navy-600">
                        {item.date ? formatShortDate(item.date) : t("cost.beforeLeaving")}
                      </td>
                      <td className="px-4 py-2 text-navy-900">
                        {item.label}
                        {/* A real space, not a margin. JSX drops the newline
                            between these two, so the margin was the only thing
                            separating them and copying the table gave you
                            "GroceriesMoab". */}
                        {item.location && (
                          <> <span className="text-xs text-navy-600">{item.location}</span></>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-2">
                        <span className="inline-flex items-center gap-1.5 text-xs text-navy-600">
                          <span
                            className="h-2.5 w-2.5 rounded-sm"
                            style={{ background: CATEGORY_STYLE[item.category].color }}
                            aria-hidden
                          />
                          {catLabel(item.category)}
                        </span>
                      </td>
                      {/* The converted figure leads, with what was actually
                          handed over underneath it — and nothing but the
                          original when no rate reaches it. */}
                      <td className="whitespace-nowrap px-4 py-2 text-right">
                        {item.base === undefined ? (
                          <>
                            <span className="font-display font-semibold text-navy-900">
                              {original(item.amount, item.currency)}
                            </span>
                            <span className="ml-1.5 rounded-full bg-coral-300 px-2 py-0.5 text-xs font-semibold text-navy-900">
                              {t("cost.noRate")}
                            </span>
                          </>
                        ) : (
                          <>
                            <span className="font-display font-semibold text-navy-900">
                              {money(item.base)}
                            </span>
                            {item.currency !== currency && (
                              <span className="block text-[11px] font-normal text-navy-600">
                                {original(item.amount, item.currency)} {t("cost.spentIn")}
                              </span>
                            )}
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t border-navy-200 bg-cream-50">
                  <tr>
                    <td colSpan={3} className="px-4 py-2 text-sm font-semibold text-navy-900">
                      {t("cost.total")}
                    </td>
                    <td className="px-4 py-2 text-right font-display font-semibold text-navy-900">
                      {money(summary.total)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </section>

        <p className="mt-8 text-xs text-navy-600">
          {t("cost.disclaimer", {
            travellers,
            currency: summary.baseCurrency,
          })}
        </p>
        {approximate && (
          <p className="mt-1.5 text-xs text-navy-600">
            {asOf
              ? t("currency.approxNote", { currency, base, date: asOf })
              : t("currency.approxNoteUndated", { currency, base })}
          </p>
        )}
      </main>
    </div>
  );
}

function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10">
      <h2 className="font-display text-xl font-semibold text-navy-900">{title}</h2>
      {note && <p className="mb-4 mt-0.5 text-xs text-navy-600">{note}</p>}
      <div className={note ? "" : "mt-4"}>{children}</div>
    </section>
  );
}

/**
 * The budget before departure: a plan, not a scoreboard.
 *
 * The same three numbers the author wrote down — what the trip is budgeted
 * at, what a day of it is allowed, how many days it was drawn for — and what
 * preparation has already taken out of it. No delta, no projection, no
 * colour: there is nothing yet to be over or under. See B19.
 */
function PlannedBudgetPanel({ budget, spent }: { budget: BudgetStatus; spent: number }) {
  const { t } = useI18n();
  const { money } = useMoney();
  // Preparation is real money and it is really gone, so the bar is honest —
  // it is only the *pace* that has no meaning yet. Neutral, for the same
  // reason: a colour here would be a verdict.
  const used = budget.total > 0 ? Math.min(1, spent / budget.total) : 0;

  return (
    <section className="mt-8 rounded-2xl border border-navy-200 bg-white p-5 shadow-sm sm:p-6">
      <h2 className="font-display text-lg font-semibold text-navy-900">{t("cost.budgetPlan")}</h2>

      <div className="mt-4">
        <div className="h-3 w-full overflow-hidden rounded-full bg-navy-200/50">
          <div
            className="h-full rounded-full transition-[width] duration-700"
            style={{ width: `${used * 100}%`, background: "#5a6a80" }}
          />
        </div>
        <p className="mt-1.5 text-[11px] text-navy-600">
          {Math.round(used * 100)}% {t("cost.ofBudget")} · {money(spent)} / {money(budget.total)}
        </p>
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label={t("cost.budgetTotal")} value={money(budget.total)} />
        <Stat label={t("cost.budgetPerDay")} value={money(budget.perDay)} />
        <Stat label={t("cost.budgetDays")} value={String(budget.days)} />
        <Stat label={t("cost.remaining")} value={money(budget.remaining)} />
      </dl>

      <p className="mt-3 text-[11px] leading-relaxed text-navy-600">
        {t("cost.budgetNotePlanned")}
      </p>
    </section>
  );
}

function BudgetPanel({
  budget,
  pace,
  spent,
}: {
  budget: BudgetStatus;
  pace: BudgetPace;
  spent: number;
}) {
  const { t } = useI18n();
  const { money } = useMoney();
  const delta = pace.deltaToDate;
  // Anything inside a single day's allowance is noise, not a trend worth colouring.
  const onPace = Math.abs(delta) < budget.perDay;
  const under = delta < 0;
  const used = budget.total > 0 ? Math.min(1, spent / budget.total) : 0;

  const tone = onPace
    ? { text: "text-navy-700", bar: "#5a6a80" }
    : under
      ? { text: "text-green-700", bar: CATEGORY_STYLE.accommodation.color }
      : { text: "text-coral-600", bar: CATEGORY_STYLE.other.color };

  return (
    <section className="mt-8 rounded-2xl border border-navy-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="font-display text-lg font-semibold text-navy-900">{t("cost.budget")}</h2>
        <p className={`flex items-center gap-1.5 font-display text-sm font-semibold ${tone.text}`}>
          {!onPace &&
            (under ? (
              <TrendingDown className="h-4 w-4" aria-hidden />
            ) : (
              <TrendingUp className="h-4 w-4" aria-hidden />
            ))}
          {onPace
            ? t("cost.onPace")
            : `${money(Math.abs(delta))} ${under ? t("cost.underBudget") : t("cost.overBudget")}`}
        </p>
      </div>

      <div className="mt-4">
        <div className="h-3 w-full overflow-hidden rounded-full bg-navy-200/50">
          <div
            className="h-full rounded-full transition-[width] duration-700"
            style={{ width: `${used * 100}%`, background: tone.bar }}
          />
        </div>
        <p className="mt-1.5 text-[11px] text-navy-600">
          {Math.round(used * 100)}% {t("cost.ofBudget")} · {money(spent)} / {money(budget.total)}
        </p>
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label={t("cost.budgetTotal")} value={money(budget.total)} />
        <Stat label={t("cost.budgetPerDay")} value={money(budget.perDay)} />
        <Stat label={t("cost.projected")} value={money(pace.projectedTotal)} />
        <Stat label={t("cost.remaining")} value={money(budget.remaining)} />
      </dl>

      <p className="mt-3 text-[11px] leading-relaxed text-navy-600">{t("cost.budgetNote")}</p>
    </section>
  );
}

function Stat({ label, value, hero = false }: { label: string; value: string; hero?: boolean }) {
  return (
    <div
      className={`rounded-xl border px-4 py-3 ${
        hero ? "border-yellow-600/40 bg-yellow-400/25" : "border-navy-200 bg-white"
      }`}
    >
      <dt className="text-xs text-navy-600">{label}</dt>{" "}
      <dd
        className={`font-display font-semibold text-navy-900 ${hero ? "text-2xl" : "text-xl"}`}
      >
        {value}
      </dd>
    </div>
  );
}
