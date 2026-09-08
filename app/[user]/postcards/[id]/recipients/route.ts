import { isOwner } from "@/lib/contacts/session";
import { postcardCandidates } from "@/lib/postcard/contacts";
import { updateOrderRecipients } from "@/lib/postcard/orders";
import { answerJson, backToPreview, wantsJson } from "@/lib/postcard/redirectBack";

export const dynamic = "force-dynamic";

/**
 * Changing who a card is going to, before it goes — B1005.
 *
 * The third door in this family, and written to the same shape as `/message`
 * and `/crop` beside it: not under `/api/v1/`, satisfied only by the owner's
 * cookie (`isOwner` called *without* the request, which is what excludes a
 * bearer token), a request carrying an `Authorization` header refused outright
 * rather than falling through, and the answer in whichever shape was asked
 * for so the page's `fetch` and a plain form post cannot drift into
 * disagreeing about who may edit.
 *
 * ## Why this is allowed at all
 *
 * The preview page used to say the people were fixed and that changing them
 * meant composing another order — and said it under the writing, which is the
 * work you would then be abandoning. Nothing in the send path required that:
 * `payload.recipients` is read once, at send. So a draft can hold a different
 * list exactly as safely as it holds different words, and
 * `updateOrderRecipients` carries the same `where status = 'draft'` guard the
 * other two do.
 *
 * ## The one thing this route must not get wrong
 *
 * **A card can only go to somebody who asked this journal for one.** That is
 * the promise `postcardCandidates` keeps — consent recorded, an address on
 * file, the contact still active — and it is why the ids in the body are
 * filtered against it rather than trusted. An id that is not a candidate is
 * dropped silently rather than named: this is the owner's own page, so there
 * is nothing to leak, but a refusal that named the id would be a way to ask
 * whether a given contact exists, and there is no reason to build one.
 *
 * Editing does not send and cannot send. Nothing here spends a credit, and the
 * price the page then shows is recomputed by the page from the list it reads
 * back.
 */
export async function POST(
  request: Request,
  { params }: RouteContext<"/[user]/postcards/[id]/recipients">,
) {
  const { user, id } = await params;

  if (request.headers.get("authorization")) {
    return Response.json(
      {
        error: "not_for_agents",
        message:
          "Who a card goes to is decided by the person whose journal it is, on the preview " +
          "page. An agent that wants a different list should compose another order.",
      },
      { status: 403 },
    );
  }

  const json = wantsJson(request);
  const answer = (result: string, status = 200) =>
    json ? answerJson(result, status) : backToPreview(user, id, result);

  if (!(await isOwner(user))) {
    return answer("forbidden", 403);
  }

  const form = await request.formData();
  // `getAll`, because this is a set of checkboxes: one name, many values. A
  // form with every box unticked sends the field not at all, which is an empty
  // list and is refused below rather than read as "leave it as it was".
  const asked = form.getAll("recipient").map((value) => String(value));

  const allowed = new Set(
    (await postcardCandidates(user)).map((candidate) => candidate.contactId),
  );
  const recipients = asked.filter((contactId) => allowed.has(contactId));

  if (recipients.length === 0) {
    return answer("no_recipients", 400);
  }

  const saved = await updateOrderRecipients(user, id, recipients);
  return answer(saved ? "saved" : "already_sent", saved ? 200 : 409);
}
