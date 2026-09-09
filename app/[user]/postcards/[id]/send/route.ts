import { isOwner } from "@/lib/contacts/session";
import { sendOrder } from "@/lib/postcard/send";
import { answerJson, backToPreview, wantsJson } from "@/lib/postcard/redirectBack";

export const dynamic = "force-dynamic";

/**
 * The button. The only thing in this codebase that puts a postcard in the post
 * — B434.
 *
 * ## Why it is here and not under `/api/`
 *
 * The design said "there is no send endpoint", and that was a shorthand that
 * needed sharpening the moment it met the browser: a person pressing a button
 * has to reach the server somehow, so what can actually be built is not
 * absence but a door an agent cannot open. This is that door, and three things
 * make it one:
 *
 * - **It is not under `/api/v1/`.** That prefix is the agent's namespace and is
 *   what `/agent.md` documents; nothing here is listed there.
 * - **It takes the owner's cookie and nothing else.** `isOwner` is called
 *   *without* the request, which is the difference that matters: given one it
 *   also accepts an `Authorization: Bearer` agent token (see
 *   `lib/contacts/session.ts`), and given none it can only be satisfied by the
 *   browser session or identity cookie of the address that owns the journal.
 *   An agent token is not a thing you can put in a cookie jar.
 * - **A request carrying a bearer token is refused outright**, rather than
 *   falling through to the cookie check. Same outcome, different sentence: an
 *   agent that tries this gets told why instead of a bare 403 it might read as
 *   a bug and retry around.
 *
 * ## Why a form post, still
 *
 * It is a `<form method="post">` on the page, and with JavaScript off the
 * response is a redirect back to it: no client component, no fetch, no spinner
 * state to get wrong — and it works on a phone with a bad connection in a
 * hostel, which is where this feature is used. Two presses are not a problem
 * either way: `claimForSend` is a conditional update, so the second one changes
 * no row and prints nothing.
 *
 * ## Why it also answers JSON — B982
 *
 * The redirect is a fresh document, and a fresh document at the end of the one
 * press in this product that spends money is a white flash where a
 * confirmation should be. So `PostcardSend` posts this same form with `fetch`
 * and asks for the outcome *word* rather than the page — exactly what the
 * message route has done since B773. Same route, same guards, same refusals,
 * a second way to ask rather than a second set of decisions; the form and the
 * 303 below are untouched and are still what a browser without JavaScript
 * gets.
 */
export async function POST(
  request: Request,
  { params }: RouteContext<"/[user]/postcards/[id]/send">,
) {
  const { user, id } = await params;

  if (request.headers.get("authorization")) {
    return Response.json(
      {
        error: "not_for_agents",
        message:
          "Postcards are sent by the person whose journal it is, from the preview page, and " +
          "never by an agent holding a token. Give them the URL of the order and stop — " +
          "nothing has been printed or charged.",
      },
      { status: 403 },
    );
  }

  const json = wantsJson(request);

  if (!(await isOwner(user))) {
    return json
      ? answerJson("forbidden", 403)
      : backToPreview(user, id, "forbidden");
  }

  const outcome = await sendOrder(user, id);
  const result = outcome.ok ? "sent" : outcome.reason;
  // 200 either way for a refusal the caller is meant to *read out* — every one
  // of these is a sentence for the owner ("not enough credits", "already
  // sent"), not a transport failure, and `PostcardSend` shows the word it is
  // given. `forbidden` above is the exception: that one is about the caller.
  return json ? answerJson(result) : backToPreview(user, id, result);
}
