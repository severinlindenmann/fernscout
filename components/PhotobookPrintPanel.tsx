import type { TranslationKey } from "@/lib/i18n";
import { formatCredits } from "@/lib/credits/format";
import type { BookRecipient } from "@/lib/photobook/recipients";
import type { PostalAddress } from "@/lib/postcard/render";

/**
 * A recipient as this panel needs them: the agent-safe row, plus the address
 * the owner is about to post to — B1145.
 *
 * The address is added *here* rather than in `bookRecipients`, which stays a
 * name and a town: that shape is what an agent proposing a book receives, and
 * a street must not join it. This page is the owner's own and 404s for anybody
 * else, which is the same line `lib/postcard` draws for a card's preview.
 */
export type PanelRecipient = BookRecipient & { address: PostalAddress };

/**
 * The address under the name, one line at a time. The name is rendered
 * separately and is therefore not repeated here, and an empty `line2` is
 * dropped rather than left as a blank line in the middle of an envelope.
 */
export function addressLines(to: PostalAddress): string[] {
  return [to.line1, to.line2, `${to.postcode} ${to.city}`.trim(), to.country]
    .map((line) => line?.trim() ?? "")
    .filter((line) => line !== "");
}

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
  recipient: PanelRecipient;
  /** Everybody this journal may post a book to, for the disclosure. */
  recipients: PanelRecipient[];
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
      {/* The envelope, not a summary of it — B1145. Centred, with the name a
          step larger than the lines under it, because that is the order an
          address is read in: who first, the street confirming it. A sentence
          naming a town cannot be checked against the parcel you are paying
          for. */}
      <address className="rounded-lg border border-dashed border-navy-300 bg-cream-50 px-3 py-3 text-center not-italic">
        <span className="block text-[0.7rem] font-semibold uppercase tracking-wider text-navy-600">
          {t("photobook.print.toLabel")}
        </span>
        <span className="mt-1 block text-base font-semibold text-navy-900">{recipient.name}</span>
        {addressLines(recipient.address).map((line) => (
          <span key={line} className="block text-sm text-navy-700">
            {line}
          </span>
        ))}
      </address>
      <p className="mt-3 text-sm">
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
          {/* Radios rather than a `<select>` — B1145. The browser draws a
              menu's rows and will not put an address on a second line, which
              is exactly the case two people at one address need: a dropdown
              reads "Name — Town" twice and only the first name tells them
              apart. Radios carry the whole envelope, show the choice without
              opening anything, and submit through the same GET form. */}
          <form method="get" action={`/${username}/photobooks/${id}`} className="mt-2">
            <fieldset>
              <legend className="text-sm">{t("photobook.print.chooseLabel")}</legend>
              <div className="mt-1 flex flex-col gap-1">
                {recipients.map((r) => (
                  <label
                    key={r.id}
                    className="flex items-start gap-2 rounded-lg border-2 border-navy-200 px-3 py-2 text-sm has-[:checked]:border-navy-900 has-[:checked]:bg-cream-50"
                  >
                    <input
                      type="radio"
                      name="to"
                      value={r.id}
                      defaultChecked={r.id === recipient.id}
                      className="mt-1"
                    />
                    <span>
                      <span className="block font-semibold text-navy-900">{r.name}</span>
                      <span className="block text-navy-700">{addressLines(r.address).join(", ")}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <button
              type="submit"
              className="mt-2 min-h-11 rounded-full border-2 border-navy-900 px-4 text-sm font-semibold text-navy-900 transition-colors duration-150 hover:bg-navy-900 hover:text-white focus-visible:ring-4 focus-visible:ring-yellow-400"
            >
              {t("photobook.print.chooseSubmit")}
            </button>
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
