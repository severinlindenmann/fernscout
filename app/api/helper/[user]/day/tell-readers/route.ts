import { isTestContent } from "@/lib/access";
import { mailSummary } from "@/lib/api/dayMail";
import { whatsappSummary } from "@/lib/api/dayWhatsapp";
import { isEnabled } from "@/lib/capabilities";
import { sendDayLetter } from "@/lib/digest/dayLetter";
import { sendDayWhatsapp } from "@/lib/digest/dayWhatsapp";
import { AS_AUTHOR, getEntryBySlug } from "@/lib/entries";
import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { refused, wrote } from "@/lib/helper/thread";
import { getTrip, tripRef } from "@/lib/trips";

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

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const tripId = typeof body?.trip === "string" ? body.trip.trim() : "";
  const slug = typeof body?.slug === "string" ? body.slug.trim() : "";
  const channel = body?.channel === "whatsapp" ? "whatsapp" : "mail";

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

  // Branched fully in each arm, not merged into one `outcome` variable: the
  // two outcome types share no `sent`/`failed` shape (an email versus a
  // masked phone number), so a shared variable would only be reunited by a
  // cast — and a cast here is exactly the kind of "trust me" this file's
  // whole point is to avoid.
  if (channel === "whatsapp") {
    const outcome = await sendDayWhatsapp(user, ref, slug, { resend: true });
    if (!outcome.ok) {
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

  const outcome = await sendDayLetter(user, ref, slug, { resend: true });
  if (!outcome.ok) {
    refused(user, "tell_readers", outcome.reason);
    return Response.json({ error: outcome.reason }, { status: 400 });
  }
  const summary = mailSummary(outcome);
  wrote(user, "tell_readers", { trip: tripId, slug, channel, ...summary });
  return Response.json({ ok: true, slug, channel, ...summary });
}
