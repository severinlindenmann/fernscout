import type { Metadata } from "next";
import { notFound } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import PhotobookPrintPanel from "@/components/PhotobookPrintPanel";
import { isEnabled } from "@/lib/capabilities";
import { isOwner } from "@/lib/contacts/session";
import { balanceOf, creditsEnabled } from "@/lib/credits";
import { photobookPrintCredits } from "@/lib/credits/pricing";
import { isoCountry } from "@/lib/photobook/country";
import { fetchOrderStatus, quoteBook } from "@/lib/photobook/gelato";
import { getPhotobookOrder } from "@/lib/photobook/orders";
import {
  PHOTOBOOK_PRINT_OUTCOME_STATES,
  type PrintOutcomeState,
} from "@/lib/photobook/print";
import { bookAddressFor, bookRecipients } from "@/lib/photobook/recipients";
import { BOOK_SIZES } from "@/lib/photobook/spec";
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
  const files = order.payload.files ?? [];
  const print = order.payload.print;

  const resultParam = query.print;
  const outcome =
    typeof resultParam === "string" && isPrintOutcomeState(resultParam) ? resultParam : null;

  // What the print section shows: a status once Gelato has an order, a live
  // quote once a recipient has been proposed and the book is still waiting,
  // or a note that nobody has proposed one yet. Never all three at once.
  let statusText: string | null = null;
  let panel: React.ReactNode = null;

  if (print?.providerRef) {
    const gelatoStatus = await fetchOrderStatus(print.providerRef);
    statusText = t("photobook.print.status", {
      status: gelatoStatus ?? t("photobook.print.status.unknown"),
    });
  } else if (order.status === "printed" && print) {
    const recipients = await bookRecipients(username);
    const recipient = recipients.find((r) => r.id === print.contactId);
    const to = recipient ? await bookAddressFor(username, print.contactId) : null;
    const country = to ? isoCountry(to.country) : null;
    if (!recipient || !to) {
      statusText = t("photobook.print.noLongerEligible");
    } else if (!size) {
      statusText = t("photobook.print.notBuilt");
    } else if (!country) {
      statusText = t("photobook.print.unknownCountry");
    } else {
      const quote = await quoteBook({
        productUid: size.productUid,
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
    statusText = t("photobook.print.notProposed");
  }

  return (
    <div className="min-h-screen">
      <PageHeader />
      <main className="mx-auto w-full max-w-2xl px-4 py-8">
        <h1 className="font-display text-2xl font-semibold text-navy-900">
          {t("photobook.print.orderTitle")}
        </h1>
        <p className="mt-1 text-sm text-navy-600">
          {t("photobook.print.orderIntro", {
            trip: trip?.title ?? order.payload.trip,
            pages: String(order.payload.pages),
            volumes: String(order.payload.volumes),
            size: size?.name ?? order.payload.options.size,
          })}
        </p>

        {files.length > 0 ? (
          <ul className="mt-4 space-y-1 text-sm">
            {files.map((file) => (
              <li key={file}>
                <a className="underline" href={`/${username}/photobooks/${id}/${file}`}>
                  {file}
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-navy-600">{t("photobook.print.noFiles")}</p>
        )}

        <section id="print" className="mt-8 scroll-mt-4">
          <h2 className="font-display text-lg font-semibold text-navy-900">
            {t("photobook.print.heading")}
          </h2>

          {outcome ? (
            <p
              role="status"
              className="mt-2 rounded-lg border border-yellow-300 bg-yellow-50 px-3 py-2 text-sm text-yellow-900"
            >
              {t(RESULT[outcome])}
            </p>
          ) : null}

          {statusText ? <p className="mt-2 text-sm">{statusText}</p> : null}
          {panel}
        </section>
      </main>
    </div>
  );
}
