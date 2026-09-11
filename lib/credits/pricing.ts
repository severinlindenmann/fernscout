/**
 * What credits cost — B368.
 *
 * Split out of `lib/credits.ts`, which is `server-only`: the "Buy credits"
 * overlay in `MePageContent.tsx` is a client component and needs the same
 * three rows to render the dialog, and none of this is secret — it is the
 * same table a mail and a dead payment page both quote. Nothing here touches
 * a balance or a database.
 *
 * Base price is CHF 0.20/credit. Always integer rappen — never a float for
 * money, and never a price computed in a component.
 *
 * **An amount, not a list — B854.** There were three fixed tiers, then two
 * (B840), and every amount that was not one of them was unbuyable: somebody
 * needing eighty credits for a photobook had to buy two hundred, and somebody
 * wanting to try one write-up had to buy fifty. A list also makes the volume
 * discount an announcement rather than an incentive — it appears at one
 * boundary and nowhere else, so there is nothing to find by asking for more.
 *
 * So the price is a function of the amount, and the account page is a slider
 * over it. `priceRappen` is the only thing that computes a price, and the
 * purchase route calls it rather than reading a number from the request: an
 * amount a caller may name is fine, a price a caller may name is a way to buy
 * five hundred credits for a franc.
 */

/** The amount a person may buy in one purchase, and the granularity of the
 *  slider over it. Ten is enough to try the helper on a day; five hundred is
 *  two photobooks and change, which is more than anybody has yet spent in a
 *  year. The step keeps the slider to fifty positions and the prices to
 *  figures somebody can read back to you. */
export const MIN_CREDITS = 10;
export const MAX_CREDITS = 500;
export const CREDIT_STEP = 10;

/** CHF 0.20. The price of the first fifty credits, and the most anybody ever
 *  pays for one — every larger purchase pays less per credit. */
export const BASE_RAPPEN_PER_CREDIT = 20;

/** Where the discount starts, and where it stops growing. Below the first
 *  number there is none; at the second it is `MAX_DISCOUNT`. */
export const DISCOUNT_FROM = 50;
const MAX_DISCOUNT = 0.2;

/**
 * The share taken off the base price at this amount — `0` to `0.2`.
 *
 * Flat to fifty, then logarithmic: each *doubling* of the order buys the same
 * further slice of discount, which is the shape a volume discount actually
 * has (the cost being amortised — a payment fee, a support question — does not
 * halve every time the order does). Fifty pays CHF 0.20 a credit, a hundred
 * CHF 0.188, two hundred CHF 0.176, five hundred CHF 0.16.
 *
 * **Smooth on purpose.** Banded discounts make the total jump as somebody
 * drags past a boundary, and the jump is always downwards — a slider that
 * sometimes charges less for more is one people stop trusting. Here every
 * extra credit costs strictly more than nothing and strictly less than the
 * one before it, which `test/credit-price.test.ts` asserts across the whole
 * range rather than at a handful of points.
 */
export function discountFor(credits: number): number {
  if (credits <= DISCOUNT_FROM) return 0;
  const span = Math.log(MAX_CREDITS / DISCOUNT_FROM);
  return MAX_DISCOUNT * (Math.log(credits / DISCOUNT_FROM) / span);
}

/** What this many credits costs, in whole rappen. The one place a price is
 *  computed; everything else — the slider, the dialog, the mail, the payment
 *  page, Stripe — asks this. */
export function priceRappen(credits: number): number {
  return Math.round(credits * BASE_RAPPEN_PER_CREDIT * (1 - discountFor(credits)));
}

/** `0.06` -> `"6%"`. Whole percents: a discount printed as "6.02%" reads as a
 *  number somebody computed rather than an offer. */
export function discountLabel(credits: number): string {
  return `${Math.round(discountFor(credits) * 100)}%`;
}

/**
 * Whether this is an amount somebody may actually buy — B854.
 *
 * The step is enforced as well as the range, and that is not fussiness: the
 * slider can only produce multiples of ten, so an amount that is not one came
 * from somewhere else, and the honest answer to a request nothing in the
 * product can make is to refuse it rather than to price it.
 */
export function isBuyableAmount(credits: unknown): credits is number {
  return (
    typeof credits === "number" &&
    Number.isInteger(credits) &&
    credits >= MIN_CREDITS &&
    credits <= MAX_CREDITS &&
    credits % CREDIT_STEP === 0
  );
}

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

/**
 * What one printed photobook costs the owner, and the whole of what it is
 * sold for — B1425.
 *
 * **One product, one price.** The owner's own words: *"we don't charge for
 * build or print, we charge the customer for the full photobook, we just
 * want a solid margin."* There is no build charge and no print charge,
 * on screen or in this file — `photobookPriceCredits` below is the only
 * number, computed from the live Gelato quote alone.
 *
 * **VAT is a cost, not a line item.** Gelato quotes ex-VAT, and this instance
 * is far below the CHF 100,000 Swiss registration threshold, so it neither
 * charges VAT to a customer nor reclaims it from one — the tax is money that
 * leaves with the printer's invoice and never comes back, exactly like the
 * paper and the postage it is charged on. `PHOTOBOOK_VAT_RATE` folds it into
 * the landed cost before the margin, so the margin is a margin on what this
 * actually costs rather than on a number that understates it.
 *
 * **One rate, not two — measured off a real invoice, not assumed.** A live
 * Gelato invoice (30-page 200×200 softcover, Swiss Post Economy, 2026-09-11)
 * billed print and shipping *together* at a single rate: `Subtotal 10.86,
 * Shipping 8.52, Discounts -5.43, Tax 1.13`. `1.13 / (10.86 + 8.52 - 5.43) =
 * 8.10%` — not the 2.6% reduced rate a book alone would suggest, and not two
 * different rates on the two components either. Gelato does not appear to
 * treat this as reduced-rate printed matter at all; it taxes the whole
 * shipment at the standard rate. `PHOTOBOOK_VAT_RATE` mirrors that invoice
 * because it is what is actually paid, and it stays a single constant rather
 * than the printed-matter/carriage split this file used to carry, which was
 * never billed that way. The 50% introductory discount on that invoice is
 * not reflected here — a cost basis built on a promotional rate that can end
 * at any time is a margin built on sand, so the pricing below is off the
 * pre-discount figures. The invoice also reconciles the stored cost formula
 * against real money: `6.04 + 0.161 × 30 = 10.87` predicted, `10.86` billed —
 * one rappen out.
 *
 * **The margin is 2.0x, targeting 50% gross at list.** It used to be 1.5x on
 * the print alone while a separate flat charge carried the render — the two
 * never met, VAT was in neither, and the measured gross was 43.9%, falling
 * to 29.9% for a buyer on the full credit discount. Priced as one object at
 * 2.0x its VAT-inclusive landed cost, the 46-page book a person actually had
 * on screen is 238 credits — CHF 47.60 — near OptimalPrint's CHF 46.90 and
 * well under ifolor's ~CHF 54.70 delivered.
 *
 * **The volume discount erodes this, deliberately.** `priceRappen` above
 * takes up to 20% off the credits somebody buys, and that discount is applied
 * to what this function charges exactly like it is applied to everything
 * else bought with credits — nothing here defends the margin against it. A
 * buyer on the full discount lands near 37.8% gross, which is the owner's own
 * call, read as a volume rebate rather than an oversight: **do not add a
 * second pricing rule to protect the margin from the discount.**
 *
 * **The basis, a live Gelato quote to Zurich, CHF, ex-VAT, 2026-09-07:**
 * softcover 200×200 square fits `6.04 + 0.161 × pages` almost exactly (32
 * pages 11.18, 52 pages 14.40, 100 pages 22.12, 160 pages 31.78), printed
 * near the recipient, plus Swiss Post Economy shipping at 8.52. That
 * `0.161`-a-page rate is the 200×200 softcover curve specifically, not the
 * catalogue's — Pocket 140×140 softcover measures CHF 0.106 a page over the
 * same range, so the formula does not transfer to another size. Postage
 * itself is flatter than the print price: CHF 8.52 to Switzerland whatever
 * the page count, softcover, and CHF 9.35 for hardcover — it varies by cover
 * type, not by how thick the book is. Re-checked live on 2026-09-11 against
 * a 28-page 200×200 softcover: the print formula predicts CHF 10.55, the
 * quote came back CHF 10.53 — two rappen out, and close enough to trust.
 *
 * `PHOTOBOOK_PRICING_VERIFIED` is how "measured, not guessed" is said in the
 * data rather than only in a comment. `test/photobook-pricing.test.ts` checks
 * both that it is `true` and that the charge for the 52-page book above is
 * twice its VAT-inclusive landed cost, within a rappen.
 */
export const PHOTOBOOK_PRICING_VERIFIED = true;

/** Swiss VAT, at the standard rate — measured off a real Gelato invoice
 *  rather than assumed from the printed-matter rate a book alone would
 *  suggest (see the doc block above). Applied to print and shipping
 *  together, because that is how Gelato bills it. Charged by the printer,
 *  never reclaimed (this instance is below the CHF 100,000 registration
 *  threshold), so it is a cost folded into what printing lands at rather
 *  than a rate this journal charges anybody. */
export const PHOTOBOOK_VAT_RATE = 0.081;

/**
 * The margin on the whole book — B1425, up from the 1.5x this used to be,
 * which sat on the print alone while a separate charge carried the render.
 * 2.0x targets 50% gross at list; see the doc block above this section for
 * what the volume discount is allowed to do to that.
 */
export const PHOTOBOOK_MARGIN = 2.0;

/**
 * The floor, not an example — the cheapest book this catalogue can produce,
 * quoted live to Zurich on 2026-09-11, and every other combination is
 * dearer.
 *
 * All six size-and-cover combinations Gelato offers were quoted at
 * `GELATO_PAGE_RULE.min` (28 pages, the fewest any of them will print) with
 * the cheapest available shipping, and this is the winner: Pocket square
 * 140×140 softcover, Swiss Post Economy. **Postage varies by cover, not by
 * page count** — measured flat at CHF 8.52 to Switzerland for softcover from
 * 28 to 200 pages, and CHF 9.35 for hardcover over the same range — so
 * hardcover's own floor (CHF 9.35 shipping, CHF 49.00 landed) can never
 * undercut this one regardless of how thin the book is.
 *
 * This is what the public price table shows, as a "from" figure, and it is
 * the floor of a wide range: the same catalogue runs from this CHF 36.20 book
 * up to a 200-page 280×280 hardcover at CHF 205.60 — the size and the page
 * count are most of what moves it, which is why the panel quotes the real
 * book before anybody orders rather than trusting this constant for more
 * than the headline figure.
 */
export const PHOTOBOOK_QUOTE_MINIMUM = { pages: 28, printMinor: 815, shipMinor: 852 };

/**
 * What one photobook costs, in credits — the single price, from a live
 * Gelato quote alone.
 *
 * `printMinor` and `shipMinor` are Gelato's own ex-VAT figures, in minor
 * units (rappen). VAT at `PHOTOBOOK_VAT_RATE` is added to the two together —
 * not per component, because Gelato does not bill it per component — before
 * the margin, and the whole thing is rounded up to a whole credit once, at
 * the end: rounding either component first would round the price itself
 * before the margin even applies, and would make the last-rappen comparison
 * a test asserts (`test/photobook-pricing.test.ts`) fail on its own
 * arithmetic rather than on the code's.
 *
 * Computed here rather than at either call site so the panel that shows a
 * price and the code that charges it cannot drift apart — `order/route.ts`'s
 * stale-quote check compares two calls to this function, and two formulas
 * would make it compare a number against itself computed differently.
 */
export function photobookPriceCredits(printMinor: number, shipMinor: number): number {
  const landedInclVat = (printMinor + shipMinor) * (1 + PHOTOBOOK_VAT_RATE);
  return Math.ceil((landedInclVat * PHOTOBOOK_MARGIN) / BASE_RAPPEN_PER_CREDIT);
}


/**
 * What a number of credits is worth in money — B551.
 *
 * A price stated only in credits is a price nobody can judge, and "154
 * credits" was on the order step three times with no way to tell whether that
 * was a coffee or a car. Valued at `BASE_RAPPEN_PER_CREDIT` — the most anybody
 * ever pays per credit — so the figure is a ceiling and a larger purchase can
 * only have made it cheaper. Say "about", and never `priceRappen`: this is
 * what a credit already in the balance was worth, not what buying this many
 * costs today.
 */
export function creditsInRappen(credits: number): number {
  return credits * BASE_RAPPEN_PER_CREDIT;
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
 * on the price function — nothing about a price is ever typed into a locale
 * file, which is what `test/credit-worth.test.ts` holds this to.
 *
 * `DISCOUNT_FROM` is the example amount rather than a round number picked for
 * the sentence: it is the largest purchase that still pays the base rate, so
 * "50 credits cost CHF 10.00" is both true and the simplest true thing to
 * say. Quote a discounted amount here and the sentence quietly stops
 * multiplying.
 */
export function creditWorth(): { one: string; credits: string; price: string } {
  return {
    one: formatChf(creditsInRappen(1)),
    credits: String(DISCOUNT_FROM),
    price: formatChf(priceRappen(DISCOUNT_FROM)),
  };
}
