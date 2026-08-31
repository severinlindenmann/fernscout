"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { formatMoney } from "@/lib/currency";
import type { CurrencyOptions } from "@/lib/rates";

const STORAGE_KEY = "fs.currency";

type Ctx = {
  /** The currency the reader is looking at. */
  currency: string;
  /** The currency every stored total is actually held in. */
  base: string;
  /** What the switcher may offer, base first. */
  currencies: string[];
  setCurrency: (c: string) => void;
  /** True while the reader is looking at converted, approximate numbers. */
  approximate: boolean;
  /** ECB publication date behind the conversion, when one applies. */
  asOf?: string;
  /**
   * A base-currency number as display text. Everything in `CostSummary` is in
   * the base currency, so this is what nearly every call site wants.
   */
  money: (baseAmount: number, opts?: { decimals?: boolean }) => string;
  /**
   * An amount in the currency it was actually spent in, formatted verbatim
   * and never converted — `450 THB` stays `THB 450` no matter what the
   * switcher says.
   */
  original: (amount: number, currency: string) => string;
};

const CurrencyContext = createContext<Ctx | null>(null);

/**
 * Reader-chosen display currency, mirroring `LocaleProvider`.
 *
 * The options come from the server (`currencyOptions()` in `lib/rates.ts`)
 * because building them reads the content folder; the choice and its
 * persistence live here.
 */
export default function CurrencyProvider({
  options,
  children,
}: {
  options: CurrencyOptions;
  children: React.ReactNode;
}) {
  // The base currency renders on the server and on the first client paint,
  // then the stored preference is adopted — otherwise the server HTML and the
  // client's first render disagree. Same reasoning as LocaleProvider.
  const [currency, setCurrencyState] = useState(options.base);

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored && stored !== options.base && options.currencies.includes(stored)) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCurrencyState(stored);
    }
  }, [options.base, options.currencies]);

  const setCurrency = useCallback(
    (c: string) => {
      if (!options.currencies.includes(c)) return;
      setCurrencyState(c);
      window.localStorage.setItem(STORAGE_KEY, c);
    },
    [options.currencies],
  );

  const value = useMemo<Ctx>(() => {
    // An unknown code can only arrive from a stale localStorage entry after
    // the configured list changed; falling back to 1 would silently relabel
    // base-currency numbers, so fall back to the base currency itself.
    const rate = options.rates[currency];
    const active = rate === undefined ? options.base : currency;
    const factor = rate ?? 1;
    const approximate = active !== options.base;

    return {
      currency: active,
      base: options.base,
      currencies: options.currencies,
      setCurrency,
      approximate,
      asOf: approximate ? options.asOf : undefined,
      money: (baseAmount, opts) =>
        formatMoney(baseAmount * factor, active, { ...opts, approximate }),
      original: (amount, code) => formatMoney(amount, code, { approximate: false }),
    };
  }, [currency, options, setCurrency]);

  return <CurrencyContext.Provider value={value}>{children}</CurrencyContext.Provider>;
}

export function useMoney(): Ctx {
  const ctx = useContext(CurrencyContext);
  if (!ctx) throw new Error("useMoney must be used inside CurrencyProvider");
  return ctx;
}
