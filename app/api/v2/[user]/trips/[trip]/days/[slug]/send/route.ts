// POST /api/v2/{user}/trips/{trip}/days/{slug}/send — B1623, phase 2 step 4.
//
// One door replaces v1's send-mail and send-whatsapp (S1): the only thing
// that differed between them was which array of recipients was walked, and
// a caller wanting both made two round trips for one intention.
import { daySend } from "@/lib/api/v2/schemas";
import { requireJournalOwner } from "@/lib/api/v2/auth";
import { fail, ok, readDryRun } from "@/lib/api/v2/route";
import { mailSendSummary, whatsappSendSummary } from "@/lib/api/v2/social";
import { isTestContent } from "@/lib/access";
import { sendDayLetter } from "@/lib/digest/dayLetter";
import { sendDayWhatsapp } from "@/lib/digest/dayWhatsapp";
import { getEntryBySlug } from "@/lib/entries";
import { getTrip, tripRef } from "@/lib/trips";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: RouteContext<"/api/v2/[user]/trips/[trip]/days/[slug]/send">,
) {
  const { user, trip, slug } = await params;
  const auth = await requireJournalOwner(request, user);
  if (!auth.ok) return auth.response;

  const ref = tripRef(user, trip);
  const found = getTrip(ref);
  if (!found) return fail("unknown_trip", `"${user}" has no trip called "${trip}".`, undefined, 404);

  const entry = getEntryBySlug(ref, slug, { includeDrafts: true });
  if (!entry) return fail("unknown_day", `No day "${slug}" in this trip.`, undefined, 404);
  if (entry.draft) {
    return fail(
      "not_published",
      `"${slug}" is still a draft. Publish it first — there is no letter for a day nobody can read yet.`,
      undefined,
      409,
    );
  }
  if (isTestContent(found, entry)) {
    return fail("test_content", `"${slug}" is marked test: true — content nobody lived — so it sends nothing.`, undefined, 400);
  }

  const parsed = await request.json().catch(() => null);
  const result = daySend.safeParse(parsed);
  if (!result.success) {
    return fail("invalid_request", 'Send { "channels": ["mail" | "whatsapp", ...] }, at least one.');
  }
  const { channels } = result.data;

  const dryRun = readDryRun(request);
  if (dryRun === null) return fail("invalid_request", "dryRun must be true, false, or absent.");
  if (dryRun) {
    const preview: Record<string, unknown> = {};
    if (channels.includes("mail")) preview.mail = { attempted: false, sent: 0, failed: 0, dryRun: true };
    if (channels.includes("whatsapp")) preview.whatsapp = { attempted: false, sent: 0, failed: 0, dryRun: true };
    return ok({ ok: true, resend: true, results: preview });
  }

  const results: Record<string, unknown> = {};
  if (channels.includes("mail")) {
    const outcome = await sendDayLetter(user, ref, slug, { resend: true });
    results.mail = mailSendSummary(outcome);
  }
  if (channels.includes("whatsapp")) {
    const outcome = await sendDayWhatsapp(user, ref, slug, { resend: true });
    results.whatsapp = whatsappSendSummary(outcome);
  }

  return ok({ ok: true, resend: true, results });
}
