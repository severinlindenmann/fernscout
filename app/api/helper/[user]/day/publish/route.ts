import { editEntry, factsOfEntry, publishDraft } from "@/lib/api/entries";
import { AS_AUTHOR, getEntryBySlug } from "@/lib/entries";
import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { serverSite } from "@/lib/site";
import { declinesIn, missingFrom } from "@/lib/tracks";
import { getTrip, tripRef } from "@/lib/trips";
import { wrote } from "@/lib/helper/thread";

export const dynamic = "force-dynamic";

/**
 * Put the day on the site — B682, and the only thing in the wizard that does.
 *
 * It is a separate route from the one that writes, for the reason the whole
 * product is built around: writing and publishing are two acts, and the gap
 * between them is where somebody reads the day back. The wizard's preview step
 * is that gap; this is the button at the end of it.
 *
 * **Owner only, and there is no companion's version of it.** A trip-scoped
 * agent token cannot publish (`/api/v1/.../publish` refuses it outright), and
 * neither can anybody reaching this route: `isHelperOwner` is an owner check,
 * not a write check.
 *
 * Nothing is announced. `POST /api/v1/.../publish` can send the day by mail or
 * WhatsApp on the same call; this cannot, and that is deliberate rather than
 * unfinished — those cost credits and buzz in other people's pockets, and the
 * wizard's promise is that the whole flow runs with nothing switched on and
 * nothing spent. The day's own page carries the notify control for afterwards.
 */
export async function POST(
  request: Request,
  { params }: RouteContext<"/api/helper/[user]/day/publish">,
) {
  const { user } = await params;
  if (!(await isHelperOwner(user))) {
    return notYourJournal(request, user);
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const tripId = typeof body?.trip === "string" ? body.trip.trim() : "";
  const slug = typeof body?.slug === "string" ? body.slug.trim() : "";

  const ref = tripRef(user, tripId);
  const trip = getTrip(ref);
  if (!trip) return Response.json({ error: "unknown_trip" }, { status: 404 });

  const entry = getEntryBySlug(ref, slug, AS_AUTHOR);
  if (!entry) return Response.json({ error: "unknown_day" }, { status: 404 });
  if (!entry.draft) {
    return Response.json({ error: "already_published" }, { status: 409 });
  }

  /**
   * The answers, if the press carried any — B929.
   *
   * `photos` is asked here and nowhere else, because a day cannot carry a
   * picture at the moment it is written, and until this route read an answer
   * there was no way to give one: the conversation's proposal posted here,
   * this route only ever *checked*, and every press came back
   * `incomplete_day`. It is written into the day first, through the same
   * `editEntry` the words go through, so what publishes is a day that says in
   * its own frontmatter what it has none of.
   */
  const answers = declinesIn(body ?? {});
  if (Object.keys(answers).length > 0) {
    const answered = editEntry(ref, slug, answers);
    if (!answered.ok) {
      return Response.json({ error: answered.error }, { status: answered.bug ? 500 : 400 });
    }
  }

  // The trip's own questions, asked again at the last moment. The wizard turns
  // each name into a pair of buttons; the conversation turns each into a
  // select on the proposal.
  const day = getEntryBySlug(ref, slug, AS_AUTHOR) ?? entry;
  const missing = missingFrom(factsOfEntry(day), trip.tracks, "publish");
  if (missing.length > 0) {
    return Response.json(
      { error: "incomplete_day", missing: missing.map((m) => m.field) },
      { status: 422 },
    );
  }

  const published = publishDraft(ref, slug);
  if (!published.ok) return Response.json({ error: published.error }, { status: 400 });

  wrote(user, "publish_day", { trip: tripId, slug: published.slug });
  return Response.json({
    ok: true,
    slug: published.slug,
    url: `${serverSite().url}/${user}/trips/${tripId}/day/${published.slug}`,
  });
}
