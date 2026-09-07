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
 * What one printed photobook costs the owner — measured now, B841.
 *
 * **The basis, a live Gelato quote to Zurich, CHF, ex-VAT, 2026-09-07:**
 * softcover 200×200 square fits `6.04 + 0.161 × pages` almost exactly (32
 * pages 11.18, 52 pages 14.40, 100 pages 22.12, 160 pages 31.78), printed in
 * Switzerland, plus Swiss Post Economy shipping at 8.52. A 52-page square
 * book lands at CHF 22.92. Two things this basis does **not** cover: VAT, and
 * delivery outside Switzerland, which is a different quote every time and
 * therefore cannot be folded into one constant here.
 *
 * **The base was 90 until B840, then 160 against an estimate.** The estimate
 * came from Gelato's published "from $11.85" figure at a size Gelato does not
 * print (210×210) and a landed cost guessed at roughly CHF 25 — arithmetic on
 * a number that was never a quote. The measured landed cost turned out lower,
 * CHF 22.92, but the base stays 160 here anyway: a second plan (not this one)
 * splits the build charge from the print charge, and moving this number twice
 * — once to match a better guess, again when that split lands — is a price
 * that moved for no reason a reader can see. At 160 credits and 2 a page, a
 * 52-page book is priced (after the volume discount `priceRappen` already
 * applies at that many credits) at roughly twice landed cost, the same
 * multiple the postcard carries, and one reprint of a spoiled book still does
 * not wipe out the margin on three sales.
 *
 * `PHOTOBOOK_PRICING_VERIFIED` is how "measured, not guessed" is said in the
 * data rather than only in a comment. `test/photobook-pricing.test.ts` checks
 * both that it is `true` and that the charge for a 52-page square book sits
 * between the measured landed cost and twice it.
 */
export const PHOTOBOOK_BASE_CREDITS = 40;
export const PHOTOBOOK_PRICING_VERIFIED = true;

/**
 * What building the PDF costs, and why it no longer depends on the book.
 *
 * It used to be `160 + 2 per page`, times a factor for the larger sheet, and
 * every part of that was pricing *paper* — because until Gelato was connected
 * there was no second step to charge for, so the one charge had to cover a
 * printed object nobody could actually order.
 *
 * Now printing is its own step with its own live quote
 * (`photobookPrintCredits` below), and leaving the paper in this number would
 * charge for it twice. What is left is the render: laying the trip out,
 * choosing the pages, making the covers. That is the same work for a 28-page
 * book as for a 200-page one and the same work for every size, so it is one
 * flat number — and somebody who only ever wants the PDF pays CHF 8.00 for it
 * rather than CHF 52.80.
 *
 * `SIZE_FACTOR` went with it. It scaled this charge by measured *print* price
 * ratios, which belong to the print step and are now read from the quote.
 */
export function photobookCredits(): number {
  return PHOTOBOOK_BASE_CREDITS;
}

/**
 * What printing one book costs the owner, from a live Gelato quote.
 *
 * The quote is the real landed cost — print plus postage to the recipient's
 * own country, measured per order rather than assumed, because a book to
 * Australia is not a book to Zurich. `PHOTOBOOK_PRINT_MARGIN` is what sits on
 * top: 1.5x, in the 30-50% band print-on-demand resale runs at, and enough
 * that one spoiled book costs a third of a sale rather than a whole one.
 *
 * Rounded up to a whole credit, and computed here rather than at the call
 * site so the panel that shows a price and the code that charges it cannot
 * drift apart — the stale-quote check compares the two, and two formulas
 * would make it compare a number against itself computed differently.
 *
 * Measured basis, 2026-09-07, 52-page 200x200 softcover to Zurich: print
 * CHF 14.40 + postage CHF 8.52 = CHF 22.92 landed, so 172 credits (CHF 34.40).
 */
export const PHOTOBOOK_PRINT_MARGIN = 1.5;

/**
 * The book the price table quotes as an example, and the one every measured
 * number in this file was taken from: a 52-page 200 x 200 softcover to a
 * Swiss address, quoted 2026-09-07. Kept here so the public table and the
 * comments above cannot quote different books.
 */
export const PHOTOBOOK_QUOTE_EXAMPLE = { pages: 52, printMinor: 1440, shipMinor: 852 };

export function photobookPrintCredits(printMinor: number, shipMinor: number): number {
  const landedMinor = printMinor + shipMinor;
  return Math.ceil((landedMinor * PHOTOBOOK_PRINT_MARGIN) / BASE_RAPPEN_PER_CREDIT);
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
