import type { Metadata } from "next";
import { notFound } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import { isEnabled } from "@/lib/capabilities";
import { isOwner } from "@/lib/contacts/session";
import { formatCredits } from "@/lib/credits/format";
import { creditsInRappen, formatChf } from "@/lib/credits/pricing";
import { fetchOrderStatus } from "@/lib/photobook/gelato";
import { getPhotobookOrder } from "@/lib/photobook/orders";
import { bookAddressFor } from "@/lib/photobook/recipients";
import { visibleBookFiles } from "@/lib/photobook/visibleFiles";
import { addressLines } from "@/components/PhotobookPrintPanel";
import { BOOK_SIZES } from "@/lib/photobook/spec";
import { translateIn, requestLocale } from "@/lib/locales";
import type { TranslationKey } from "@/lib/i18n";
import { getTrip } from "@/lib/trips";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

type StatusTone = "navy" | "yellow" | "green" | "coral";

/**
 * The Gelato words this page has a meaning and a colour for — B1451. Keyed
 * lower-case: `TERMINAL_FAILURES` in `lib/photobook/print.ts` already
 * lower-cases before comparing, because Gelato's sandbox has been seen
 * returning `Cancelled` capitalised.
 *
 * `printed` here is Gelato's word for "the printer has printed it" — not our
 * own order-status column, which B1437 renamed to `built` for exactly this
 * reason.
 */
const KNOWN_STATUSES: Record<string, { key: TranslationKey; tone: StatusTone }> = {
  created: { key: "photobook.print.status.accepted", tone: "navy" },
  passed: { key: "photobook.print.status.accepted", tone: "navy" },
  in_production: { key: "photobook.print.status.inProduction", tone: "yellow" },
  printed: { key: "photobook.print.status.inProduction", tone: "yellow" },
  shipped: { key: "photobook.print.status.shipped", tone: "green" },
  failed: { key: "photobook.print.status.refused", tone: "coral" },
  canceled: { key: "photobook.print.status.refused", tone: "coral" },
  cancelled: { key: "photobook.print.status.refused", tone: "coral" },
};

/**
 * Pill colours, read from `app/globals.css` and nowhere else — `apply-the-brand`.
 * The dot uses each tone's deep token as a fill (`yellow-600` included — a
 * fill, never text, on this palette); the chip itself uses a lighter tint so
 * the label stays legible without leaning on colour alone to carry meaning.
 */
const TONE_CLASSES: Record<StatusTone, string> = {
  navy: "border-navy-300 bg-navy-100 text-navy-800",
  yellow: "border-yellow-400 bg-yellow-300 text-yellow-950",
  green: "border-green-500 bg-green-100 text-green-700",
  coral: "border-coral-600 bg-coral-100 text-coral-600",
};

const DOT_CLASSES: Record<StatusTone, string> = {
  navy: "bg-navy-600",
  yellow: "bg-yellow-600",
  green: "bg-green-700",
  coral: "bg-coral-600",
};

/**
 * The owner's receipt page for a photobook order — B434's photobook
 * counterpart, and the page `app/[user]/photobook/order/route.ts` redirects
 * to once a book has been bought and sent to the printer.
 *
 * Owner cookie only, and 404 for everybody else rather than a sign-in
 * prompt: the URL is only ever reached from that redirect or from the
 * owner's own trip page, so a signed-out visitor here is not the flow's
 * normal shape.
 *
 * What it shows: what the book is, the download links for its built PDFs,
 * and the printer's own status once it has one, as a small colour-coded pill
 * (B1451). The instance is live now, so a *recognised* Gelato word gets a
 * translated label and a colour from `KNOWN_STATUSES` below. **A word this page
 * has not mapped must never be given a meaning or a colour it has not
 * earned** — Gelato can add a status tomorrow, and colouring an unknown one
 * green or red would be inventing a fact about somebody's book. So an
 * unrecognised status still prints the raw English word, untranslated, in
 * the neutral navy tone — exactly what this page did for every status before
 * this ticket, back when Gelato's sandbox reported `Cancelled` for every
 * order it accepted and no word could be trusted at all.
 *
 * B1428 deleted the pre-B1157 door this page used to also serve: proposing
 * and then pressing a *separate* print charge for a book bought for its
 * build alone. Every book on this page now either was bought printed in one
 * press (`print.contactId` present) or predates that model entirely — a
 * handful of demo-journal rows with no print door left to offer.
 */
export default async function PhotobookOrderPage({
  params,
}: PageProps<"/[user]/photobooks/[id]">) {
  const { user: username, id } = await params;

  const user = getUser(username);
  if (!user || !isEnabled("photobook", username)) notFound();
  if (!(await isOwner(username))) notFound();

  const order = await getPhotobookOrder(username, id);
  if (!order) notFound();

  const locale = await requestLocale();
  const t = (key: TranslationKey, vars?: Record<string, string>) => translateIn(locale, key, vars);

  const trip = getTrip(order.payload.trip);
  const size = BOOK_SIZES[order.payload.options.size];
  const files = visibleBookFiles(order.payload.files ?? []);
  const print = order.payload.print;

  // What the print section shows: a colour-coded pill for the printer's own
  // status once it has one (B1451), plus one line of context under it. The
  // two are computed separately (B1454) — a refused order almost always
  // *still* carries a providerRef (Gelato accepts the order, hands back an
  // id, and only then refuses it), so whether the credits are back can never
  // be gated on which branch drew the pill. It is a fact about
  // `print.failure`, read on its own.
  let pill: { tone: StatusTone; label: string } | null = null;
  // The known status this order's pill matched, if any — used only to pick
  // the context line below, never to redraw the pill itself.
  let matchedKey: TranslationKey | null = null;

  if (print?.providerRef) {
    const gelatoStatus = await fetchOrderStatus(print.providerRef);
    if (gelatoStatus) {
      const known = KNOWN_STATUSES[gelatoStatus.toLowerCase()];
      // The one rule that matters more than the styling: a word this page
      // has not mapped gets no colour and no translation, ever — just the
      // raw word Gelato sent, in the neutral tone. Gelato can add a status
      // tomorrow, and colouring an unrecognised one green or red would be
      // inventing a fact about somebody's book.
      pill = known ? { tone: known.tone, label: t(known.key) } : { tone: "navy", label: gelatoStatus };
      matchedKey = known?.key ?? null;
    } else {
      pill = { tone: "navy", label: t("photobook.print.status.unknown") };
    }
  } else if (print?.failure) {
    /**
     * Bought printed, and the printer would not take it, with the failure
     * caught before an order id ever came back — the rarer shape (B1157/B1330).
     *
     * This page is a **receipt** for such a book, never a second checkout:
     * ordering it again is the trip's photobook page's job, because there is
     * one place that buys a book and this is not it. Nothing here says *why*
     * the printer refused — on a hosted instance that is the operator's
     * account, not this owner's business (B1165).
     */
    pill = { tone: "coral", label: t("photobook.print.status.refused") };
  }

  // Extra sentence under the pill — one line of context per mapped state,
  // reusing the raw Gelato/order state rather than the pill's colour, and
  // nothing at all for a state this page has not mapped (B1451's rule for
  // colour applies to prose too: no invented explanation for a status we
  // do not recognise).
  let statusText: string | null = null;
  if (print?.failure) {
    // Whether the credits are already back is a fact about the order's own
    // failure record — set once, alongside the refund, by
    // `settleRefusedPrint` — and true regardless of which branch above drew
    // the pill (B1454).
    statusText = t("photobook.print.refusedRefunded", {
      credits: formatCredits(order.payload.credits),
    });
  } else if (matchedKey === "photobook.print.status.accepted") {
    statusText = t("photobook.print.context.accepted");
  } else if (matchedKey === "photobook.print.status.inProduction") {
    statusText = t("photobook.print.context.inProduction");
  } else if (matchedKey === "photobook.print.status.shipped") {
    statusText = t("photobook.print.context.shipped");
  } else if (!print?.providerRef && !print?.failure) {
    // No print was ever completed for this order — a book from before this
    // instance addressed a book at the moment it was bought (pre-B1157),
    // which is the shape B1428 removed the print door for. The files below
    // are the whole of what this page can offer it.
    statusText = t("photobook.print.legacyNoPrintDoor");
  }

  /**
   * What it cost — B1461.
   *
   * `payload.credits` is the number that was actually charged, frozen at the
   * press (`order/route.ts`), so this is a record rather than a fresh quote:
   * the price table may have moved since, and a receipt that re-prices itself
   * is not a receipt. The about-CHF figure beside it is `creditsInRappen`,
   * the same ceiling valuation the till used (`photobook.price`) — never
   * `priceRappen`, which answers a different question ("what would buying
   * this many cost today").
   *
   * Gelato's own `quotedMinor`/`quotedCurrency` is deliberately not here.
   * That is what the print cost *this instance*, which is the operator's
   * business and not the owner's — the same line B1165 drew for the
   * provider's refusal message.
   */
  const refunded = Boolean(print?.failure || order.payload.failure);
  const totalCredits = refunded ? 0 : order.payload.credits;

  // B1367. This page reads as the receipt it structurally is, rather than
  // an unstyled h1 and a bare underlined list: a head block naming the trip
  // and the physical object, a colour-coded status block for what the
  // printer has said, and a downloads card. No cover figure — nothing here
  // renders a thumbnail of the actual cover PDF, and that is deliberate;
  // building one is a server-side pipeline this ticket does not add.
  const isFailure = pill?.tone === "coral";
  const bookSizeLabel = size?.name ?? order.payload.options.size;

  // Who it is going to — B1458. A contact removed or un-approved since the
  // order was placed simply resolves to `null`, same as `bookAddressFor`
  // returns for any id it cannot find; the envelope is dropped, not thrown.
  const recipientAddress = print?.contactId ? await bookAddressFor(username, print.contactId) : null;

  return (
    <div className="min-h-screen">
      <PageHeader />
      <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
        <div className="border-b border-navy-200 pb-6">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-navy-500">
            {t("photobook.title")}
          </p>
          {/* This page has nothing to sell — a book is bought and printed in
              one press on the trip's own photobook page (B1157) — so it
              always reads as the receipt it is. */}
          <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-navy-900 sm:text-3xl">
            {t("photobook.print.receiptTitle")}
          </h1>
          <p className="mt-2 text-sm text-navy-600">
            {t(
              order.payload.volumes === 1
                ? "photobook.print.orderIntro.one"
                : "photobook.print.orderIntro",
              {
                trip: trip?.title ?? order.payload.trip,
                pages: String(order.payload.pages),
                volumes: String(order.payload.volumes),
                size: bookSizeLabel,
              },
            )}
          </p>
        </div>

        {/* Price — B1461. An invoice rather than a sentence: the line, the
            refund if there was one, and a total. One line item because there
            is one price (B1425) — the build/print split it could have been
            broken down into stopped existing. */}
        <section className="mt-6 rounded-lg border border-navy-200 bg-white">
          <h2 className="border-b border-navy-200 px-4 py-3 font-display text-base font-semibold text-navy-900">
            {t("photobook.receipt.priceHeading")}
          </h2>
          <dl className="divide-y divide-navy-100">
            <div className="flex items-baseline justify-between gap-4 px-4 py-3">
              <dt className="text-sm text-navy-700">{t("photobook.receipt.line")}</dt>
              <dd className="shrink-0 font-mono text-sm text-navy-900">
                {t("photobook.receipt.credits", { credits: formatCredits(order.payload.credits) })}
              </dd>
            </div>
            {refunded ? (
              <div className="flex items-baseline justify-between gap-4 px-4 py-3">
                <dt className="text-sm text-navy-700">{t("photobook.receipt.refunded")}</dt>
                <dd className="shrink-0 font-mono text-sm text-navy-900">
                  {t("photobook.receipt.creditsNegative", {
                    credits: formatCredits(order.payload.credits),
                  })}
                </dd>
              </div>
            ) : null}
            <div className="flex items-baseline justify-between gap-4 bg-cream-50 px-4 py-3">
              <dt className="text-sm font-semibold text-navy-900">{t("photobook.receipt.total")}</dt>
              <dd className="shrink-0 text-right">
                <span className="block font-mono text-base font-semibold text-navy-900">
                  {t("photobook.receipt.credits", { credits: formatCredits(totalCredits) })}
                </span>
                <span className="block text-xs text-navy-600">
                  {t("photobook.receipt.about", {
                    money: formatChf(creditsInRappen(totalCredits)),
                  })}
                </span>
              </dd>
            </div>
          </dl>
          {/* The date as it is stored, not as a locale renders it: a receipt
              is read back months later, sometimes beside a bank statement,
              and an unambiguous date beats a pretty one. */}
          <p className="border-t border-navy-100 px-4 py-3 text-xs text-navy-600">
            {t("photobook.receipt.meta", { date: order.createdAt.slice(0, 10), id: order.id })}
          </p>
        </section>

        {/* Printing status — a title, a colour-coded pill for the printer's
            own state (B1451), and whatever detail this state has to add.
            Coral is reserved for the one state that is an actual failure;
            every other state (in progress, or no print door at all) reads as
            ordinary navy. */}
        <section
          id="print"
          className={`mt-6 scroll-mt-4 rounded-lg border px-4 py-4 ${
            isFailure ? "border-coral-300 bg-coral-50" : "border-navy-200 bg-white"
          }`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <p className={`font-semibold ${isFailure ? "text-coral-600" : "text-navy-900"}`}>
              {t("photobook.print.heading")}
            </p>
            {pill ? (
              <span
                className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold ${TONE_CLASSES[pill.tone]}`}
              >
                <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT_CLASSES[pill.tone]}`} />
                {pill.label}
              </span>
            ) : null}
          </div>

          {statusText ? <p className="mt-2 text-sm text-navy-700">{statusText}</p> : null}

          {/* Who it is going to — B1458. Same envelope shape as the ordering
              panel (B1145): the name centred over the whole address. */}
          {recipientAddress ? (
            <address className="mt-3 rounded-lg border border-dashed border-navy-300 bg-cream-50 px-3 py-3 text-center not-italic">
              <span className="block text-[0.7rem] font-semibold uppercase tracking-wider text-navy-600">
                {t("photobook.print.toLabel")}
              </span>
              <span className="mt-1 block text-base font-semibold text-navy-900">
                {recipientAddress.name}
              </span>
              {addressLines(recipientAddress).map((line) => (
                <span key={line} className="block text-sm text-navy-700">
                  {line}
                </span>
              ))}
            </address>
          ) : null}

          {/* B1440. Every parcel Gelato has reported, beside the printer's
              own status — a book can ship in more than one, and each one
              gets its own line and, where the carrier gave one, its own
              tracking link. */}
          {print?.tracking && print.tracking.length > 0 ? (
            <ul className="mt-3 space-y-1 border-t border-navy-100 pt-3">
              {print.tracking.map((code) => (
                <li key={code.code} className="text-sm text-navy-700">
                  {code.url ? (
                    <a
                      className="font-semibold text-navy-900 underline hover:no-underline"
                      href={code.url}
                    >
                      {code.carrier
                        ? t("photobook.print.trackingWithCarrier", { code: code.code, carrier: code.carrier })
                        : t("photobook.print.tracking", { code: code.code })}
                    </a>
                  ) : code.carrier ? (
                    t("photobook.print.trackingWithCarrier", { code: code.code, carrier: code.carrier })
                  ) : (
                    t("photobook.print.tracking", { code: code.code })
                  )}
                </li>
              ))}
            </ul>
          ) : null}
        </section>

        {/* Downloads — a labelled card, one row per file. B1366 has already
            dropped the print-only interior/cover halves nobody reading this
            page needs; a single-volume book is one row for book.pdf. */}
        <section className="mt-6 rounded-lg border border-navy-200 bg-white">
          <h2 className="border-b border-navy-200 px-4 py-3 font-display text-base font-semibold text-navy-900">
            {t("photobook.downloadFile")}
          </h2>
          {files.length > 0 ? (
            <ul className="divide-y divide-navy-100">
              {files.map((file) => (
                <li key={file} className="flex items-center gap-3 px-4 py-3">
                  <span
                    aria-hidden
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-navy-100 text-[10px] font-bold tracking-wide text-navy-700"
                  >
                    PDF
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-navy-900">{file}</p>
                    <p className="truncate text-xs text-navy-600">{bookSizeLabel}</p>
                  </div>
                  <a
                    className="shrink-0 rounded-full border border-navy-300 px-3 py-1.5 text-xs font-semibold text-navy-800 transition-colors hover:bg-navy-50"
                    href={`/${username}/photobooks/${id}/${file}`}
                  >
                    {t("photobook.downloadFile")}
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-4 py-3 text-sm text-navy-600">{t("photobook.print.noFiles")}</p>
          )}
        </section>
      </main>
    </div>
  );
}
