import { authenticate, errorResponse, mayWriteTrip, ownsUser, refuseWrite } from "@/lib/api/auth";
import { publishDraft } from "@/lib/api/entries";
import { confirmationMatches, confirmationRequired } from "@/lib/agentConfirm";
import { SESSION_SCOPE } from "@/lib/auth";
import { getEntryBySlug } from "@/lib/entries";
import { getTrip, tripRef } from "@/lib/trips";
import { serverSite } from "@/lib/site";

export const dynamic = "force-dynamic";

/**
 * `POST /api/v1/<user>/trips/<trip>/days/<slug>/publish` — put a draft on the
 * site.
 *
 * ## Why this exists at all
 *
 * The rule has always been that an agent writes drafts and a person publishes
 * them. What was never provided was a way for the person to *do* that which
 * did not involve a text editor and the content folder. The guide said "a
 * person publishes it" four times and never said how; an agent that finished
 * its work had to end its report with a shrug, and the owner of a journal
 * created over the API — who has never seen the folder — had no next move at
 * all.
 *
 * ## What has and has not changed
 *
 * **Writing and publishing are still two calls.** Nothing an agent sends to
 * `POST .../days` can publish; there is no parameter, and this endpoint cannot
 * create anything. The gap between the two is where the person goes, and it is
 * the gap that was always the point.
 *
 * **Publishing is confirmed, like deleting.** The first call is refused with a
 * code bound to this journal, this trip, this day and this verb, and the
 * refusal asks whether the person actually said to. Be honest about what that
 * buys: an agent can make both calls without asking anybody. It is not proof a
 * human consented, and `lib/agentConfirm.ts` says so plainly about deletion
 * too. What it does is make publishing a deliberate second act rather than
 * something that happens as a side effect of a write, and give the agent a
 * sentence it has to read first.
 *
 * **Only the journal's owner may.** A trip-scoped token — held by somebody who
 * came on one trip — writes days into that trip and cannot publish them. Being
 * on the bus is not the same as deciding what the journal says, and the person
 * whose journal it is should not find their trip published by a companion's
 * agent.
 *
 * ## Why it is not idempotent-friendly
 *
 * Publishing twice is refused rather than shrugged off. An agent that gets
 * "already published" has learned something worth reporting; one that gets a
 * cheerful 200 might tell somebody it had just done a thing that happened last
 * week.
 */
export async function POST(
  request: Request,
  { params }: RouteContext<"/api/v1/[user]/trips/[trip]/days/[slug]/publish">,
) {
  const auth = await authenticate(request);
  if (!auth.ok) return errorResponse(auth);

  const { user, trip, slug } = await params;
  if (!ownsUser(auth.session, user)) {
    return Response.json({ error: "out_of_scope" }, { status: 403 });
  }

  const ref = tripRef(user, trip);
  const found = getTrip(ref);
  // The same answer for a trip that does not exist as for one this token may
  // not touch — see the days route.
  if (!found) return Response.json({ error: "unknown_trip" }, { status: 404 });
  const gate = await mayWriteTrip(auth.session, found);
  if (!gate.ok) return refuseWrite(gate);

  if (auth.session.scope !== SESSION_SCOPE.agent) {
    return Response.json(
      {
        error: "out_of_scope",
        message:
          "This token is scoped to one trip, so it can write days into that trip but cannot " +
          "publish them. Only the journal's owner decides what goes on the site.",
      },
      { status: 403 },
    );
  }

  const entry = getEntryBySlug(ref, slug, { includeDrafts: true });
  if (!entry) return Response.json({ error: "unknown_day" }, { status: 404 });
  if (!entry.draft) {
    return Response.json(
      { error: "already_published", message: `"${slug}" is already on the site.` },
      { status: 409 },
    );
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const confirm = typeof body?.confirm === "string" ? body.confirm : undefined;
  const operation = { action: "publish_day" as const, scope: ref, target: slug };

  if (!confirmationMatches(confirm, operation)) {
    return Response.json(
      confirmationRequired(
        operation,
        `This publishes "${entry.title}" (${entry.date}) to ${serverSite().url}/${user}. ` +
          `It goes into the journal, the feed and the search index, and anyone with the ` +
          `link can read it. Taking it down again removes it from the site, not from the ` +
          `people who have already read it.`,
      ),
      { status: 409 },
    );
  }

  const result = publishDraft(ref, slug);
  if (!result.ok) return Response.json({ error: result.error }, { status: 400 });

  return Response.json({
    ok: true,
    slug: result.slug,
    status: "published",
    url: `${serverSite().url}/${user}/trips/${trip}/day/${slug}`,
    note: "It is on the site now. Tell the person, and give them the URL.",
  });
}
