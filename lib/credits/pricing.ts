/**
 * What credits cost — B368.
 *
 * Split out of `lib/credits.ts`, which is `server-only`: the "Buy credits"
 * overlay in `MePageContent.tsx` is a client component and needs the same
 * three rows to render the dialog, and none of this is secret — it is the
 * same table a mail and a dead payment page both quote. Nothing here touches
 * a balance or a database.
 *
 * Base price is CHF 0.20/credit, with a volume discount at the two larger
 * tiers. Always integer rappen — never a float for money, and never a price
 * computed in a component.
 */

export type CreditTier = {
  /** The URL segment (`/credits/pay/<id>`) and the purchase route's `tier`
   * field. The credit count as a string: already unique, so it needs no
   * separate id of its own. */
  id: string;
  credits: number;
  priceRappen: number;
  /** A display string, e.g. `"10%"`. Empty for the base tier, which carries
   * no discount. */
  discount: string;
};

export const TIERS: readonly CreditTier[] = [
  { id: "50", credits: 50, priceRappen: 1000, discount: "" },
  { id: "100", credits: 100, priceRappen: 1800, discount: "10%" },
  { id: "200", credits: 200, priceRappen: 3200, discount: "20%" },
];

export function tierFor(id: string): CreditTier | undefined {
  return TIERS.find((tier) => tier.id === id);
}

/** `1800` -> `"CHF 18.00"`. The tiers are priced in CHF regardless of a
 * journal's own currency, so this is a fixed format rather than a currency
 * conversion. */
export function formatChf(rappen: number): string {
  return `CHF ${(rappen / 100).toFixed(2)}`;
}
