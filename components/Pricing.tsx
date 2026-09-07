import { Check } from "lucide-react";
import { SIGNUP_CREDIT_GRANT } from "@/lib/credits";
import {
  BASE_RAPPEN_PER_CREDIT,
  EXTRA_STORAGE_BYTES,
  EXTRA_STORAGE_CREDITS,
  MAX_CREDITS,
  MIN_CREDITS,
  POSTCARD_CREDITS,
  creditsInRappen,
  formatChf,
  photobookCredits,
  photobookPrintCredits,
  PHOTOBOOK_QUOTE_EXAMPLE,
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
 * What this costs, before anybody signs up — B840.
 *
 * The prices existed and were unreachable: the first place a person met one
 * was the "Buy credits" panel on their own account page, which is behind
 * signing up. So somebody deciding whether to use this had to commit in order
 * to find out whether it was free.
 *
 * **Every figure here is read from the constant that charges it.** Not one
 * number is typed into a translation string — the strings carry `{credits}`
 * and `{price}` and this file fills them in, because a price kept in two
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
 * nothing, and "20 credits per postcard" would be a straight lie there; a
 * self-hoster gets no pricing table, which is correct, because they are the
 * one paying the printer.
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

  /** Two rows, because there are two things to buy and they cost very
   *  different amounts. Laying the book out is a flat charge whatever the
   *  trip; printing it is quoted per order, because postage to Sydney is not
   *  postage to Zurich. The printed figure is the example book every measured
   *  number in `lib/credits/pricing.ts` was taken from, so the table and the
   *  constants cannot quote different books. */
  const photobookFrom = photobookCredits();
  const photobookPrintExample = photobookPrintCredits(
    PHOTOBOOK_QUOTE_EXAMPLE.printMinor,
    PHOTOBOOK_QUOTE_EXAMPLE.shipMinor,
  );

  const rows: { label: string; detail: string; credits: number; from?: boolean }[] = [
    {
      label: t("pricing.rowHelp"),
      detail: t("pricing.rowHelpDetail", {
        photos: String(PHOTOS_PER_CREDIT),
        minutes: String(MINUTES_PER_CREDIT),
      }),
      credits: WRITE_DAY_CREDITS,
    },
    { label: t("pricing.rowWhatsapp"), detail: t("pricing.rowWhatsappDetail"), credits: 1 },
    {
      label: t("pricing.rowPostcard"),
      detail: t("pricing.rowPostcardDetail"),
      credits: POSTCARD_CREDITS,
    },
    {
      label: t("pricing.rowStorage", { size: formatBytes(EXTRA_STORAGE_BYTES) }),
      detail: t("pricing.rowStorageDetail"),
      credits: EXTRA_STORAGE_CREDITS,
    },
    {
      label: t("pricing.rowPhotobook"),
      detail: t("pricing.rowPhotobookDetail"),
      credits: photobookFrom,
    },
    {
      label: t("pricing.rowPhotobookPrint"),
      detail: t("pricing.rowPhotobookPrintDetail", {
        pages: String(PHOTOBOOK_QUOTE_EXAMPLE.pages),
      }),
      credits: photobookPrintExample,
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
          <p className="mt-1 text-sm text-navy-600">
            {t("pricing.creditsLede", { price: formatChf(creditsInRappen(1)) })}
          </p>
          <ul className="mt-3 divide-y divide-navy-200">
            {rows.map((row) => (
              <li key={row.label} className="flex items-baseline justify-between gap-3 py-2">
                <span className="min-w-0">
                  <span className="block text-navy-900">{row.label}</span>
                  <span className="block text-sm text-navy-600">{row.detail}</span>
                </span>
                <span className="shrink-0 text-right font-semibold tabular-nums text-navy-900">
                  {row.from
                    ? t("pricing.fromCredits", { credits: String(row.credits) })
                    : row.credits}
                  <span className="block text-xs font-normal text-navy-600">
                    {formatChf(creditsInRappen(row.credits))}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          {/* The range and both ends of the per-credit price, from the price
              function itself — B854 replaced a list of tiers with a slider, so
              there are no rows left to print, and "from X down to Y" is the
              honest summary of a curve. */}
          <p className="mt-3 text-sm leading-6 text-navy-600">
            {t("pricing.range", {
              from: String(MIN_CREDITS),
              to: String(MAX_CREDITS),
              min: formatChf(BASE_RAPPEN_PER_CREDIT),
              max: formatChf(Math.round(priceRappen(MAX_CREDITS) / MAX_CREDITS)),
            })}
          </p>
          <p className="mt-1 text-sm leading-6 text-navy-600">
            {t("pricing.grant", { credits: String(SIGNUP_CREDIT_GRANT) })}
          </p>
        </div>
      </div>
    </section>
  );
}
