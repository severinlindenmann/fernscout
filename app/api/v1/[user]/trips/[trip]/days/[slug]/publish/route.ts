import { authenticate, errorResponse, mayWriteTrip, ownsUser, refuseWrite } from "@/lib/api/auth";
import { publishNotice, publishDraft } from "@/lib/api/entries";
import { SESSION_SCOPE } from "@/lib/auth";
import { isTestContent } from "@/lib/access";
import { balanceOf } from "@/lib/credits";
import { getEntryBySlug } from "@/lib/entries";
import { getTrip, tripRef } from "@/lib/trips";
import { serverSite } from "@/lib/site";
import { mailWouldCost, sendDayLetter } from "@/lib/digest/dayLetter";
import { mailSummary } from "@/lib/api/dayMail";
import { whatsappSummary } from "@/lib/api/dayWhatsapp";
import { readPublishFlags } from "@/lib/api/publishFlags";
import { sendDayWhatsapp, whatsappWouldCost } from "@/lib/digest/dayWhatsapp";

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
  //
  // **One read for both flags.** `Request.json()` consumes the stream, so
  // asking two helpers in turn would give the second one an empty body and a
  // permanent `false` — indistinguishable from "the caller did not ask", and
  // therefore a bug that ships quietly. See `readPublishFlags`.
  const {
    sendMail: sendMailRequested,
    sendWhatsapp: sendWhatsappRequested,
    ignored: flagsIgnored,
  } = await readPublishFlags(request);

  /*
   * The credits pre-flight — B366. Before anything is published, ask what
   * *both* requested channels together would cost and compare that one sum
   * against one balance. Checking mail and WhatsApp separately would let a
   * journal that can afford either channel alone, but not both, pass two
   * checks it cannot actually pay for and publish a day it can only
   * half-send — the exact failure the owner declined when choosing
   * all-or-nothing. `balanceOf` returning `null` means credits are switched
   * off for this instance, in which case there is nothing to check: a
   * disabled capability is absent, not a silent always-pass wearing the same
   * code path.
   *
   * **This is advisory, not the guard.** Between this read and the real
   * debit inside `sendDayLetter`/`sendDayWhatsapp` below, another call can
   * spend the same balance — there is no reservation held across the
   * `publishDraft` write in between. In that race the day publishes and the
   * send it asked for comes back `no_credits`, which is the outcome the
   * owner declined for the ordinary case, reached only when two requests
   * genuinely overlap. The alternative — holding credits reserved across a
   * filesystem write — risks losing them silently on a crash there, which is
   * worse. `spend`'s conditional `UPDATE` is what actually keeps a balance
   * from going negative; this check only keeps the *common* case from
   * publishing a day it cannot afford to announce.
   */
  if (sendMailRequested || sendWhatsappRequested) {
    const balance = await balanceOf(user);
    if (balance !== null) {
      const needed =
        (sendMailRequested ? await mailWouldCost(user, ref, slug) : 0) +
        (sendWhatsappRequested ? await whatsappWouldCost(user, ref, slug) : 0);
      if (needed > balance) {
        return Response.json(
          {
            error: "no_credits",
            needed,
            balance,
            message:
              `Sending this day would take ${needed} credit(s); this journal has ${balance} left. ` +
              "Nothing was published.",
          },
          { status: 402 },
        );
      }
    }
  }

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

  /*
   * The message — B365, and the same contract as the letter above it in every
   * respect that matters: `send_whatsapp` is a parameter of this call, its
   * absence means no message, and it must never default to true. Publishing
   * fifteen days must not buzz fifteen times in somebody's pocket.
   *
   * Its own `try`, separate from mail's, so neither channel can take the
   * other down with it — and both outside the publish, which has already
   * succeeded by the time either runs (B272).
   */
  let whatsapp: Record<string, unknown> | undefined;
  if (sendWhatsappRequested) {
    try {
      whatsapp = whatsappSummary(await sendDayWhatsapp(user, ref, slug));
    } catch (err) {
      whatsapp = {
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
    ...(whatsapp ? { whatsapp } : {}),
    // B400: a flag that was present but not a boolean reads as `false`, same
    // as absence — `readPublishFlags`'s `=== true` is load-bearing and stays.
    // This is the one place that difference becomes audible: an agent that
    // sent `"send_mail": "true"` gets told nothing was sent, instead of a
    // quiet 200 it can only misreport.
    ...(flagsIgnored.length > 0
      ? {
          flagsIgnored,
          flagsIgnoredMessage:
            `${flagsIgnored.join(" and ")} must be boolean \`true\` to send, not a string ` +
            `or a number — it was ignored and nothing was sent for ${flagsIgnored.length > 1 ? "them" : "it"}.`,
        }
      : {}),
  });
}
