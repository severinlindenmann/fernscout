import { unpublishEntry } from "@/lib/api/entries";
import { AS_AUTHOR, getEntryBySlug } from "@/lib/entries";
import { dayForWizard, isHelperOwner, notYourJournal, previewOf } from "@/lib/helper/server";
import { getTrip, tripRef } from "@/lib/trips";

export const dynamic = "force-dynamic";

/**
 * Take a day back off the site — B816.
 *
 * The verb the browser did not have. A person whose friend asks to come out of
 * a photograph had two options before this: an agent, or an email to whoever
 * set the journal up — which is B28's own failure, arriving again one level
 * up.
 *
 * **It is not a delete, and it must not grow into one.** The day goes back to
 * being a draft: off the site, off the feed, still on disk with every
 * photograph attached to it, and publishing it again is the undo. Deleting is
 * unrecoverable and ends in a mailbox (`lib/deletions.ts`, B38); nothing here
 * touches that path, and there is deliberately no button in this flow that
 * finishes it.
 *
 * Owner only, cookie only, and outside `/api/v1` — the same door as
 * `./publish/route.ts` beside it, and for the reasons its comment gives.
 * Putting a day on the site and taking it off are the same decision, so they
 * are the same person's to make.
 */
export async function POST(
  request: Request,
  { params }: RouteContext<"/api/helper/[user]/day/unpublish">,
) {
  const { user } = await params;
  if (!(await isHelperOwner(user))) {
    return notYourJournal(request);
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const tripId = typeof body?.trip === "string" ? body.trip.trim() : "";
  const slug = typeof body?.slug === "string" ? body.slug.trim() : "";

  const ref = tripRef(user, tripId);
  if (!getTrip(ref)) return Response.json({ error: "unknown_trip" }, { status: 404 });

  const entry = getEntryBySlug(ref, slug, AS_AUTHOR);
  if (!entry) return Response.json({ error: "unknown_day" }, { status: 404 });
  if (entry.draft) {
    // The same shape as publishing something already published: a cheerful
    // 200 here would let somebody report a takedown that happened last week.
    return Response.json({ error: "already_draft" }, { status: 409 });
  }

  const taken = unpublishEntry(ref, slug);
  if (!taken.ok) return Response.json({ error: taken.error }, { status: 400 });

  return Response.json({
    ok: true,
    draft: dayForWizard(user, tripId, slug),
    preview: previewOf(user, tripId, slug),
  });
}
