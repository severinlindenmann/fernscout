// POST .../days/{slug}/send — S1, the ONE send door. `send-mail` and
// `send-whatsapp` die into this — B1612 (phase 2 step 3, parcel B).
import { sendRequest } from "@/lib/api/v2/schemas";
import { problemsFrom } from "@/lib/api/v2/incomplete";
import { fail, ok, readJson } from "@/lib/api/v2/route";
import { resolveBearer, ownsUser } from "@/lib/api/v2/auth";
import { mayActAsOwner, mayWriteTrip, refuseWrite } from "@/lib/api/auth";
import { isTestContent } from "@/lib/access";
import { balanceOf } from "@/lib/credits";
import { formatCredits } from "@/lib/creditsFormat";
import { ERROR_CODES } from "@/lib/api/errorCodes";
import { readTripFile, readDayFile } from "@/lib/api/v2/store";
// v1's own summaries, not a second copy — B1620. The inline pair this
// replaces dropped the per-recipient `errors` list, so a publish that failed
// for one reader reported a count and not which address, which is the half a
// person can act on. Shared rather than reimplemented for the reason the
// whole contract layer is shared: two summaries of one outcome disagree.
import { mailSummary } from "@/lib/api/dayMail";
import { whatsappSummary } from "@/lib/api/dayWhatsapp";
import { v1Slug } from "@/lib/api/v2/days";
import { sendDayLetter, type DayLetterOutcome } from "@/lib/digest/dayLetter";
import { sendDayWhatsapp, whatsappWouldCost, type DayWhatsappOutcome } from "@paid/whatsapp/lib/digest/dayWhatsapp";
import type { Trip } from "@/lib/types";

export const dynamic = "force-dynamic";

function tripLike(user: string, tripId: string, people: { name: string; email: string }[]): Trip {
  return { username: user, id: tripId, ref: `${user}/${tripId}`, people } as unknown as Trip;
}

export async function POST(
  request: Request,
  { params }: RouteContext<"/api/v2/[user]/trips/[trip]/days/[slug]/send">,
) {
  const { user, trip: tripId, slug } = await params;

  const bearer = await resolveBearer(request);
  if (!bearer.ok) return bearer.response;
  if (!ownsUser(bearer.session, user)) {
    return fail("out_of_scope", ERROR_CODES.out_of_scope, undefined, 403);
  }

  const trip = readTripFile(user, tripId);
  if (!trip) return fail("unknown_trip", ERROR_CODES.unknown_trip, undefined, 404);

  const gate = await mayWriteTrip(bearer.session, tripLike(user, tripId, trip.people));
  if (!gate.ok) return refuseWrite(gate);

  if (!mayActAsOwner(bearer.session, user)) {
    return fail(
      "out_of_scope",
      "This token is scoped to one trip and cannot send anybody a copy of a day. Only the " +
        "journal's owner decides what leaves the journal.",
      undefined,
      403,
    );
  }

  const day = readDayFile(user, tripId, slug);
  if (!day) return fail("unknown_day", ERROR_CODES.unknown_day, undefined, 404);
  if (day.status !== "published") {
    return fail("not_published", ERROR_CODES.not_published, undefined, 409);
  }
  if (isTestContent(tripLike(user, tripId, trip.people), day) || trip.test === true || day.test === true) {
    return fail("test_content", ERROR_CODES.test_content, undefined, 409);
  }

  const body = await readJson(request);
  if (!body.ok) return body.response;
  const parsed = sendRequest.safeParse(body.value);
  if (!parsed.success) {
    return fail("invalid_request", ERROR_CODES.invalid_request, problemsFrom(parsed.error), 400);
  }
  const { channels } = parsed.data;

  if (channels.includes("whatsapp")) {
    const balance = await balanceOf(user);
    if (balance !== null) {
      const needed = await whatsappWouldCost(user, `${user}/${tripId}`, v1Slug(slug)).catch(() => 1);
      if (needed > balance) {
        return fail(
          "no_credits",
          `Sending this day would take ${needed} credit(s); this journal has ${formatCredits(balance)} left. Nothing was sent.`,
          { needed, balance },
          402,
        );
      }
    }
  }

  const ref = `${user}/${tripId}`;
  const result: Record<string, unknown> = { ok: true, slug };
  if (channels.includes("mail")) {
    result.mail = mailSummary(await sendDayLetter(user, ref, v1Slug(slug), { resend: true }));
  }
  if (channels.includes("whatsapp")) {
    result.whatsapp = whatsappSummary(await sendDayWhatsapp(user, ref, v1Slug(slug), { resend: true }));
  }

  return ok(result);
}
