import type { TranslationKey } from "@/lib/i18n";
import { formatCredits } from "@/lib/credits/format";
import type { BookRecipient } from "@/lib/photobook/recipients";

/**
 * The panel B434's postcard rule holds a photobook to as well: an owner sees
 * who a book is going to, what it costs, split into print and postage, what
 * they have left, and **one button** — never a `window.confirm`
 * (AGENTS.md, B633/B668).
 *
 * A plain server component, not a client one: everything it shows was
 * already resolved before the page rendered, and the one thing it can do —
 * print — is a `<form method="post">` to
 * `app/[user]/photobooks/[id]/print/route.ts`, the owner-cookie-only door
 * that is the sole caller of `printOrder`. No fetch, no state, nothing that
 * needs JavaScript to work on a bad connection.
 *
 * `quotedCredits` travels in a hidden field rather than being recomputed by
 * the browser, because the button has to post exactly the number this panel
 * showed — `printOrder` re-quotes at press time and refuses as
 * `stale_quote` when the two disagree, so a second formula here would make
 * that comparison fail against itself.
 *
 * ## Choosing who it goes to — B1093
 *
 * The owner is preselected, because a book is most often posted to the person
 * whose journal it is, and anybody else sits behind a `<details>`. Two things
 * about that are deliberate:
 *
 * - **It is a `<details>` and a `<form method="get">`, not client state.**
 *   Picking somebody puts `?to=` on the page's own URL and the server
 *   re-renders with a quote for *their* country — so the price on screen is
 *   always the price for the person on screen. The panel stays a server
 *   component, and the button that spends credits keeps working with no
 *   JavaScript at all.
 * - **A name and a town, never a street.** The same rule the postcard list
 *   follows; the address itself is resolved server-side by `bookAddressFor`
 *   and never reaches this component.
 *
 * The disclosure opens by itself when the selection is *not* the owner, so a
 * choice already made is visible rather than folded away.
 */
export default function PhotobookPrintPanel({
  username,
  id,
  recipient,
  recipients,
  printMinor,
  shipMinor,
  currency,
  quotedCredits,
  balance,
  t,
}: {
  username: string;
  id: string;
  /** The one the quote below was taken for. */
  recipient: BookRecipient;
  /** Everybody this journal may post a book to, for the disclosure. */
  recipients: BookRecipient[];
  /** The print portion of the quote, in minor units of `currency`. */
  printMinor: number;
  /** The postage portion, in minor units of `currency`. */
  shipMinor: number;
  currency: string;
  /** What pressing the button will actually charge, in credits. */
  quotedCredits: number;
  /** `null` when credits are off entirely, which is not the same as zero. */
  balance: number | null;
  t: (key: TranslationKey, vars?: Record<string, string>) => string;
}) {
  const short = balance !== null && balance < quotedCredits;
  const money = (minor: number) => `${currency} ${(minor / 100).toFixed(2)}`;

  return (
    <div className="mt-3 rounded-xl border-2 border-navy-900 bg-cream-100 p-4">
      <p className="text-sm">
        {t("photobook.print.to", {
          name: recipient.name,
          city: recipient.city,
          country: recipient.country,
        })}
      </p>
      <p className="mt-1 text-sm">
        {t("photobook.print.quote", {
          print: money(printMinor),
          postage: money(shipMinor),
          total: String(quotedCredits),
        })}
      </p>
      {balance !== null ? (
        <p className="mt-1 text-sm">{t("photobook.print.balance", { balance: formatCredits(balance) })}</p>
      ) : null}
      {short ? (
        <p className="mt-2 text-sm">
          {t("photobook.print.short", { missing: formatCredits(quotedCredits - (balance ?? 0)) })}{" "}
          <a className="underline" href={`/${username}/me`}>
            {t("postcard.page.buy")}
          </a>
        </p>
      ) : null}
      {recipients.length > 1 ? (
        <details className="mt-3 border-t border-navy-200 pt-2" open={!recipient.self}>
          <summary className="cursor-pointer text-sm text-navy-600">
            {t("photobook.print.elsewhere")}
          </summary>
          {/* GET, so choosing somebody changes the page's own URL and the
              server re-quotes for their country. Nothing is written and
              nothing is charged by this form. */}
          <form method="get" action={`/${username}/photobooks/${id}`} className="mt-2">
            <label className="block text-sm" htmlFor="book-recipient">
              {t("photobook.print.chooseLabel")}
            </label>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <select
                id="book-recipient"
                name="to"
                defaultValue={recipient.id}
                className="min-h-11 rounded-lg border-2 border-navy-300 bg-cream-50 px-2 text-sm"
              >
                {recipients.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} — {r.city}
                    {r.country ? `, ${r.country}` : ""}
                  </option>
                ))}
              </select>
              <button
                type="submit"
                className="min-h-11 rounded-full border-2 border-navy-900 px-4 text-sm font-semibold text-navy-900 transition-colors duration-150 hover:bg-navy-900 hover:text-white focus-visible:ring-4 focus-visible:ring-yellow-400"
              >
                {t("photobook.print.chooseSubmit")}
              </button>
            </div>
          </form>
        </details>
      ) : null}
      <form
        method="post"
        action={`/${username}/photobooks/${id}/print`}
        className="mt-3"
      >
        <input type="hidden" name="quotedCredits" value={quotedCredits} />
        {/* Who the quote above was taken for. Re-checked server-side against
            the contacts this journal may post to, and the price re-quoted, so
            editing this in the browser refuses rather than underpays. */}
        <input type="hidden" name="contactId" value={recipient.id} />
        <button
          type="submit"
          className="min-h-11 rounded-full bg-navy-900 px-5 text-sm font-semibold text-white shadow-md transition-all duration-150 hover:bg-navy-700 hover:shadow-lg focus-visible:ring-4 focus-visible:ring-yellow-400 active:translate-y-px active:shadow-sm"
        >
          {t("photobook.print.button", { total: String(quotedCredits) })}
        </button>
      </form>
    </div>
  );
}
