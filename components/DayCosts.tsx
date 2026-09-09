"use client";

import { useState } from "react";
import BusyButton from "@/components/BusyButton";
import { useI18n } from "@/components/LocaleProvider";
import { COST_CATEGORIES } from "@/lib/costFormat";
import type { TranslationKey } from "@/lib/i18n";

/**
 * A receipt, entered by the person who paid it — B820.
 *
 * The costs page has always been readable and never writable: entering a cost
 * was `PATCH /api/v1/…/days/<slug>` with a `costs[]` array, which is an agent
 * or a script. A tester home from a trip with a shoebox of receipts found an
 * excellent page and no form.
 *
 * **One thing at a time**, because that is the case that actually happens: an
 * amount, the currency it was paid in, what it was, which day it belongs to,
 * and a category from the closed list in `lib/costFormat.ts`. Not a table, not
 * a spreadsheet, not the trip's budget — that is `PUT .../trips/<trip>/costs`
 * and a different, rarer screen.
 *
 * Its own component rather than more of `AgentWizard`, so it can be looked at
 * on its own, and because it belongs to a *day* rather than to the wizard's
 * flow: it is shown for a published day as readily as for a draft, since a
 * receipt turns up after the fact by definition (B816 made that possible).
 *
 * Nothing here guesses. An empty amount cannot be sent, the currency starts as
 * the journal's own and can be typed over, and the date starts as the day on
 * the screen — a date with no day written for it is refused in words rather
 * than a day being conjured to hang a number on.
 */
type Cost = {
  label: string;
  amount: number;
  currency: string;
  category: string;
};

export default function DayCosts({
  username,
  trip,
  slug,
  date,
  base,
  currencies,
  costs: already,
}: {
  username: string;
  trip: string;
  slug: string;
  /** The day on the screen, and the date the form starts on. */
  date: string;
  /** The journal's own currency — the default, never a guess about the trip. */
  base: string;
  /** What else this journal quotes in, for the suggestion list. */
  currencies: string[];
  /** What the day already carries. `category` is a plain string here, as it
   *  is on `Entry`: a file written by hand may hold a word the closed list
   *  never had, and reading it back must not be a type error. */
  costs: Cost[];
}) {
  const { t, formatLongDate } = useI18n();
  const [costs, setCosts] = useState<Cost[]>(already);
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState(base);
  const [category, setCategory] = useState<string>("other");
  const [on, setOn] = useState(date);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<string | null>(null);

  const add = async () => {
    setBusy(true);
    setError(null);
    setAdded(null);
    const response = await fetch(
      `/api/helper/${encodeURIComponent(username)}/day/costs`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          trip,
          slug,
          date: on,
          label,
          amount: Number(amount),
          currency,
          category,
        }),
      },
    ).catch(() => null);
    setBusy(false);
    const body = (await response?.json().catch(() => ({}))) as
      Record<string, unknown> | undefined;
    if (!response || !response.ok) {
      setError(
        body?.error === "no_day_on_date"
          ? t("cost.addNoDay", { date: formatLongDate(on) })
          : t("cost.addFailed", { error: String(body?.error ?? "network") }),
      );
      return;
    }
    // Only the day on the screen shows its own list; a receipt filed onto
    // another day says where it went instead of pretending it landed here.
    if (on === date) setCosts((body?.costs as Cost[]) ?? costs);
    setAdded(formatLongDate(on));
    setLabel("");
    setAmount("");
  };

  return (
    <section className="mt-5 rounded-2xl border border-navy-200 bg-white p-4 sm:p-5">
      <h3 className="font-display text-lg font-semibold text-navy-900">
        {t("cost.addHeading")}
      </h3>
      <p className="mt-1 text-sm leading-6 text-navy-600">
        {t("cost.addHint")}
      </p>

      {costs.length > 0 ? (
        <>
          <p className="mt-4 text-sm font-semibold text-navy-800">
            {t("cost.addOn")}
          </p>
          <ul className="mt-1 space-y-1 text-sm text-navy-700">
            {costs.map((cost, at) => (
              <li key={`${cost.label}-${at}`}>
                {cost.label} · {cost.amount} {cost.currency} ·{" "}
                {t(`cost.cat.${cost.category}` as TranslationKey)}
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="mt-4 text-sm text-navy-600">{t("cost.addNone")}</p>
      )}

      <label
        className="mt-4 block text-sm font-semibold text-navy-800"
        htmlFor="cost-label"
      >
        {t("cost.what")}
      </label>
      <input
        id="cost-label"
        value={label}
        onChange={(event) => setLabel(event.target.value)}
        className="mt-1 min-h-11 w-full rounded-xl border border-navy-300 bg-white px-3 text-base text-navy-900"
      />

      <div className="mt-4 flex flex-wrap gap-3">
        <div className="min-w-[8rem] flex-1">
          <label
            className="block text-sm font-semibold text-navy-800"
            htmlFor="cost-amount"
          >
            {t("cost.amount")}
          </label>
          <input
            id="cost-amount"
            type="number"
            inputMode="decimal"
            min="0"
            step="0.01"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            className="mt-1 min-h-11 w-full rounded-xl border border-navy-300 bg-white px-3 text-base text-navy-900"
          />
        </div>
        <div className="min-w-[6rem]">
          <label
            className="block text-sm font-semibold text-navy-800"
            htmlFor="cost-currency"
          >
            {t("cost.currency")}
          </label>
          {/* A list rather than a select: a journal quotes in three currencies
              and a person may have paid in a fourth. The suggestions are the
              journal's; the field takes any code. */}
          <input
            id="cost-currency"
            list="cost-currencies"
            value={currency}
            onChange={(event) => setCurrency(event.target.value.toUpperCase())}
            className="mt-1 min-h-11 w-full rounded-xl border border-navy-300 bg-white px-3 text-base uppercase text-navy-900"
          />
          <datalist id="cost-currencies">
            {currencies.map((code) => (
              <option key={code} value={code} />
            ))}
          </datalist>
        </div>
      </div>

      <label
        className="mt-4 block text-sm font-semibold text-navy-800"
        htmlFor="cost-category"
      >
        {t("cost.category")}
      </label>
      <select
        id="cost-category"
        value={category}
        onChange={(event) => setCategory(event.target.value)}
        className="mt-1 min-h-11 w-full rounded-xl border border-navy-300 bg-white px-3 text-base text-navy-900"
      >
        {COST_CATEGORIES.map((name) => (
          <option key={name} value={name}>
            {t(`cost.cat.${name}` as TranslationKey)}
          </option>
        ))}
      </select>

      <label
        className="mt-4 block text-sm font-semibold text-navy-800"
        htmlFor="cost-date"
      >
        {t("cost.when")}
      </label>
      <input
        id="cost-date"
        type="date"
        value={on}
        onChange={(event) => setOn(event.target.value)}
        className="mt-1 min-h-11 w-full rounded-xl border border-navy-300 bg-white px-3 text-base text-navy-900"
      />

      <BusyButton
        busy={busy}
        type="button"
        disabled={label.trim() === "" || !(Number(amount) > 0)}
        onClick={() => void add()}
        className="mt-5 min-h-11 w-full rounded-full bg-yellow-400 px-5 text-base font-semibold text-yellow-950 disabled:opacity-50"
        busyLabel={t("cost.addBusy")}
      >
        {t("cost.addButton")}
      </BusyButton>

      {added && (
        <p role="status" className="mt-3 text-sm leading-6 text-navy-700">
          {t("cost.added", { date: added })}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm leading-6 text-coral-700">
          {error}
        </p>
      )}
    </section>
  );
}
