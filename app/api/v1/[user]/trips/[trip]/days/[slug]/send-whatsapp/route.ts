import { authenticate, errorResponse, mayWriteTrip, ownsUser, refuseWrite } from "@/lib/api/auth";
import { whatsappSummary } from "@/lib/api/dayWhatsapp";
import { SESSION_SCOPE } from "@/lib/auth";
import { isTestContent } from "@/lib/access";
import { sendDayWhatsapp } from "@/lib/digest/dayWhatsapp";
import { getEntryBySlug } from "@/lib/entries";
import { getTrip, tripRef } from "@/lib/trips";

export const dynamic = "force-dynamic";

/**
 * `POST /api/v1/<user>/trips/<trip>/days/<slug>/send-whatsapp` — announce a
 * day that is **already** published, again. B365, and the exact counterpart
 * of `send-mail` beside it.
 *
 * Owner only, for the reason `send-mail` gives one door over: a trip-scoped
 * token may write days into its trip and must not be able to message the
 * journal's whole readership. That reasoning is *stronger* here — a letter
 * lands in an inbox, a WhatsApp buzzes in somebody's pocket at breakfast, and
 * a reader who did not want it reports the number rather than unsubscribing.
 * Meta bans the number, and the journal loses the channel for everyone.
 *
 * **Not idempotent, on purpose**, matching `send-mail`: a resend goes to
 * everybody again and says `resend: true` so nothing is ambiguous about it.
 */
export async function POST(
  request: Request,
  { params }: RouteContext<"/api/v1/[user]/trips/[trip]/days/[slug]/send-whatsapp">,
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
          "message the journal's readers about one. Only the journal's owner may.",
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
        message: `"${slug}" is still a draft. Publish it first — there is nothing to announce for a day nobody can read yet.`,
      },
      { status: 409 },
    );
  }
  if (isTestContent(found, entry)) {
    return Response.json(
      {
        error: "test_content",
        message: `"${slug}" is marked test: true — content nobody lived — so it sends no message.`,
      },
      { status: 400 },
    );
  }

  const outcome = await sendDayWhatsapp(user, ref, slug, { resend: true });
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

  return Response.json({ ok: true, slug, ...whatsappSummary(outcome) });
}

/** Stays total rather than assuming which reasons can still reach here —
 * `sendDayWhatsapp` re-checks all of them itself. */
function capabilityMessage(reason: string): string {
  switch (reason) {
    case "whatsapp_off":
      return "WhatsApp is switched off for this server or this journal, so nothing can be sent.";
    case "contacts_off":
      return "Contacts are not enabled for this journal, so there is nobody to message.";
    case "no_template":
      return (
        "Readers have opted in, but no approved template is configured for any language they " +
        "could be written in. Set features.whatsapp.templates in content/config.json."
      );
    case "no_credits":
      return "This journal does not have enough credits left to send this message. Nothing was sent.";
    default:
      return `"${reason}" — nothing was sent.`;
  }
}
