import { authenticate, errorResponse, mayActAsOwner, mayWriteTrip, outOfScope, ownsUser, refuseWrite } from "@/lib/api/auth";
import { unpublishEntry } from "@/lib/api/entries";
import { AS_AUTHOR, getEntryBySlug } from "@/lib/entries";
import { getTrip, tripRef } from "@/lib/trips";
import { serverSite } from "@/lib/site";

export const dynamic = "force-dynamic";

/**
 * `POST /api/v1/<user>/trips/<trip>/days/<slug>/unpublish` — take a day back
 * off the site.
 *
 * ## Why this exists — B905
 *
 * `.../publish` has been documented since B28. Taking a day down existed only
 * at `POST /api/helper/<user>/day/unpublish` — cookie-only, outside the
 * published contract, added by B816 for the browser. So an agent over the
 * network could publish and could not undo it, which is a gate backwards: the
 * **reversible** half of the pair was the half that was missing, and the
 * person most likely to need it is the one whose friend has just asked to come
 * out of a photograph.
 *
 * ## It is not a delete, and that is the whole of what it is
 *
 * The day goes back to being a draft: off the site, off the feed, off the
 * sitemap, still on disk with every photograph attached and every word intact.
 * Publishing it again is the undo. That is why it needs none of deletion's
 * ceremony (`lib/deletions.ts`, B38) — nothing here is unrecoverable, and a
 * mail with a single-use link would be asking somebody to confirm putting a
 * line back in a file.
 *
 * Mirrors publish rather than resembling it: same shape, same refusals, same
 * owner rule. A pair that looks like a pair is a pair somebody can guess the
 * second half of.
 *
 * **Only the journal's owner may**, for the reason publishing gives: a
 * trip-scoped token belongs to somebody who came on one trip, and being on the
 * bus is not the same as deciding what the journal says. It is worth stating
 * that this cuts both ways — a companion cannot take down a day the owner put
 * up, any more than they could put one up.
 *
 * **Taking down twice is refused rather than shrugged off**, the same as
 * publishing twice. An agent that gets a cheerful 200 might tell somebody it
 * had just done a thing that happened last week — and here the difference
 * matters more, because the sentence it would say is "your day is off the
 * site" to somebody who asked precisely because they are worried about who can
 * see it.
 *
 * Nothing is sent and nothing is spent. There is no channel that announces a
 * day coming down, deliberately: a reader who saw it will not be told it has
 * gone, which is the honest limit of what a takedown can do.
 */
export async function POST(
  request: Request,
  { params }: RouteContext<"/api/v1/[user]/trips/[trip]/days/[slug]/unpublish">,
) {
  const auth = await authenticate(request);
  if (!auth.ok) return errorResponse(auth);

  const { user, trip, slug } = await params;
  if (!ownsUser(auth.session, user)) {
    return outOfScope(auth.session, user);
  }

  const ref = tripRef(user, trip);
  const found = getTrip(ref);
  // The same answer for a trip that does not exist as for one this token may
  // not touch — see the days route.
  if (!found) return Response.json({ error: "unknown_trip" }, { status: 404 });
  const gate = await mayWriteTrip(auth.session, found);
  if (!gate.ok) return refuseWrite(gate);

  if (!mayActAsOwner(auth.session, user)) {
    return Response.json(
      {
        error: "out_of_scope",
        message:
          "This token is scoped to one trip, so it can write days into that trip but cannot " +
          "take them off the site. Only the journal's owner decides what the journal says.",
      },
      { status: 403 },
    );
  }

  const entry = getEntryBySlug(ref, slug, AS_AUTHOR);
  if (!entry) return Response.json({ error: "unknown_day" }, { status: 404 });
  if (entry.draft) {
    return Response.json(
      { error: "already_draft", message: `"${slug}" is not on the site.` },
      { status: 409 },
    );
  }

  const result = unpublishEntry(ref, slug);
  if (!result.ok) return Response.json({ error: result.error }, { status: 400 });

  return Response.json({
    ok: true,
    slug: result.slug,
    status: "draft",
    url: `${serverSite().url}/${user}/trips/${trip}/day/${slug}`,
    // What actually happened, in the words to repeat to the person. The thing
    // they are afraid of is that "taken down" means "deleted", and the thing
    // they should know is that it does not reach somebody who already read it.
    note:
      `"${entry.title}" is off the site and is a draft again. Nothing was deleted — the words ` +
      "and every photograph are still there, and publishing it again puts it back. Anybody who " +
      "already read it, or was sent it, still has what they saw.",
  });
}
