import { authenticate, errorResponse, mayWriteTrip, ownsUser, refuseWrite } from "@/lib/api/auth";
import { publishNotice, publishDraft } from "@/lib/api/entries";
import { SESSION_SCOPE } from "@/lib/auth";
import { isTestContent } from "@/lib/access";
import { getEntryBySlug } from "@/lib/entries";
import { getTrip, tripRef } from "@/lib/trips";
import { serverSite } from "@/lib/site";
import { sendDayLetter } from "@/lib/digest/dayLetter";
import { mailSummary, readSendMailFlag } from "@/lib/api/dayMail";

export const dynamic = "force-dynamic";

/**
 * `POST /api/v1/<user>/trips/<trip>/days/<slug>/publish` — put a draft on the
 * site.
 *
 * ## Why this exists at all
 *
 * B28 built it because the owner of a journal created over the API has never
 * seen the folder it lives in, and the only way to publish was to open a file
 * and delete a line. The guide said "a person publishes it" four times and
 * never said how; an agent that finished its work had to end its report with a
 * shrug.
 *
 * ## Writing and publishing are two calls, and that is all that is structural
 *
 * Nothing an agent sends to `POST .../days` can publish — there is no
 * parameter — and this endpoint cannot create anything. Do not read the split
 * as a gate against the agent: it holds both calls, and under the rule in
 * AGENTS.md publishing is its work to do. What the gap buys is a moment where
 * the day exists and nobody has read it, which is where the person reads it
 * back. That is worth keeping and nothing else here is.
 *
 * **There is no confirmation handshake, since B224.** There was one until
 * then, modelled on deletion. It never established that a human consented —
 * the agent held both calls, and B28's own comment said so — so once the
 * doctrine stopped reserving publishing for a person it was a round trip
 * buying nothing, and a `409` on the success path that a strict client reads
 * as failure. Deletion keeps its confirmation and should: it is unrecoverable
 * and its second step happens in a mailbox (`lib/deletions.ts`, B38), whereas
 * publishing is undone by putting the line back.
 *
 * Which leaves the asking as instruction rather than mechanism. `/agent.md`
 * says it plainly — ask, in words, and wait — and nothing here can check.
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

  // Read before publishing changes anything, so a malformed body is a `false`
  // rather than a publish that half-happened.
  const sendMailRequested = await readSendMailFlag(request);

  const result = publishDraft(ref, slug);
  if (!result.ok) return Response.json({ error: result.error }, { status: 400 });

  /*
   * The letter — B345. `send_mail` is a parameter of this call and its
   * absence means no letter (it must never default to true: publishing
   * fifteen days must not mail fifteen letters to everybody the owner
   * knows). Best-effort, and deliberately outside the publish itself: the day
   * is already on the site by the time this runs, so nothing here can turn a
   * successful publish into a failure response — B272 was exactly a mail
   * step allowed to do that to an unrelated success.
   */
  let mail: Record<string, unknown> | undefined;
  if (sendMailRequested) {
    try {
      mail = mailSummary(await sendDayLetter(user, ref, slug));
    } catch (err) {
      mail = {
        attempted: false,
        sent: 0,
        failed: 0,
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  }

  return Response.json({
    ok: true,
    slug: result.slug,
    status: "published",
    url: `${serverSite().url}/${user}/trips/${trip}/day/${slug}`,
    // What publishing *this* day did, not what publishing does in general. A
    // `test: true` day is excluded from the feed, the search index and the
    // sitemap, and the sentence used to promise the opposite. It was the
    // refusal's message until B224; it is the receipt now. B158.
    note: publishNotice({
      title: entry.title,
      date: entry.date,
      url: `${serverSite().url}/${user}`,
      test: isTestContent(found, entry),
    }),
    ...(mail ? { mail } : {}),
  });
}
