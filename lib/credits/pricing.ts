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

/**
 * What one printed, posted postcard costs the sender — B434.
 *
 * Fifteen credits is CHF 3.00 at the base tier. A card costs us roughly EUR 2
 * to print and post, so the margin is about a franc, and it is deliberately
 * not thinner: postage to a non-European address is more than to a Swiss one,
 * the exchange rate moves, and a card the printer spoils has to be reprinted
 * at our expense rather than the sender's.
 *
 * Here rather than in `lib/credits.ts` for the same reason the tiers are: that
 * file is `server-only` and the preview page has to render `15 × 4 = 60`
 * before anybody presses anything. Nothing about this number is secret.
 */
export const POSTCARD_CREDITS = 15;

export function tierFor(id: string): CreditTier | undefined {
  return TIERS.find((tier) => tier.id === id);
}

/**
 * What one printed photobook costs the owner — and every number here is a
 * guess.
 *
 * A postcard's fifteen credits came from a known unit cost. This one cannot,
 * because no photobook has ever been ordered from this instance and Gelato's
 * price endpoint needs an account and a real `productUid`. So the shape is
 * right — a fixed cost for the cover, binding and postage, plus a per-page
 * cost for paper and ink, times a factor for the larger sheet — and the
 * magnitudes are arithmetic against `docs/providers/photobook.md`'s
 * order-of-magnitude figures.
 *
 * `PHOTOBOOK_PRICING_VERIFIED` is how that is said in the data rather than
 * only in a comment, the same discipline `BINDING_PROFILES` uses.
 * `test/photobook-pricing.test.ts` asserts it, so the day somebody puts a real
 * quote in is a day they have to change a test on purpose.
 */
export const PHOTOBOOK_BASE_CREDITS = 90;
export const PHOTOBOOK_PAGE_CREDITS = 2;
export const PHOTOBOOK_PRICING_VERIFIED = false;

/** A4 is 1.4× the sheet area of the 210mm square, and paper is most of the
 * marginal cost. Rounded down to something defensible rather than modelled. */
const SIZE_FACTOR: Record<string, number> = {
  "square-210": 1,
  "landscape-a4": 1.25,
  "portrait-a4": 1.25,
};

/** One volume, one copy. A book split into volumes is priced per volume by the
 * caller, because each is a separate object with its own cover and postage. */
export function photobookCredits(pages: number, sizeId: string): number {
  const factor = SIZE_FACTOR[sizeId] ?? 1;
  return Math.ceil((PHOTOBOOK_BASE_CREDITS + PHOTOBOOK_PAGE_CREDITS * pages) * factor);
}

/** `1800` -> `"CHF 18.00"`. The tiers are priced in CHF regardless of a
 * journal's own currency, so this is a fixed format rather than a currency
 * conversion. */
export function formatChf(rappen: number): string {
  return `CHF ${(rappen / 100).toFixed(2)}`;
}
