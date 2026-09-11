import { isEnabled } from "@/lib/capabilities";
import { isOwner } from "@/lib/contacts/session";
import { proposeBookPrint } from "@/lib/photobook/propose";
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

  // Every rule about who may receive a book, and what it costs, is in
  // `proposeBookPrint` — shared with the owner's own order page since B1093,
  // so the two doors cannot come to different answers. What stays here is how
  // a refusal is *said* to an agent, which is a sentence rather than a state.
  const result = await proposeBookPrint(user, id, contactId);
  if (!result.ok) {
    switch (result.reason) {
      case "unknown_order":
        return Response.json(
          { error: "unknown_order", message: "No photobook order of that id." },
          { status: 404 },
        );
      case "not_built":
        return bad(
          "not_built",
          "This order is not built and ready to print, names a book this server no longer " +
            "prints, or changed status while the quote was being fetched. Ask about it again.",
        );
      case "unknown_contact":
        return bad(
          "unknown_contact",
          "That is not a contact this journal can post a book to: they are not an approved " +
            "contact with an address on file. There is no way to address a book to anybody else " +
            "— that is deliberate.",
        );
      case "unknown_country":
        return bad(
          "unknown_country",
          "That contact's country is not one this journal's printer can quote postage to. Ask " +
            "the owner to correct the contact's address.",
        );
      case "provider_unavailable": {
        // B1148. `result.kind` is the real GelatoFailure: `no_key` and
        // `refused` are the printer refusing this server's own account,
        // which retrying cannot fix; `unreachable` is weather. The wire
        // `error` stays the one code either way.
        const operatorFault = result.kind === "no_key" || result.kind === "refused";
        return Response.json(
          {
            error: "provider_unavailable",
            message: operatorFault
              ? "The printer is not accepting this server's account. Nothing was charged — this needs whoever runs the instance."
              : "The printer could not be reached for a quote. Nothing was changed; try again shortly.",
          },
          { status: 502 },
        );
      }
    }
  }
  const { quotedCredits } = result;

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
