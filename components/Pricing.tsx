import { Check } from "lucide-react";
import { SIGNUP_CREDIT_GRANT } from "@/lib/credits";
import {
  EXTRA_STORAGE_BYTES,
  EXTRA_STORAGE_CREDITS,
  MAX_CREDITS,
  MIN_CREDITS,
  POSTCARD_CREDITS,
  creditsInRappen,
  formatChf,
  photobookPriceCredits,
  PHOTOBOOK_QUOTE_MINIMUM,
  priceRappen,
} from "@/lib/credits/pricing";
import { serverMediaCeiling } from "@/lib/config";
import { formatBytes } from "@/lib/storageQuota";
import { PHOTOS_PER_CREDIT } from "@/lib/helper/credits";
import { MINUTES_PER_CREDIT } from "@/lib/helper/speech";
import { WRITE_DAY_CREDITS } from "@/lib/helper/model";
import { MAX_JOURNALS_PER_EMAIL } from "@/lib/journals";
import { translateIn } from "@/lib/locales";
import type { TranslationKey } from "@/lib/i18n";

/**
 * What this costs, before anybody signs up — B840, repriced into money by
 * B1332.
 *
 * The prices existed and were unreachable: the first place a person met one
 * was the "Buy credits" panel on their own account page, which is behind
 * signing up. So somebody deciding whether to use this had to commit in order
 * to find out whether it was free.
 *
 * **Money first, credits explained once** — B1332. Every row used to lead
 * with a credit count, which asked a visitor to learn a private unit before
 * they could judge a price (the same trap B806 closed one screen deeper).
 * Now every row is CHF, and credits appear exactly twice: the highlighted
 * signup-gift line at the top of the free card, and a two-sentence note under
 * the price list saying that Fernscout counts in credits behind the scenes
 * and what one is worth. CHF because that is the billing currency; a
 * journal's own display currency is deliberately not converted here.
 *
 * **Every figure here is read from the constant that charges it.** Not one
 * number is typed into a translation string — the strings carry `{price}`
 * and `{credits}` and this file fills them in, because a price kept in two
 * places disagrees with itself within a month, and a *published* price that
 * disagrees with the till is the worst version of that. Same rule
 * `lib/api/openapi.ts` follows for enums, for the same reason.
 *
 * A server component, rendered by `/` (through `Landing`, as a prop, since
 * that one is a client component) and by `/docs`. Server rather than client so
 * it can read `lib/credits.ts` and `lib/journals.ts`, both `server-only`,
 * instead of having every number drilled through as a prop.
 *
 * **The caller decides whether it appears at all** — both check
 * `isEnabled("credits")` first. An instance with credits switched off charges
 * nothing, and a price table would be a straight lie there; a self-hoster
 * gets none, which is correct, because they are the one paying the printer.
 */
export default function Pricing({ locale }: { locale: string }) {
  const t = (key: string, vars?: Record<string, string>) =>
    translateIn(locale, key as TranslationKey, vars);

  const perUserBytes = serverMediaCeiling().perUserBytes;

  /** The free half. An instance with no ceiling has nothing to say about
   *  storage, so that line is dropped rather than shown empty. */
  const free = [
    t("pricing.freeJournal", { count: String(MAX_JOURNALS_PER_EMAIL) }),
    ...(perUserBytes === null
      ? []
      : [t("pricing.freeStorage", { size: formatBytes(perUserBytes) })]),
    t("pricing.freeTrips"),
    t("pricing.freeReaders"),
    t("pricing.freeEmail"),
    t("pricing.freeAgent"),
    t("pricing.freeMaps"),
    t("pricing.freeImporters"),
    t("pricing.freeExport"),
  ];

  /** A floor, not a price — B1425. A book is one product at one price that
   *  depends on its size, its page count and where it goes, so the table
   *  shows what the smallest one costs (`PHOTOBOOK_QUOTE_MINIMUM`, the
   *  smallest book Gelato prints, quoted live) and says "from". */
  const photobookRappen = creditsInRappen(
    photobookPriceCredits(PHOTOBOOK_QUOTE_MINIMUM.printMinor, PHOTOBOOK_QUOTE_MINIMUM.shipMinor),
  );

  const rows: { label: string; detail: string; rappen: number; from?: boolean }[] = [
    {
      label: t("pricing.rowHelp"),
      detail: t("pricing.rowHelpDetail", {
        photos: String(PHOTOS_PER_CREDIT),
        minutes: String(MINUTES_PER_CREDIT),
      }),
      rappen: creditsInRappen(WRITE_DAY_CREDITS),
    },
    {
      label: t("pricing.rowWhatsapp"),
      detail: t("pricing.rowWhatsappDetail"),
      rappen: creditsInRappen(1),
    },
    {
      label: t("pricing.rowPostcard"),
      detail: t("pricing.rowPostcardDetail"),
      rappen: creditsInRappen(POSTCARD_CREDITS),
    },
    {
      label: t("pricing.rowStorage", { size: formatBytes(EXTRA_STORAGE_BYTES) }),
      detail: t("pricing.rowStorageDetail"),
      rappen: creditsInRappen(EXTRA_STORAGE_CREDITS),
    },
    {
      label: t("pricing.rowPhotobookPrint"),
      detail: t("pricing.rowPhotobookPrintDetail"),
      rappen: photobookRappen,
      from: true,
    },
  ];

  return (
    <section className="mt-12" aria-labelledby="pricing-title">
      <h2 id="pricing-title" className="font-display text-2xl font-semibold text-navy-900">
        {t("pricing.title")}
      </h2>
      <p className="mt-2 leading-relaxed text-navy-700">{t("pricing.lede")}</p>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-navy-200 bg-cream-50 p-5">
          <h3 className="font-display text-lg font-semibold text-navy-900">
            {t("pricing.freeTitle")}
          </h3>
          <ul className="mt-3 space-y-1.5">
            {/* The signup gift, first and highlighted: the one place credits
                lead, because it is a credit balance a new journal actually
                receives (`SIGNUP_CREDIT_GRANT`, granted once at signup). */}
            <li className="-mx-2 flex gap-2 rounded-lg bg-yellow-300/60 px-2 py-1 text-yellow-950">
              <Check className="mt-1 h-4 w-4 shrink-0" aria-hidden strokeWidth={2.4} />
              <span>
                <span className="block font-semibold">
                  {t("pricing.freeGrant", { credits: String(SIGNUP_CREDIT_GRANT) })}
                </span>
                <span className="block text-sm">
                  {t("pricing.freeGrantDetail", {
                    value: formatChf(creditsInRappen(SIGNUP_CREDIT_GRANT)),
                    credits: String(SIGNUP_CREDIT_GRANT),
                  })}
                </span>
              </span>
            </li>
            {free.map((item) => (
              <li key={item} className="flex gap-2 text-navy-700">
                <Check
                  className="mt-1 h-4 w-4 shrink-0 text-navy-500"
                  aria-hidden
                  strokeWidth={2.4}
                />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-xl border border-navy-200 bg-cream-50 p-5">
          <h3 className="font-display text-lg font-semibold text-navy-900">
            {t("pricing.creditsTitle")}
          </h3>
          <p className="mt-1 text-sm text-navy-600">{t("pricing.creditsLede")}</p>
          <ul className="mt-3 divide-y divide-navy-200">
            {rows.map((row) => (
              <li key={row.label} className="flex items-baseline justify-between gap-3 py-2">
                <span className="min-w-0">
                  <span className="block text-navy-900">{row.label}</span>
                  <span className="block text-sm text-navy-600">{row.detail}</span>
                </span>
                <span className="shrink-0 text-right font-semibold tabular-nums text-navy-900">
                  {row.from
                    ? t("pricing.fromPrice", { price: formatChf(row.rappen) })
                    : formatChf(row.rappen)}
                </span>
              </li>
            ))}
          </ul>
          {/* The one place credits are explained: the unit, the gift's worth,
              the smallest purchase and the best rate — all arithmetic on the
              price function, nothing typed into a locale string. */}
          <p className="mt-3 text-sm leading-6 text-navy-600">
            {t("pricing.creditNote", {
              one: formatChf(creditsInRappen(1)),
              grant: String(SIGNUP_CREDIT_GRANT),
              grantValue: formatChf(creditsInRappen(SIGNUP_CREDIT_GRANT)),
              min: formatChf(priceRappen(MIN_CREDITS)),
              best: formatChf(Math.round(priceRappen(MAX_CREDITS) / MAX_CREDITS)),
            })}
          </p>
        </div>
      </div>
    </section>
  );
}
