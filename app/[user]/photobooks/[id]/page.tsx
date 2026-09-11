import type { Metadata } from "next";
import { notFound } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import PhotobookPrintPanel from "@/components/PhotobookPrintPanel";
import { isEnabled } from "@/lib/capabilities";
import { isOwner } from "@/lib/contacts/session";
import { balanceOf, creditsEnabled } from "@/lib/credits";
import { photobookPrintCredits } from "@/lib/credits/pricing";
import { formatCredits } from "@/lib/credits/format";
import { isoCountry } from "@/lib/photobook/country";
import { fetchOrderStatus, quoteBook } from "@/lib/photobook/gelato";
import { getPhotobookOrder } from "@/lib/photobook/orders";
import { visibleBookFiles } from "@/lib/photobook/visibleFiles";
import {
  PHOTOBOOK_PRINT_OUTCOME_STATES,
  type PrintOutcomeState,
} from "@/lib/photobook/print";
import { bookAddressFor, bookRecipients } from "@/lib/photobook/recipients";
import { BOOK_SIZES, productUidFor } from "@/lib/photobook/spec";
import { translateIn, requestLocale } from "@/lib/locales";
import type { TranslationKey } from "@/lib/i18n";
import { getTrip } from "@/lib/trips";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * The owner's order page — B434's photobook counterpart, and the page
 * `app/[user]/photobooks/[id]/print/route.ts` redirects back to.
 *
 * Owner cookie only, and 404 for everybody else rather than a sign-in
 * prompt: unlike a postcard preview, nobody is ever handed this URL to open
 * from outside a session — the agent's own proposal call answers with it,
 * but only after checking the caller is already the owner, so a signed-out
 * visitor here is not the flow's normal shape.
 *
 * What it shows: what the book is, the download links for its built PDFs,
 * and — where a print has been proposed or already sent — the print panel or
 * its status. **Gelato's sandbox reports `Cancelled` for every order it
 * accepts.** That is not a failure and this page does not treat it as one:
 * it prints whatever Gelato says, unexplained, because the honest state of
 * an order this server does not run in production is whatever the printer
 * says it is.
 */
const RESULT: Record<PrintOutcomeState, TranslationKey> = {
  printed: "photobook.print.result.printed",
  forbidden: "photobook.print.result.forbidden",
  unknown_order: "photobook.print.result.unknownOrder",
  not_built: "photobook.print.result.notBuilt",
  already_printing: "photobook.print.result.alreadyPrinting",
  no_recipient: "photobook.print.result.noRecipient",
  // B1164. Reachable only by posting to the route directly: no page offers
  // this button for a book that was bought printed.
  already_paid: "photobook.print.result.alreadyPaid",
  no_credits: "photobook.print.result.noCredits",
  stale_quote: "photobook.print.result.staleQuote",
  unknown_country: "photobook.print.result.unknownCountry",
  provider_unavailable: "photobook.print.result.providerUnavailable",
  refused: "photobook.print.result.refused",
};

function isPrintOutcomeState(value: string): value is PrintOutcomeState {
  return (PHOTOBOOK_PRINT_OUTCOME_STATES as readonly string[]).includes(value);
}

export default async function PhotobookOrderPage({
  params,
  searchParams,
}: PageProps<"/[user]/photobooks/[id]">) {
  const { user: username, id } = await params;
  const query = await searchParams;

  const user = getUser(username);
  if (!user || !isEnabled("photobook", username)) notFound();
  if (!(await isOwner(username))) notFound();

  const order = await getPhotobookOrder(username, id);
  if (!order) notFound();

  const locale = await requestLocale();
  const t = (key: TranslationKey, vars?: Record<string, string>) => translateIn(locale, key, vars);

  const trip = getTrip(order.payload.trip);
  const size = BOOK_SIZES[order.payload.options.size];
  const productUid = size ? productUidFor(size.id, order.payload.options.coverType) : null;
  const files = visibleBookFiles(order.payload.files ?? []);
  const print = order.payload.print;

  const resultParam = query.print;
  const outcome =
    typeof resultParam === "string" && isPrintOutcomeState(resultParam) ? resultParam : null;

  // What the print section shows: a status once Gelato has an order, or —
  // once the book is built — a live quote for whoever it is addressed to,
  // with the panel that prints it. A note can accompany the panel (an agent's
  // proposal that has gone stale), but the status and the panel are never
  // shown together: an order at the printer is not one you can re-address.
  let statusText: string | null = null;
  let panel: React.ReactNode = null;
  // B1367. The one status this page has to draw as an actual failure: the
  // printer refused the order and the credits went back. Everything else
  // (in progress, not built yet, waiting on a recipient, the printer briefly
  // unreachable) reads as an ordinary, unremarkable status.
  let statusIsFailure = false;

  if (print?.providerRef) {
    const gelatoStatus = await fetchOrderStatus(print.providerRef);
    statusText = t("photobook.print.status", {
      status: gelatoStatus ?? t("photobook.print.status.unknown"),
    });
  } else if (print?.paid) {
    /**
     * Bought printed, and the printer would not take it — B1164.
     *
     * This page is a **receipt** for such a book, never a second checkout.
     * Until this branch existed it fell through to the panel below, which
     * quoted the print portion on its own and offered to spend it: 165 credits
     * against the 205 already paid, for the same object. The owner pressed it,
     * and only the refund path made that harmless.
     *
     * So: what happened, and that the money is back. Ordering it again is the
     * wizard's job, because there is one place that buys a book and this is
     * not it. Nothing here says *why* the printer refused — on a hosted
     * instance that is the operator's account, not this owner's business
     * (B1165).
     */
    statusText = t("photobook.print.refusedRefunded", {
      credits: formatCredits(order.payload.credits),
    });
    statusIsFailure = true;
  } else if (order.status === "printed") {
    // B1093. Who this is for is chosen here, not only by an agent beforehand.
    // The owner's own contact is the default — `self` — and `?to=` is how the
    // panel's disclosure asks for somebody else. An existing proposal still
    // wins over both, so a book an agent addressed opens on that person.
    // B1145. The owner sees the whole envelope, so an address is resolved for
    // everybody they could choose — server-side, on a page that 404s for
    // anyone else. `bookRecipients` itself is unchanged and still answers a
    // name and a town, which is what an agent proposing a book receives.
    // A journal has at most a handful of postable contacts, so walking
    // `eligible()` once per person is cheaper than a shape that avoids it.
    const listed = await bookRecipients(username);
    const recipients = (
      await Promise.all(
        listed.map(async (r) => {
          const address = await bookAddressFor(username, r.id);
          return address ? { ...r, address } : null;
        }),
      )
    )
      .filter((r) => r !== null)
      // The owner first: they are the default, and a list whose first row is
      // not the selected one reads as though the choice had been made for
      // them by an ordering they cannot see.
      .sort((a, b) => Number(b.self) - Number(a.self));
    const wanted = typeof query.to === "string" ? query.to : print?.contactId;
    const recipient =
      recipients.find((r) => r.id === wanted) ??
      recipients.find((r) => r.self) ??
      recipients[0];
    // A proposal naming somebody who has since been removed, or lost their
    // address, is worth saying out loud rather than quietly re-addressing the
    // book — the panel below opens on the default instead, which is a
    // different person from the one the agent named.
    if (print && !recipients.some((r) => r.id === print.contactId)) {
      statusText = t("photobook.print.noLongerEligible");
    }
    // Already resolved above, for every candidate — no second lookup.
    const country = recipient ? isoCountry(recipient.address.country) : null;
    if (!recipient) {
      statusText = t("photobook.print.noRecipients");
    } else if (!size || !productUid) {
      statusText = t("photobook.print.notBuilt");
    } else if (!country) {
      statusText = t("photobook.print.unknownCountry");
    } else {
      const quote = await quoteBook({
        productUid,
        pageCount: order.payload.pages,
        country,
        currency: "CHF",
      });
      if ("error" in quote) {
        statusText = t("photobook.print.providerUnavailable");
      } else {
        const quotedCredits = photobookPrintCredits(quote.printMinor, quote.shipMinor);
        panel = (
          <PhotobookPrintPanel
            username={username}
            id={id}
            recipient={recipient}
            recipients={recipients}
            printMinor={quote.printMinor}
            shipMinor={quote.shipMinor}
            currency={quote.currency}
            quotedCredits={quotedCredits}
            balance={creditsEnabled() ? await balanceOf(username) : null}
            t={t}
          />
        );
      }
    }
  } else {
    // Not built, so there is nothing to quote and nobody to quote it for.
    // This used to say "nobody has proposed printing this yet", which was the
    // only thing the page could say about a *built* book too — B1093.
    statusText = t("photobook.print.notBuilt");
  }

  // B1367. This page reads as the receipt it structurally is, rather than
  // an unstyled h1 and a bare underlined list: a head block naming the trip
  // and the physical object, a colour-coded status block for what the
  // printer has said, and a downloads card. No cover figure — nothing here
  // renders a thumbnail of the actual cover PDF, and that is deliberate;
  // building one is a server-side pipeline this ticket does not add.
  const isFailure = statusIsFailure || outcome === "refused";
  const bookSizeLabel = size?.name ?? order.payload.options.size;

  return (
    <div className="min-h-screen">
      <PageHeader />
      <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6">
        <div className="border-b border-navy-200 pb-6">
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-navy-500">
            {t("photobook.title")}
          </p>
          {/* B1164. "Print this book" is an offer, and for a book already
              bought printed this page is a receipt — it has nothing to sell.
              A book built before B1157 still has printing to buy here, and
              keeps the old heading. */}
          <h1 className="mt-1 font-display text-2xl font-semibold tracking-tight text-navy-900 sm:text-3xl">
            {t(print?.paid ? "photobook.print.receiptTitle" : "photobook.print.orderTitle")}
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
            progress, not built yet, waiting on a recipient, the printer
            briefly unreachable) reads as ordinary navy. The branching above
            that decides `statusText`/`panel`/`statusIsFailure` is untouched —
            this only changes how the answer is drawn. */}
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

          {outcome ? (
            <p role="status" className="mt-2 text-sm text-navy-700">
              {t(RESULT[outcome])}
            </p>
          ) : null}

          {statusText ? <p className="mt-2 text-sm text-navy-700">{statusText}</p> : null}

          {panel ? <div className="mt-3">{panel}</div> : null}
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
