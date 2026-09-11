import type { Metadata } from "next";
import { notFound } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import { isEnabled } from "@/lib/capabilities";
import { isOwner } from "@/lib/contacts/session";
import { formatCredits } from "@/lib/credits/format";
import { fetchOrderStatus } from "@/lib/photobook/gelato";
import { getPhotobookOrder } from "@/lib/photobook/orders";
import { visibleBookFiles } from "@/lib/photobook/visibleFiles";
import { BOOK_SIZES } from "@/lib/photobook/spec";
import { translateIn, requestLocale } from "@/lib/locales";
import type { TranslationKey } from "@/lib/i18n";
import { getTrip } from "@/lib/trips";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

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
 * and the printer's own status once it has one. **Gelato's sandbox reports
 * `Cancelled` for every order it accepts.** That is not a failure and this
 * page does not treat it as one: it prints whatever Gelato says, unexplained,
 * because the honest state of an order this server does not run in
 * production is whatever the printer says it is.
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

  // What the print section shows: the printer's own status once it has one,
  // or — for a book that was paid for and then refused — that the credits
  // are back. Anything else is a book with no print door: bought before
  // B1157 addressed a book at purchase, and never one this page can offer to
  // print now.
  let statusText: string | null = null;
  // B1367. The one status this page has to draw as an actual failure: the
  // printer refused the order and the credits went back. Everything else
  // (in progress, or no print door at all) reads as an ordinary, unremarkable
  // status.
  let statusIsFailure = false;

  if (print?.providerRef) {
    const gelatoStatus = await fetchOrderStatus(print.providerRef);
    statusText = t("photobook.print.status", {
      status: gelatoStatus ?? t("photobook.print.status.unknown"),
    });
  } else if (print?.failure) {
    /**
     * Bought printed, and the printer would not take it — B1157/B1330.
     *
     * This page is a **receipt** for such a book, never a second checkout:
     * ordering it again is the trip's photobook page's job, because there is
     * one place that buys a book and this is not it. Nothing here says *why*
     * the printer refused — on a hosted instance that is the operator's
     * account, not this owner's business (B1165).
     */
    statusText = t("photobook.print.refusedRefunded", {
      credits: formatCredits(order.payload.credits),
    });
    statusIsFailure = true;
  } else {
    // No print was ever completed for this order — a book from before this
    // instance addressed a book at the moment it was bought (pre-B1157),
    // which is the shape B1428 removed the print door for. The files below
    // are the whole of what this page can offer it.
    statusText = t("photobook.print.legacyNoPrintDoor");
  }

  // B1367. This page reads as the receipt it structurally is, rather than
  // an unstyled h1 and a bare underlined list: a head block naming the trip
  // and the physical object, a colour-coded status block for what the
  // printer has said, and a downloads card. No cover figure — nothing here
  // renders a thumbnail of the actual cover PDF, and that is deliberate;
  // building one is a server-side pipeline this ticket does not add.
  const isFailure = statusIsFailure;
  const bookSizeLabel = size?.name ?? order.payload.options.size;

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

        {/* Printing status — one colour-coded block: a dot, a title, and
            whatever detail this state has to add. Coral is reserved for the
            one state that is an actual failure; every other state (in
            progress, or no print door at all) reads as ordinary navy. */}
        <section
          id="print"
          className={`mt-6 scroll-mt-4 rounded-lg border px-4 py-4 ${
            isFailure ? "border-coral-300 bg-coral-50" : "border-navy-200 bg-white"
          }`}
        >
          <div className="flex items-center gap-2">
            <span
              aria-hidden
              className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                isFailure ? "bg-coral-600" : "bg-navy-600"
              }`}
            />
            <p className={`font-semibold ${isFailure ? "text-coral-600" : "text-navy-900"}`}>
              {t("photobook.print.heading")}
            </p>
          </div>

          {statusText ? <p className="mt-2 text-sm text-navy-700">{statusText}</p> : null}
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
