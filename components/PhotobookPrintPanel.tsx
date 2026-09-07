import type { TranslationKey } from "@/lib/i18n";

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
 */
export default function PhotobookPrintPanel({
  username,
  id,
  recipient,
  printMinor,
  shipMinor,
  currency,
  quotedCredits,
  balance,
  t,
}: {
  username: string;
  id: string;
  recipient: { name: string; city: string; country: string };
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
        <p className="mt-1 text-sm">{t("photobook.print.balance", { balance: String(balance) })}</p>
      ) : null}
      {short ? (
        <p className="mt-2 text-sm">
          {t("photobook.print.short", { missing: String(quotedCredits - (balance ?? 0)) })}{" "}
          <a className="underline" href={`/${username}/me`}>
            {t("postcard.page.buy")}
          </a>
        </p>
      ) : null}
      <form
        method="post"
        action={`/${username}/photobooks/${id}/print`}
        className="mt-3"
      >
        <input type="hidden" name="quotedCredits" value={quotedCredits} />
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
