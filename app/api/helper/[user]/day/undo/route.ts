import { editEntry } from "@/lib/api/entries";
import { isEnabled } from "@/lib/capabilities";
import { AS_AUTHOR, getEntryBySlug } from "@/lib/entries";
import { dayForWizard, isHelperOwner, notYourJournal, previewOf } from "@/lib/helper/server";
import { refused, wrote } from "@/lib/helper/thread";
import { stashWords, stashedWords } from "@/lib/helper/undo";
import { getTrip, tripRef } from "@/lib/trips";

export const dynamic = "force-dynamic";

/**
 * "Rückgängig" — B1218 (D47): swap a day's words back to the one prior
 * version the last accepted write stashed.
 *
 * A swap, not a delete: what is on the day right now is stashed in the same
 * place before it is overwritten, so pressing this a second time undoes the
 * undo. Same cookie, same owner check as every route in this family.
 */

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(
  request: Request,
  { params }: RouteContext<"/api/helper/[user]/day/undo">,
) {
  const { user } = await params;
  if (!(await isHelperOwner(user))) {
    return notYourJournal(request, user);
  }
  if (!isEnabled("helper", user)) {
    return Response.json({ error: "helper_unavailable" }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const tripId = text(body?.trip);
  const ref = tripRef(user, tripId);
  const trip = getTrip(ref);
  if (!trip) {
    refused(user, "undo_words", "unknown_trip");
    return Response.json({ error: "unknown_trip" }, { status: 404 });
  }
  const slug = text(body?.slug);

  const stash = stashedWords(ref, slug);
  if (!stash) {
    refused(user, "undo_words", "no_undo");
    return Response.json({ error: "no_undo" }, { status: 404 });
  }

  const current = getEntryBySlug(ref, slug, AS_AUTHOR);
  if (!current) {
    refused(user, "undo_words", "unknown_day");
    return Response.json({ error: "unknown_day" }, { status: 404 });
  }

  // What is there now becomes what a second press would restore — the undo
  // of the undo.
  stashWords(ref, slug, { title: current.title, content: current.content });

  const edited = editEntry(ref, slug, { title: stash.title, content: stash.content });
  if (!edited.ok) {
    refused(user, "undo_words", edited.error);
    return Response.json({ error: edited.error }, { status: edited.bug ? 500 : 400 });
  }

  wrote(user, "undo_words", { trip: tripId, slug });
  return Response.json({ ok: true, draft: dayForWizard(user, tripId, slug), preview: previewOf(user, tripId, slug) });
}
