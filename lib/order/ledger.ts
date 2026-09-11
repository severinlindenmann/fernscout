import { formatCredits } from "../credits/format";
import { creditsInRappen, formatChf } from "../credits/pricing";
import type { TranslationKey } from "../i18n";

/**
 * What an order costs, in words — and the one place that decides them (B1466).
 *
 * Separate from `lib/order/view.ts` for the reason that file's first import
 * gives away: it reaches `lib/postcard/orders.ts`, which is `server-only`, so
 * nothing in a browser can import it. The photobook **buy panel** is a client
 * component and needs exactly these words *before* the press, so that the
 * price somebody agreed to and the price on the receipt afterwards cannot be
 * phrased differently. They were: the panel said "238 credits — about CHF
 * 47.60, printed and posted" and the receipt said it in a table, and neither
 * knew about the other.
 *
 * Nothing here touches a database, a request or a locale file — it is
 * arithmetic and a translator somebody else bound.
 */

type Translate = (key: TranslationKey, vars?: Record<string, string>) => string;

/** One charge, or one refund. `credits` is always positive and `refund` is
 *  what makes it read as money coming back; `amount` is that decision already
 *  made, because a component that formats money is a component that can format
 *  it differently from the total directly above it. */
export type OrderLedgerLine = {
  label: string;
  credits: number;
  refund?: true;
  amount: string;
};

export type OrderLedger = {
  lines: OrderLedgerLine[];
  /** What the person is out of pocket, after any refund. */
  totalCredits: number;
  totalLabel: string;
  totalMoney: string;
};

/**
 * The about-CHF figure is `creditsInRappen` and never `priceRappen` — B551.
 * This is what a credit already in the balance is worth, valued at the most
 * anybody ever pays for one, not what buying this many would cost today.
 */
export function orderLedger(t: Translate, lines: Omit<OrderLedgerLine, "amount">[]): OrderLedger {
  const total = lines.reduce((sum, l) => sum + (l.refund ? -l.credits : l.credits), 0);
  return {
    lines: lines.map((line) => ({
      ...line,
      amount: t(line.refund ? "photobook.receipt.creditsNegative" : "photobook.receipt.credits", {
        credits: formatCredits(line.credits),
      }),
    })),
    totalCredits: total,
    totalLabel: t("photobook.receipt.credits", { credits: formatCredits(total) }),
    totalMoney: t("photobook.receipt.about", { money: formatChf(creditsInRappen(total)) }),
  };
}

/** One printed book, posted: the single line B1425 left, priced before the
 *  press and again on the receipt from the same call. */
export function photobookLedger(t: Translate, credits: number): OrderLedger {
  return orderLedger(t, [{ label: t("photobook.receipt.line"), credits }]);
}
