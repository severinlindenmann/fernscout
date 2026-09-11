import type { Metadata } from "next";
import { notFound } from "next/navigation";
import PageHeader from "@/components/PageHeader";
import OrderDocket from "@/components/order/OrderDocket";
import { isEnabled } from "@/lib/capabilities";
import { isOwner } from "@/lib/contacts/session";
import { photobookOrderView } from "@/lib/order/view";
import { fetchOrderStatus } from "@/lib/photobook/gelato";
import { getPhotobookOrder } from "@/lib/photobook/orders";
import { bookAddressFor } from "@/lib/photobook/recipients";
import { visibleBookFiles } from "@/lib/photobook/visibleFiles";
import { resolveMediaFile } from "@/lib/media";
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
 * **What this file does not contain any more — B1465.** The status
 * vocabulary, its tone tables, the ledger and the envelope markup were all
 * written out here and, differently, on the postcard page. They now live in
 * `lib/order/view.ts` and `components/order/OrderDocket.tsx`, which the
 * postcard page uses too; `/docs/branding/order` shows every state either can
 * be in. Two copies of a vocabulary is how the two drift, and they already
 * had.
 *
 * What is left here is what only a *page* can do: decide who may look, ask
 * Gelato where the print has got to, and draw the tracking rows, whose links
 * are markup rather than a fact about the order.
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

  const print = order.payload.print;
  // The one thing on this page that is a network call, and the reason the
  // view model takes the answer rather than fetching it: `undefined` means
  // there was nothing to ask about, `null` means the lookup failed, and the
  // two are different sentences.
  const providerStatus = print?.providerRef ? await fetchOrderStatus(print.providerRef) : undefined;

  // A contact removed or un-approved since the order was placed resolves to
  // `null`, same as `bookAddressFor` returns for any id it cannot find; the
  // envelope is dropped, not thrown — B1458.
  const recipient = print?.contactId ? await bookAddressFor(username, print.contactId) : null;

  /**
   * The photograph on the cover — B1469.
   *
   * `options.cover` is the URL of a photograph in the trip's own media, set
   * when the owner chose a cover rather than letting the planner pick one, so
   * it is *absent* on most books and that is a fine answer: the plate falls
   * back to the size and the binding. It is checked against the disk before
   * it is rendered — a trip deleted or a photograph removed since the order
   * would otherwise leave a broken-image icon where somebody's book should
   * be, which is worse than no picture at all.
   *
   * What this is **not** is a render of the printed cover: the title is set
   * over this photograph in the PDF, and nothing here draws that. Doing it
   * properly means rasterising the built cover page, which needs a
   * rasteriser this project does not have.
   */
  const coverUrl = order.payload.options.cover;
  const coverSegments = coverUrl?.startsWith(`/${username}/media/`)
    ? coverUrl.slice(`/${username}/media/`.length).split("/")
    : null;
  const coverImage =
    coverSegments && resolveMediaFile(username, coverSegments) ? coverUrl : undefined;

  const view = photobookOrderView({
    order,
    t,
    tripTitle: getTrip(order.payload.trip)?.title ?? null,
    sizeLabel: BOOK_SIZES[order.payload.options.size]?.name ?? order.payload.options.size,
    providerStatus,
    recipient,
    files: visibleBookFiles(order.payload.files ?? []),
    coverImage,
    fileHref: (file) => `/${username}/photobooks/${id}/${file}`,
  });

  return (
    <div className="min-h-screen">
      <PageHeader />
      <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
        <OrderDocket
          view={view}
          labels={{
            price: t("photobook.receipt.priceHeading"),
            total: t("photobook.receipt.total"),
            goingTo: t("photobook.print.toLabel"),
            files: t("photobook.downloadFile"),
            download: t("photobook.downloadFile"),
            noFiles: t("photobook.print.noFiles"),
          }}
          statusExtra={
            /* B1440. Every parcel Gelato has reported — a book can ship in
               more than one, and each gets its own line and, where the
               carrier gave one, its own link. Markup with links in it, so a
               slot rather than a field on the view model. */
            print?.tracking && print.tracking.length > 0 ? (
              <ul className="mt-3 space-y-1 border-t border-navy-100 pt-3">
                {print.tracking.map((code) => (
                  <li key={code.code} className="text-sm text-navy-700">
                    {code.url ? (
                      <a
                        className="font-semibold text-navy-900 underline hover:no-underline"
                        href={code.url}
                      >
                        {code.carrier
                          ? t("photobook.print.trackingWithCarrier", {
                              code: code.code,
                              carrier: code.carrier,
                            })
                          : t("photobook.print.tracking", { code: code.code })}
                      </a>
                    ) : code.carrier ? (
                      t("photobook.print.trackingWithCarrier", {
                        code: code.code,
                        carrier: code.carrier,
                      })
                    ) : (
                      t("photobook.print.tracking", { code: code.code })
                    )}
                  </li>
                ))}
              </ul>
            ) : null
          }
        />
      </main>
    </div>
  );
}
