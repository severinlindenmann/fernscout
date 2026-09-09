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
  const files = order.payload.files ?? [];
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

  if (print?.providerRef) {
    const gelatoStatus = await fetchOrderStatus(print.providerRef);
    statusText = t("photobook.print.status", {
      status: gelatoStatus ?? t("photobook.print.status.unknown"),
    });
  } else if (order.status === "printed") {
    // B1093. Who this is for is chosen here, not only by an agent beforehand.
    // The owner's own contact is the default — `self` — and `?to=` is how the
    // panel's disclosure asks for somebody else. An existing proposal still
    // wins over both, so a book an agent addressed opens on that person.
    const recipients = await bookRecipients(username);
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
    const to = recipient ? await bookAddressFor(username, recipient.id) : null;
    const country = to ? isoCountry(to.country) : null;
    if (!recipient || !to) {
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
