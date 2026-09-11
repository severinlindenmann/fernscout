import { isOwner } from "@/lib/contacts/session";
import { isEnabled } from "@/lib/capabilities";
import type { TranslationKey } from "@/lib/i18n";
import { requestLocale, translateIn } from "@/lib/locales";
import { parseOptions } from "@/lib/photobook/options";
import { quoteBookFor } from "@/lib/photobook/quote";
import { followerNames, planFor, priceOf } from "@/lib/photobook/build";
import { captionsFor } from "@/lib/photobook/captions";
import { renderPreview } from "@/lib/photobook/preview";
import { BOOK_SIZES } from "@/lib/photobook/spec";
import { parseTripRef } from "@/lib/trips";

export const dynamic = "force-dynamic";

/**
 * The preview, planned server-side because the planner lives here.
 *
 * Outside `/api/v1/` and satisfied only by the owner's cookie, for the same
 * three reasons `app/[user]/postcards/[id]/send/route.ts` states: the agent
 * namespace is documented elsewhere, `isOwner` is called *without* the request
 * so a bearer token cannot satisfy it, and a request carrying one is refused
 * with a sentence rather than a bare 403 it might retry around. This route
 * charges nothing, but it plans the same book the paying one does, and the two
 * must not disagree about who is allowed to ask.
 */
export async function POST(
  request: Request,
  { params }: RouteContext<"/[user]/photobook/preview">,
) {
  const { user } = await params;

  if (request.headers.get("authorization")) {
    return Response.json(
      {
        error: "not_for_agents",
        message:
          "A photobook is configured and paid for by the person whose journal it is. " +
          "Nothing here answers to a token — give them the URL of the options page instead.",
      },
      { status: 403 },
    );
  }
  // `credits` alongside `photobook` — the same pair `order/route.ts` checks.
  // Without it this route quotes a price nobody at this journal can pay,
  // which is worse than a 404: it looks like an offer.
  if (!isEnabled("photobook", user) || !isEnabled("credits") || !(await isOwner(user))) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as
    | { trip?: unknown; options?: unknown; contactId?: unknown }
    | null;
  const trip = typeof body?.trip === "string" ? body.trip : "";
  // Who the book is going to, so the price below includes their postage —
  // B1157. Optional: the page asks for a preview before anybody has chosen,
  // and a book with no eligible recipient still deserves its page count and
  // its spread.
  const contactId = typeof body?.contactId === "string" ? body.contactId.trim() : "";
  const parsed = parseTripRef(trip);
  const options = parseOptions(body?.options, Object.keys(BOOK_SIZES));
  if (!parsed || parsed.username !== user || !options) {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  // `planFor` reads the trip off disk and throws if the ref does not resolve
  // to one — a stale page (the trip was deleted mid-session) or a malformed
  // one that happened to parse. Either way the honest answer to the browser
  // is the same "not found" as an unparseable ref, not a 500.
  let book;
  try {
    book = planFor(trip, options, await followerNames(user));
  } catch {
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  // The same function `order/route.ts` charges from, so the number on the
  // button and the number taken cannot differ — B1157.
  const quote = contactId ? await quoteBookFor(user, book, options, contactId) : null;

  // The line under each page, in the reader's own language — B562.
  const locale = await requestLocale();
  const t = (key: TranslationKey, vars?: Record<string, string>) =>
    translateIn(locale, key, vars);

  const html = renderPreview(
    book,
    "",
    (file) => file,
    // `BookPhoto.webSrc` is set from the entry's own gallery `src`, which
    // `lib/entries.ts` already ran through `mediaWithOwner` — it is a
    // complete, owner-prefixed URL (`/alex/media/asia-2026/day-one/01.jpg`),
    // exactly the shape `app/[user]/media/[...path]/route.ts` serves. Used
    // as-is: prefixing it again with the username produces `/alex/alex/…`
    // and every image 404s. `BookPhoto.file` is not this — for a trip with
    // kept originals it carries an `originals:` prefix the web server does
    // not serve at all.
    (photo) => photo.webSrc ?? "",
    // The composer's frame, not the technician's page — B548 — and page
    // captions that say where each page came from — B562.
    { bare: true, captionFor: captionsFor(book, t) },
  );

  const page = book.spec;
  return Response.json({
    html,
    // The shape of one spread — two pages side by side, bleed included — so
    // the composer's frame can be exactly one spread tall and the book needs
    // no scrollbar of its own.
    ratio:
      ((page.size.trimWidthMm + page.bleedMm * 2) /
        (page.size.trimHeightMm + page.bleedMm * 2)) *
      2,
    pages: book.volumes.reduce((n, v) => n + v.interiorPages, 0),
    volumes: book.volumes.length,
    // What the button will say — B1157. Building and printing are two costs
    // and one purchase, so this is the total, quoted for whoever the book is
    // going to: postage to Zurich and postage to Sydney are not the same
    // number, and the page must not show one and charge the other.
    //
    // `priceOf` alone is the fallback for the moment before a recipient has
    // been resolved — a journal with no postable contact, or a printer that
    // cannot be reached. The page shows the book's own facts either way and
    // refuses to offer the button, rather than quoting a price that leaves
    // postage out.
    credits: quote && !("error" in quote) ? quote.totalCredits : priceOf(book),
    printCredits: quote && !("error" in quote) ? quote.printCredits : null,
    quoteError: quote && "error" in quote ? quote.error : null,
    warnings: book.warnings,
    // A book with no photographs still plans — `expandToMinimum` pads it to a
    // legal page count — but it is not one anybody should pay 90+ credits
    // for. Refused here, once, rather than trusted to a client-side check the
    // options form might skip: the page disables Pay on `buyable: false`
    // rather than on counting `warnings` itself.
    // Two things now, not one — B1157. A book with no photographs still plans
    // (`expandToMinimum` pads it to a legal page count) and is not one anybody
    // should pay for; and since what is sold is a *printed* book, a book with
    // no quote cannot be bought either, because there is no honest total. Both
    // answered here rather than counted client-side: the page disables the
    // button on this one flag.
    buyable: book.photoCount > 0 && quote !== null && !("error" in quote),
    // B1406. `buyable` alone told the page THAT it must refuse, never WHY —
    // three different causes collapsed onto one boolean, so the panel always
    // rendered the "no photographs" sentence even when the book had 47 of
    // them. Sent explicitly rather than re-derived client-side, so the panel
    // cannot drift from what actually blocked the button.
    unbuyableReason:
      book.photoCount <= 0
        ? "no-photos"
        : quote === null
          ? "no-recipient"
          : "error" in quote
            ? quote.error === "provider_unavailable"
              ? "printer-unavailable"
              // `unknown_contact` / `unknown_country` / `unknown_product` — the
              // chosen contact cannot be posted to (removed, in a country or
              // for a size Gelato has no product for), which reads to the
              // owner exactly like having nobody to send it to.
              : "no-recipient"
            : null,
  });
}
