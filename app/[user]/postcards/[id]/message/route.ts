import { isOwner } from "@/lib/contacts/session";
import { updateOrderText } from "@/lib/postcard/orders";
import { defaultLocaleFor, localesFor } from "@/lib/locales";

export const dynamic = "force-dynamic";

/**
 * Correcting the words before the card is printed — B452.
 *
 * The preview page was confirm-only, and for the photograph and the recipients
 * it still is. The words are different: seeing the message laid out on the back
 * of a card is the moment a wrong word becomes obvious, and until this existed
 * the only remedy was to abandon the order and compose another. The signature
 * was worse — it came from `config.json` and could not be changed for one card
 * at all.
 *
 * **The same door as the send route beside it, and deliberately so.** Not under
 * `/api/v1/`, satisfied only by the owner's cookie (`isOwner` called *without*
 * the request, which is what excludes a bearer token), and a request carrying
 * an `Authorization` header is refused outright rather than falling through.
 * An agent that wants to change the words has the honest route: compose another
 * order. This is the page's own form.
 *
 * Editing does not send and cannot send. It is refused once the order leaves
 * `draft`, so a correction arriving while a send is in flight changes no row
 * rather than quietly altering what is being printed.
 */
export async function POST(
  request: Request,
  { params }: RouteContext<"/[user]/postcards/[id]/message">,
) {
  const { user, id } = await params;
  const back = new URL(`/${user}/postcards/${id}`, request.url);

  if (request.headers.get("authorization")) {
    return Response.json(
      {
        error: "not_for_agents",
        message:
          "The words on a card are edited by the person whose journal it is, on the preview " +
          "page. An agent that wants different words should compose another order.",
      },
      { status: 403 },
    );
  }

  if (!(await isOwner(user))) {
    return Response.redirect(withResult(back, "forbidden"), 303);
  }

  const form = await request.formData();
  const message = String(form.get("message") ?? "").trim();
  const from = String(form.get("from") ?? "").trim();
  const asked = String(form.get("locale") ?? "").trim();

  if (!message || !from) {
    return Response.redirect(withResult(back, "empty_text"), 303);
  }

  // Only a language this journal actually writes in. Not a free string: it is
  // rendered back to the owner and compared against a reader's own locale, and
  // a typo silently becoming "the card's language" would make that comparison
  // lie rather than fail.
  const locale = localesFor(user).includes(asked) ? asked : defaultLocaleFor(user);

  const saved = await updateOrderText(user, id, { message, from, locale });
  return Response.redirect(
    // 303 so the browser follows with a GET: reloading the preview must not
    // repost the form.
    withResult(back, saved ? "saved" : "already_sent"),
    303,
  );
}

function withResult(url: URL, result: string): string {
  const next = new URL(url);
  next.searchParams.set("result", result);
  return next.toString();
}
