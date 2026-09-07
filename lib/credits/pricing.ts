/**
 * What credits cost — B368.
 *
 * Split out of `lib/credits.ts`, which is `server-only`: the "Buy credits"
 * overlay in `MePageContent.tsx` is a client component and needs the same
 * three rows to render the dialog, and none of this is secret — it is the
 * same table a mail and a dead payment page both quote. Nothing here touches
 * a balance or a database.
 *
 * Base price is CHF 0.20/credit, with one volume discount at the larger tier.
 * Always integer rappen — never a float for money, and never a price computed
 * in a component.
 *
 * **Two tiers, not three — B840.** There were three, discounted 0/10/20%, and
 * a person at the till had to compare three unit prices to answer "how much is
 * a credit". The deepest discount also gave the most margin away to the people
 * who buy most. Fifty for CHF 10.00 stays exactly `EXTRA_STORAGE_CREDITS`, so
 * "buy credits, then buy storage" is still one purchase of one amount.
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
  { id: "200", credits: 200, priceRappen: 3600, discount: "10%" },
];

/**
 * What one printed, posted postcard costs the sender — B434, repriced by B840.
 *
 * Twenty credits is CHF 4.00 at the base tier, against roughly CHF 2 to print
 * and post. It was fifteen, and about a franc of margin was too thin for what
 * this actually is: postage to a non-European address is more than to a Swiss
 * one, the exchange rate moves, and a card the printer spoils is reprinted at
 * our expense rather than the sender's — one spoiled card ate two sales.
 *
 * The comparison a person actually makes is buying a card and a stamp: around
 * CHF 2 for the card plus CHF 1.20 domestic or CHF 2.00 international postage.
 * CHF 4.00 sits at or just under that, for something they did not have to find
 * a postbox for, and inside the CHF 3-4 the postcard apps charge for one card.
 *
 * Here rather than in `lib/credits.ts` for the same reason the tiers are: that
 * file is `server-only` and the preview page has to render `15 × 4 = 60`
 * before anybody presses anything. Nothing about this number is secret.
 */
export const POSTCARD_CREDITS = 20;

export function tierFor(id: string): CreditTier | undefined {
  return TIERS.find((tier) => tier.id === id);
}

/**
 * What one printed photobook costs the owner — and every number here is a
 * guess.
 *
 * A postcard's twenty credits came from a known unit cost. This one cannot,
 * because no photobook has ever been ordered from this instance and Gelato's
 * price endpoint needs an account and a real `productUid`. So the shape is
 * right — a fixed cost for the cover, binding and postage, plus a per-page
 * cost for paper and ink, times a factor for the larger sheet — and the
 * magnitudes are arithmetic against `docs/providers/photobook.md`'s
 * order-of-magnitude figures.
 *
 * **The base was 90 until B840, and 90 was too low.** Gelato publishes no
 * per-page rate; what they do publish is "from $11.85" for a softcover with
 * the first 30 inner pages included, at their *smallest* format — ours is
 * 210 x 210, perfect bound, 32 to 160 pages. Estimating from that plus
 * European shipping puts a 52-page book at roughly CHF 25 landed, against
 * which the old base priced it at CHF 38.80: about a third, and one reprint
 * of a spoiled book wiped out three sales. At 160 the same book is CHF 52.80,
 * which is roughly twice landed cost — the same multiple the postcard carries
 * — and sits above the DIY photobook shops' softcovers and below their
 * hardcovers. That is the deliberate position: this book arrives laid out.
 *
 * It is still an estimate, and the pricing table on `/` says so in as many
 * words rather than only here. B841 is the real quote.
 *
 * `PHOTOBOOK_PRICING_VERIFIED` is how that is said in the data rather than
 * only in a comment, the same discipline `BINDING_PROFILES` uses.
 * `test/photobook-pricing.test.ts` asserts it, so the day somebody puts a real
 * quote in is a day they have to change a test on purpose.
 */
export const PHOTOBOOK_BASE_CREDITS = 160;
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

/**
 * What a number of credits is worth in money — B551.
 *
 * A price stated only in credits is a price nobody can judge, and "154
 * credits" was on the order step three times with no way to tell whether that
 * was a coffee or a car. Valued at the *base* tier — the most anybody ever
 * pays per credit — so the figure is the ceiling and buying in bulk can only
 * make it cheaper. Say "about": the two larger tiers really do pay less.
 */
export function creditsInRappen(credits: number): number {
  return Math.round((credits * TIERS[0].priceRappen) / TIERS[0].credits);
}

/** `1800` -> `"CHF 18.00"`. The tiers are priced in CHF regardless of a
 * journal's own currency, so this is a fixed format rather than a currency
 * conversion. */
export function formatChf(rappen: number): string {
  return `CHF ${(rappen / 100).toFixed(2)}`;
}

/**
 * More room, bought once — B661.
 *
 * Five gigabytes on top of whatever ceiling the instance sets, for fifty
 * credits: CHF 10.00 at the base tier, and deliberately the exact price of the
 * smallest tier so that "buy credits, then buy storage" is one purchase of one
 * amount rather than arithmetic somebody has to do at the till.
 *
 * **Lifetime, and repeatable.** It does not renew and it cannot lapse, so
 * nothing here has an expiry date and nothing sweeps one — the ledger row is
 * the whole record (`purchasedBytes` in `lib/storageQuota.ts`). A
 * subscription would need a second answer to "what happens to the photographs
 * when it stops", and that is a decision nobody has made.
 */
export const EXTRA_STORAGE_CREDITS = 50;

/** What those fifty credits buy. Binary gigabytes, like every other byte
 * figure this software prints. */
export const EXTRA_STORAGE_BYTES = 5 * 1024 ** 3;

/**
 * What one credit is worth, in words a person can judge — B806.
 *
 * A 71-year-old tester found a button that would have spent one credit, could
 * not find out anywhere what a credit is, and put the phone down rather than
 * press it. She was being offered something that cost about twenty rappen.
 * B767 was right to take prices off the first screen; it did not follow that
 * the *unit* should be unexplained at the moment somebody is asked to spend
 * one.
 *
 * Three strings rather than one sentence, because the sentence is a
 * translation and belongs in `site/locales/`. Every number here is arithmetic
 * on `TIERS` — nothing about a price is ever typed into a locale file, which
 * is what `test/credit-worth.test.ts` holds this to.
 */
export function creditWorth(): { one: string; credits: string; price: string } {
  return {
    one: formatChf(creditsInRappen(1)),
    credits: String(TIERS[0].credits),
    price: formatChf(TIERS[0].priceRappen),
  };
}
