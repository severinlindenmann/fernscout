import { isTestContent } from "@/lib/access";
import { mailSummary } from "@/lib/api/dayMail";
import { whatsappSummary } from "@/lib/api/dayWhatsapp";
import { isEnabled } from "@/lib/capabilities";
import { claimChannel, releaseChannelClaim } from "@/lib/digest/dayNotify";
import { sendDayLetter } from "@/lib/digest/dayLetter";
import { sendDayWhatsapp } from "@paid/whatsapp/lib/digest/dayWhatsapp";
import { sendDaySms, smsSummary } from "@/lib/digest/daySms";
import { AS_AUTHOR, getEntryBySlug } from "@/lib/entries";
import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { refused, wrote } from "@/lib/helper/thread";
import { getTrip, tripRef } from "@/lib/trips";
import { readJsonBody } from "@/lib/api/jsonBody";

export const dynamic = "force-dynamic";

/**
 * The `tell_readers` press — B1051.
 *
 * The wizard's own door onto `POST .../send-mail` and `.../send-whatsapp`,
 * one route for the two the way the tool is one row for the two: a channel
 * field rather than a second path, because the conversation already asked
 * which and there is nothing left here for two routes to disagree about.
 * `sendDayLetter` and `sendDayWhatsapp` are the same functions those routes
 * call, so what actually goes out — and what it costs — is answered once,
 * not reimplemented for the wizard's own flow.
 *
 * **Owner only, and there is no companion's version of it** — the same
 * reasoning `send-mail`'s own comment gives: a trip-scoped token may write
 * days into its trip and must not be able to mail or message the journal's
 * whole readership. `isHelperOwner` is an owner check, not a write check, so
 * that is true here by construction rather than by a second gate.
 */
export async function POST(
  request: Request,
  { params }: RouteContext<"/api/helper/[user]/day/tell-readers">,
) {
  const { user } = await params;
  if (!(await isHelperOwner(user))) {
    return notYourJournal(request, user);
  }
  if (!isEnabled("helper", user)) {
    return Response.json({ error: "helper_unavailable" }, { status: 404 });
  }

  const jsonBody = await readJsonBody(request);
  if (!jsonBody.ok) return jsonBody.response;
  const body = (jsonBody.value) as Record<string, unknown> | null;
  const tripId = typeof body?.trip === "string" ? body.trip.trim() : "";
  const slug = typeof body?.slug === "string" ? body.slug.trim() : "";
  const channel = body?.channel === "whatsapp" || body?.channel === "sms" ? body.channel : "mail";

  const ref = tripRef(user, tripId);
  const trip = getTrip(ref);
  if (!trip) {
    refused(user, "tell_readers", "unknown_trip");
    return Response.json({ error: "unknown_trip" }, { status: 404 });
  }

  const entry = getEntryBySlug(ref, slug, AS_AUTHOR);
  if (!entry) {
    refused(user, "tell_readers", "unknown_day");
    return Response.json({ error: "unknown_day" }, { status: 404 });
  }
  if (entry.draft) {
    refused(user, "tell_readers", "not_published");
    return Response.json(
      {
        error: "not_published",
        message: `"${slug}" is still a draft. Publish it first — there is nothing to tell anybody about yet.`,
      },
      { status: 409 },
    );
  }
  if (isTestContent(trip, entry)) {
    refused(user, "tell_readers", "test_content");
    return Response.json(
      {
        error: "test_content",
        message: `"${slug}" is marked test: true — content nobody lived — so it reaches nobody.`,
      },
      { status: 400 },
    );
  }

  // The double-press guard — B2443. This is not the v2 `…/send` door, which
  // is documented and tested as an explicit resend (`openapi.ts`: "send (or
  // resend) a published day"); `tell_readers` is a person saying "tell them"
  // once, from a conversation, the same as the notify button on the day
  // itself. Claiming the channel first means a repeated press (a retried
  // request, or the model reading the tool twice) finds the channel already
  // spoken for and sends nothing a second time, instead of mailing or
  // messaging the whole readership twice. `{ resend: true }` is gone from
  // the calls below along with it — this route no longer asks for an
  // unconditional resend, so the outcome's own `resend` field is honestly
  // `false`.
  const already = (): Response => {
    refused(user, "tell_readers", "already_sent");
    return Response.json(
      { error: "already_sent", message: `"${slug}" has already been told about on ${channel}.` },
      { status: 409 },
    );
  };

  // Branched fully in each arm, not merged into one `outcome` variable: the
  // two outcome types share no `sent`/`failed` shape (an email versus a
  // masked phone number), so a shared variable would only be reunited by a
  // cast — and a cast here is exactly the kind of "trust me" this file's
  // whole point is to avoid.
  if (channel === "whatsapp") {
    if (!(await claimChannel(user, trip.id, slug, "whatsapp"))) {
      // TODO(B2438): logMessage({ owner: user, template: "day.whatsapp", flow: "tell_readers", channel: "whatsapp", status: "skipped", reason: "deduped" })
      return already();
    }
    const outcome = await sendDayWhatsapp(user, ref, slug);
    if (!outcome.ok) {
      await releaseChannelClaim(user, trip.id, slug, "whatsapp");
      refused(user, "tell_readers", outcome.reason);
      return Response.json(
        { error: outcome.reason },
        { status: outcome.reason === "no_credits" ? 402 : 400 },
      );
    }
    const summary = whatsappSummary(outcome);
    wrote(user, "tell_readers", { trip: tripId, slug, channel, ...summary });
    return Response.json({ ok: true, slug, channel, ...summary });
  }

  if (channel === "sms") {
    // B2292 — the same shape as WhatsApp above, one credit per paying reader.
    if (!(await claimChannel(user, trip.id, slug, "sms"))) {
      // TODO(B2438): logMessage({ owner: user, template: "day.sms", flow: "tell_readers", channel: "sms", status: "skipped", reason: "deduped" })
      return already();
    }
    const outcome = await sendDaySms(user, ref, slug);
    if (!outcome.ok) {
      await releaseChannelClaim(user, trip.id, slug, "sms");
      refused(user, "tell_readers", outcome.reason);
      return Response.json(
        { error: outcome.reason },
        { status: outcome.reason === "no_credits" ? 402 : 400 },
      );
    }
    const summary = smsSummary(outcome);
    wrote(user, "tell_readers", { trip: tripId, slug, channel, ...summary });
    return Response.json({ ok: true, slug, channel, ...summary });
  }

  if (!(await claimChannel(user, trip.id, slug, "mail"))) {
    // TODO(B2438): logMessage({ owner: user, template: "day.mail", flow: "tell_readers", channel: "mail", status: "skipped", reason: "deduped" })
    return already();
  }
  const outcome = await sendDayLetter(user, ref, slug);
  if (!outcome.ok) {
    await releaseChannelClaim(user, trip.id, slug, "mail");
    refused(user, "tell_readers", outcome.reason);
    return Response.json({ error: outcome.reason }, { status: 400 });
  }
  const summary = mailSummary(outcome);
  wrote(user, "tell_readers", { trip: tripId, slug, channel, ...summary });
  return Response.json({ ok: true, slug, channel, ...summary });
}
