import { isEnabled } from "@/lib/capabilities";
import { isOwner } from "@/lib/contacts/session";
import { photobookPrintCredits } from "@/lib/credits/pricing";
import { isoCountry } from "@/lib/photobook/country";
import { getPhotobookOrder, proposePrint, type PhotobookPayload } from "@/lib/photobook/orders";
import { quoteBook } from "@/lib/photobook/gelato";
import { bookAddressFor, bookRecipients } from "@/lib/photobook/recipients";
import { BOOK_SIZES } from "@/lib/photobook/spec";
import { nowIso } from "@/lib/db";
import { serverSite } from "@/lib/site";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

/**
 * `POST /api/v1/<user>/photobooks/<id>/print` — propose printing a built book
 * — the photobook counterpart of `POST /api/v1/<user>/postcards`, following
 * its reasoning exactly.
 *
 * **This charges nothing and prints nothing.** It names who the book should
 * go to, quotes what that will cost, writes both onto the order, and answers
 * with the URL of the owner's own order page. Pressing the button there is
 * the only thing that spends credits or reaches the printer — the function
 * that submits an order to it is called from that owner page and from
 * nowhere under `app/api`, and a test asserts as much by name.
 *
 * **`contactId`, never an address.** The list to choose from is
 * `GET /api/v1/<user>/postcards/recipients`, which names the same population
 * a book may be posted to — names and towns, never a street. An id that is
 * not on that list is refused by name.
 */

type Body = { contactId?: unknown };

function bad(error: string, message: string, extra: Record<string, unknown> = {}) {
  return Response.json({ error, message, ...extra }, { status: 400 });
}

export async function POST(
  request: Request,
  { params }: RouteContext<"/api/v1/[user]/photobooks/[id]/print">,
) {
  const { user, id } = await params;

  if (!getUser(user) || !isEnabled("photobook", user)) {
    return Response.json(
      {
        error: "photobook_disabled",
        message:
          "This journal does not have photobooks switched on. /api/health says which " +
          "capabilities are on and why.",
      },
      { status: 404 },
    );
  }
  if (!(await isOwner(user, request))) {
    return Response.json(
      {
        error: "forbidden",
        message:
          "Only the address that owns this journal may propose printing its books — not a " +
          "token scoped to one of its trips. Nothing has been charged.",
      },
      { status: 403 },
    );
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return bad("invalid_json", "The body must be JSON.");
  }
  const contactId = typeof body.contactId === "string" ? body.contactId.trim() : "";
  if (!contactId) {
    return bad(
      "invalid_request",
      "contactId is required — a name and a town, not an address, so this journal knows who " +
        "the book is for. GET /api/v1/" + user + "/postcards/recipients lists who may receive one.",
    );
  }

  const order = await getPhotobookOrder(user, id);
  if (!order) return Response.json({ error: "unknown_order", message: "No photobook order of that id." }, { status: 404 });
  if (order.status !== "printed") {
    return bad(
      "not_built",
      `This order is "${order.status}", not built and ready to print. Wait for the build to ` +
        "finish, or ask about a different order.",
    );
  }

  const recipients = await bookRecipients(user);
  if (!recipients.some((r) => r.id === contactId)) {
    return bad(
      "unknown_contact",
      "That is not a contact this journal can post a book to: they are not an approved " +
        "contact with an address on file. There is no way to address a book to anybody else " +
        "— that is deliberate.",
    );
  }

  const size = BOOK_SIZES[order.payload.options.size];
  const to = size ? await bookAddressFor(user, contactId) : null;
  if (!size || !to) {
    return bad("not_built", "This order names a book size this server no longer prints.");
  }
  const country = isoCountry(to.country);
  if (!country) {
    return bad(
      "unknown_country",
      `"${to.country}" is not a country this journal's printer can quote postage to. Ask the ` +
        "owner to correct the contact's address.",
    );
  }

  const quote = await quoteBook({
    productUid: size.productUid,
    pageCount: order.payload.pages,
    country,
    // The same currency the owner's own print step quotes and charges in —
    // kept as a literal rather than imported from that module, which a test
    // asserts nothing under app/api names.
    currency: "CHF",
  });
  if ("error" in quote) {
    return Response.json(
      {
        error: "provider_unavailable",
        message: "The printer could not be reached for a quote. Nothing was changed; try again shortly.",
      },
      { status: 502 },
    );
  }

  const quotedCredits = photobookPrintCredits(quote.printMinor, quote.shipMinor);
  const payload: PhotobookPayload = {
    ...order.payload,
    print: {
      contactId,
      quotedCredits,
      quotedAt: nowIso(),
      shipmentMethodUid: quote.shipmentMethodUid,
    },
  };
  const wrote = await proposePrint(user, id, payload);
  if (!wrote) {
    return bad("not_built", "This order changed status while the quote was being fetched. Ask about it again.");
  }

  return Response.json(
    {
      // Where a person goes to look at the price and press the button.
      // Nothing has been printed or charged; say so, not that a book is on
      // its way.
      url: `${serverSite().url}/${user}/photobooks/${id}`,
      quotedCredits,
      contactId,
      next: "Nothing has been printed or charged. Ask the owner to open the URL and press the button.",
    },
    { status: 201 },
  );
}
