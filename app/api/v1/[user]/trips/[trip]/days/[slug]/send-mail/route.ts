import { authenticate, errorResponse, mayWriteTrip, ownsUser, refuseWrite } from "@/lib/api/auth";
import { mailSummary } from "@/lib/api/dayMail";
import { SESSION_SCOPE } from "@/lib/auth";
import { isTestContent } from "@/lib/access";
import { sendDayLetter } from "@/lib/digest/dayLetter";
import { getEntryBySlug } from "@/lib/entries";
import { getTrip, tripRef } from "@/lib/trips";

export const dynamic = "force-dynamic";

/**
 * `POST /api/v1/<user>/trips/<trip>/days/<slug>/send-mail` — send the letter
 * for a day that is **already** published, again — B345's second trigger.
 *
 * Everything `.../publish`'s own doc says about who may call this applies
 * here unchanged: owner only, because a trip-scoped token that may write days
 * into its trip must not be able to mail the journal's whole readership
 * (B28's reasoning, one door over).
 *
 * **Not idempotent, on purpose — the opposite of `/publish`.** The owner
 * decided (B345): a resend goes to everybody again, regardless of what an
 * earlier attempt sent, because a deliberate second send is the entire point
 * of the call and the owner pressing it is the only safeguard against doing
 * it twice. The response says `resend: true` so that is never ambiguous.
 */
export async function POST(
  request: Request,
  { params }: RouteContext<"/api/v1/[user]/trips/[trip]/days/[slug]/send-mail">,
) {
  const auth = await authenticate(request);
  if (!auth.ok) return errorResponse(auth);

  const { user, trip, slug } = await params;
  if (!ownsUser(auth.session, user)) {
    return Response.json({ error: "out_of_scope" }, { status: 403 });
  }

  const ref = tripRef(user, trip);
  const found = getTrip(ref);
  if (!found) return Response.json({ error: "unknown_trip" }, { status: 404 });
  const gate = await mayWriteTrip(auth.session, found);
  if (!gate.ok) return refuseWrite(gate);

  if (auth.session.scope !== SESSION_SCOPE.agent) {
    return Response.json(
      {
        error: "out_of_scope",
        message:
          "This token is scoped to one trip, so it can write days into that trip but cannot " +
          "mail the journal's readers about one. Only the journal's owner may.",
      },
      { status: 403 },
    );
  }

  const entry = getEntryBySlug(ref, slug, { includeDrafts: true });
  if (!entry) return Response.json({ error: "unknown_day" }, { status: 404 });
  if (entry.draft) {
    return Response.json(
      {
        error: "not_published",
        message: `"${slug}" is still a draft. Publish it first — there is no letter for a day nobody can read yet.`,
      },
      { status: 409 },
    );
  }
  if (isTestContent(found, entry)) {
    return Response.json(
      {
        error: "test_content",
        message: `"${slug}" is marked test: true — content nobody lived — so it sends no mail.`,
      },
      { status: 400 },
    );
  }

  const outcome = await sendDayLetter(user, ref, slug, { resend: true });
  if (!outcome.ok) {
    return Response.json(
      {
        error: outcome.reason,
        message: capabilityMessage(outcome.reason),
        ...(outcome.reason === "no_credits"
          ? { needed: outcome.needed, balance: outcome.balance }
          : {}),
      },
      // B366: an empty balance is billing, not a bad request.
      { status: outcome.reason === "no_credits" ? 402 : 400 },
    );
  }

  return Response.json({ ok: true, slug, ...mailSummary(outcome) });
}

/** Only the two reasons that can still reach here — trip, day, draft and test
 * are already answered above — but `sendDayLetter` re-checks them itself
 * (defense in depth), so this stays total rather than assuming. */
function capabilityMessage(reason: string): string {
  switch (reason) {
    case "mail_off":
      return "Mail is switched off for this server or this journal, so no letter can be sent.";
    case "contacts_off":
      return "Contacts are not enabled for this journal, so there is nobody to write to.";
    case "no_credits":
      return "This journal does not have enough credits left to send this letter. Nothing was sent.";
    default:
      return `"${reason}" — nothing was sent.`;
  }
}
