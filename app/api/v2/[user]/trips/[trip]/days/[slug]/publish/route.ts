// POST .../days/{slug}/publish — B1612 (phase 2 step 3, parcel B).
//
// The untouchable safety shape (rule 9, docs/plans/2026-09-12-api-v2/content.md
// §1): draft-then-publish stays two calls, owner only, and a trip-scoped
// token is refused `out_of_scope` — being on the bus is not deciding what the
// journal says. `publishDraft`/`unpublishEntry`/`publishNotice`/`factsOfEntry`
// (lib/api/entries.ts) are the v1 LIFECYCLE functions this ticket names as
// reusable "in spirit"; they read v1's markdown keys, so this route does not
// call them directly — it reimplements the same lifecycle (draft -> published,
// the completeness re-check, the same human `note`) over the v2 JSON day,
// reusing `publishNotice` itself unchanged (it takes plain strings, not an
// Entry, so it needs no adaptation) and the two send functions
// (`lib/digest/dayLetter.ts`, `paid/whatsapp/lib/digest/dayWhatsapp.ts`), which already
// degrade to a clean `{ok:false, reason:"unknown_trip"}` rather than throwing
// when the v1 reader they depend on cannot see a v2-native trip (B1598) — so
// a send requested against a v2-only day reports `attempted:false` honestly
// rather than crashing, until that read layer is rebuilt.
import { publishRequest } from "@/lib/api/v2/schemas";
import { problemsFrom } from "@/lib/api/v2/incomplete";
import { fail, ok, readDryRun, readJson } from "@/lib/api/v2/route";
import { resolveBearer, ownsUser } from "@/lib/api/v2/auth";
import { mayActAsOwner, mayWriteTrip, refuseWrite } from "@/lib/api/auth";
import { publishNotice } from "@/lib/api/entries";
import { isTestContent } from "@/lib/access";
import { afterResponse } from "@/lib/afterResponse";
import { isEnabled } from "@/lib/capabilities";
import { subscribersFor } from "@/lib/push";
import { localeForSubscriber, sendPush } from "@/lib/push/send";
import { composeDayPush } from "@/lib/digest/dayPush";
import { serverSite } from "@/lib/site";
import { getUser } from "@/lib/users";
import { ERROR_CODES } from "@/lib/api/errorCodes";
import { readTripFile, readDayFile, writeDayFile } from "@/lib/api/v2/store";
import { mailSummary } from "@/lib/api/dayMail";
import { whatsappSummary } from "@/lib/api/dayWhatsapp";
import { missingAtPublish, v1Slug } from "@/lib/api/v2/days";
import { claimChannel, releaseChannelClaim } from "@/lib/digest/dayNotify";
import { logMessage } from "@/lib/messages/log";
import { sendDayLetter, type DayLetterOutcome } from "@/lib/digest/dayLetter";
import { sendDayWhatsapp, type DayWhatsappOutcome } from "@paid/whatsapp/lib/digest/dayWhatsapp";
import type { Trip } from "@/lib/types";
import type { StoredSubscription } from "@/lib/repos/types";

import { journalPath } from "@/lib/journalPath";
export const dynamic = "force-dynamic";

function tripLike(user: string, tripId: string, people: { name: string; email: string }[]): Trip {
  return { username: user, id: tripId, ref: `${user}/${tripId}`, people } as unknown as Trip;
}

export async function POST(
  request: Request,
  { params }: RouteContext<"/api/v2/[user]/trips/[trip]/days/[slug]/publish">,
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

  // Rule 9, untouchable: being on the bus is not deciding what the journal
  // says. Same code and shape v1 answered with for this exact refusal.
  if (!mayActAsOwner(bearer.session, user)) {
    return fail(
      "out_of_scope",
      "This token is scoped to one trip, so it can write days into that trip but cannot " +
        "publish them. Only the journal's owner decides what goes on the site.",
      undefined,
      403,
    );
  }

  return applyPublish(request, user, tripId, slug);
}

/**
 * The publish itself, factored out of `POST` above — B2140 — so
 * `/api/web/[user]/trips/[trip]/days/[slug]/publish` (the owner's cookie
 * door, the studio's "Publish a day") reaches the same writer, the same
 * completeness re-check and the same notice without a bearer token ever
 * existing: an in-process call, never an HTTP round trip. Everything above
 * this point is the owner-only bearer gate; nothing below looks at a
 * session. `request` is read for its body and `?dryRun` only.
 */
export async function applyPublish(
  request: Request,
  user: string,
  tripId: string,
  slug: string,
  /** What `declined.<field>` says for each `declineTracked` field — the
   *  studio's door (B2192) says what actually happened there. */
  declineReason = "declined at publish (declineTracked)",
): Promise<Response> {
  const trip = readTripFile(user, tripId);
  if (!trip) return fail("unknown_trip", ERROR_CODES.unknown_trip, undefined, 404);
  const day = readDayFile(user, tripId, slug);
  if (!day) return fail("unknown_day", ERROR_CODES.unknown_day, undefined, 404);
  if (day.status === "published") {
    return fail("already_published", `"${slug}" is already on the site.`, undefined, 409);
  }

  const body = await readJson(request);
  if (!body.ok) return body.response;
  const parsedBody = publishRequest.safeParse(body.value);
  if (!parsedBody.success) {
    return fail("invalid_request", ERROR_CODES.invalid_request, problemsFrom(parsedBody.error), 400);
  }
  const { declineTracked, sendMail: sendMailRequested, sendWhatsapp: sendWhatsappRequested } = parsedBody.data;

  // B2225 — a decline is only recorded for a field this day has neither
  // filled in nor answered, so the file never says a value is there and
  // absent at once, and an earlier reason is never silently replaced. Refused,
  // not ignored, exactly as the studio's door refuses `declineOpen`.
  const locales = getUser(user)?.locales ?? [];
  const blank = new Set(missingAtPublish(day, locales).map((row) => row.field));
  const refused = [...new Set(declineTracked ?? [])].filter((field) => !blank.has(field));
  if (refused.length > 0) {
    return fail(
      "invalid_request",
      `Not blank on this day: ${refused.join(", ")}. declineTracked may only name a field the day has ` +
        "neither filled in nor already answered. Nothing was written or published.",
      { refused },
      400,
    );
  }

  const declined = { ...day.declined };
  for (const field of declineTracked ?? []) {
    declined[field] = declineReason;
  }

  const merged = { ...day, declined: Object.keys(declined).length > 0 ? declined : undefined, status: "draft" as const };
  // Completeness is the write shape's own check — `missingAtPublish`
  // (lib/api/v2/days.ts) carries the reasons it is `dayMerged`, strips the
  // media echo and exempts a single-locale journal's translations.
  const missing = missingAtPublish(merged, locales);
  if (missing.length > 0) {
    return fail(
      "incomplete_day",
      ERROR_CODES.incomplete_day,
      {
        missing,
        note:
          "The day is still a draft and nothing was sent. Add what is missing — or say in " +
          "this call that it does not have it (declineTracked), and publish again.",
      },
      422,
    );
  }

  const dryRun = readDryRun(request);
  if (dryRun === null) {
    return fail("invalid_request", `${ERROR_CODES.invalid_request} dryRun must be true, false, or absent.`, undefined, 400);
  }
  if (dryRun) {
    return ok({ ok: true, written: false, dryRun: true, note: "Nothing was written. This body would be accepted." });
  }

  // B2245's mirror — the body was awaited since `day` was read, and a
  // correction saved meanwhile would be published over by the older text.
  // Re-read synchronously right before the write (nothing
  // can interleave between this and `writeDayFile`) and refuse on any change.
  if (JSON.stringify(readDayFile(user, tripId, slug)) !== JSON.stringify(day)) {
    return fail(
      "stale_document",
      "The day changed while this publish was being checked, so nothing was published or sent. " +
        "Read it again, and publish again if it is still what the person wants on the site.",
      undefined,
      409,
    );
  }

  const ref = `${user}/${tripId}`;
  writeDayFile(user, tripId, slug, { ...merged, declined, status: "published" });

  // B2202 rework: publishing no longer re-derives `track.json`. Derivation
  // now covers every trip date regardless of publish state, so there is
  // nothing for a publish to move forward — the reader-facing filter that
  // actually decides what a publish reveals is `readerTrack` (`lib/gps/track.ts`),
  // applied at serve time from the current entry list, not from a file
  // written at some earlier publish. A track is re-derived only when an
  // import gives the store new fixes (`lib/gps/api.ts`'s `importGps`) or the
  // owner's own explicit `POST …/track`.

  // Neither send function throws for an ordinary reason not to send — both
  // resolve to `{ok:false, reason:...}` (including `"unknown_trip"`, the
  // shape a v2-native day currently gets from their v1 reader — B1598).
  let mail: Record<string, unknown> | undefined;
  if (sendMailRequested) {
    /**
     * The same double-press guard the WhatsApp branch below already has —
     * B2443. Mail was the one send on this route with no claim at all, so a
     * publish followed by a retried publish (or a resend button pressed
     * while the first request was still in flight) mailed the whole
     * readership twice. Claiming "mail" first means only the request that
     * wins the claim ever calls `sendDayLetter`.
     */
    if (await claimChannel(user, tripId, v1Slug(slug), "mail")) {
      const outcome = await sendDayLetter(user, ref, v1Slug(slug));
      if (!outcome.ok) await releaseChannelClaim(user, tripId, v1Slug(slug), "mail");
      mail = mailSummary(outcome);
    } else {
      // A lost claim reports nothing rather than inventing an outcome for a
      // send this call never made — the same silence the WhatsApp branch
      // below gives for a channel already spoken for. Logged against the
      // owner's own address: there is no one recipient at this point, only
      // "this journal's whole readership was skipped" (B2438).
      await logMessage({
        template: "news.mail",
        channel: "mail",
        to: getUser(user)?.owner.email ?? user,
        owner: user,
        status: "skipped",
        reason: "deduped",
      });
    }
  }
  let whatsapp: Record<string, unknown> | undefined;
  if (sendWhatsappRequested) {
    /**
     * The double-press guard, at the door that triggers automatically —
     * B1663. `writeDayFile` above is what flips this day out of `draft`, and
     * a genuinely concurrent publish call (a retried request the client
     * sent not knowing the first had already landed) can read the old status
     * before that write commits and reach here a second time. Claiming the
     * channel first is `lib/digest/dayNotify.ts`'s own guard — the same one
     * the owner's manual resend button already uses — so only the request
     * that wins the claim ever calls `sendDayWhatsapp`; the loser sends
     * nothing rather than reaching the whole readership twice. AGENTS.md is
     * plain about which side of that trade is worse.
     */
    if (await claimChannel(user, tripId, v1Slug(slug), "whatsapp")) {
      const outcome = await sendDayWhatsapp(user, ref, v1Slug(slug));
      if (!outcome.ok) await releaseChannelClaim(user, tripId, v1Slug(slug), "whatsapp");
      whatsapp = whatsappSummary(outcome);
    } else {
      // A lost claim reports nothing rather than inventing an outcome for a
      // send this call never made — the same silence `notify/route.ts` gives
      // for a channel already spoken for.
      await logMessage({
        template: "news.wa",
        channel: "wa",
        to: getUser(user)?.owner.email ?? user,
        owner: user,
        status: "skipped",
        reason: "deduped",
      });
    }
  }

  /**
   * Push, automatically — B2448. Unlike mail/WhatsApp above, nobody asks for
   * this: it goes out to every subscriber `subscribersFor` (`lib/push.ts`)
   * says may see this day, the same audience `scripts/notify.mts` used to
   * need a person to run by hand for. `claimChannel(..., "push")` is the same
   * double-send guard `whatsapp` uses just above (B2443's pattern), so a
   * retried request that lands after the first already claimed the channel
   * sends nothing a second time. `afterResponse` keeps the fan-out off the
   * response's critical path — a publish must not get slower as a journal
   * gains subscribers — and `sendPush` (lib/push/send.ts) is itself a silent
   * no-op with no VAPID environment or the `push` capability off, so an
   * instance that has never turned push on pays nothing for this and never
   * throws.
   */
  // Push switched off: no claim burned and no deferred work queued at all.
  if (isEnabled("push") && (await claimChannel(user, tripId, v1Slug(slug), "push"))) {
    const pushTrip = { username: user, visibility: trip.visibility, test: trip.test } as unknown as Trip;
    const pushEntry = { test: day.test, visibility: day.visibility };
    const pushUrl = `${serverSite().url}${journalPath(user)}/trips/${tripId}/day/${slug}`;
    const owner = getUser(user);
    afterResponse("publish-push", async () => {
      const recipients = await subscribersFor(pushTrip, pushEntry);
      if (recipients.length === 0) return;

      const byLocale = new Map<string, StoredSubscription[]>();
      for (const sub of recipients) {
        const locale = await localeForSubscriber(user, sub);
        const group = byLocale.get(locale);
        if (group) group.push(sub);
        else byLocale.set(locale, [sub]);
      }

      await Promise.all(
        [...byLocale].map(([locale, subs]) => {
          const composed = composeDayPush(
            { journalTitle: owner?.title ?? user, dayTitle: day.title },
            locale as Parameters<typeof composeDayPush>[1],
          );
          return sendPush({
            template: "news.push",
            subscriptions: subs,
            title: "title" in composed ? composed.title ?? "" : "",
            body: "text" in composed ? composed.text : "",
            url: pushUrl,
            tag: `day-${slug}`,
            locale,
          });
        }),
      );
    });
  } else {
    // A lost claim (an already-announced day, or a retried request) sends
    // nothing a second time — the same silence the WhatsApp branch above
    // gives for its own channel.
    await logMessage({
      template: "news.push",
      channel: "push",
      to: getUser(user)?.owner.email ?? user,
      owner: user,
      status: "skipped",
      reason: "deduped",
    });
  }

  const test = isTestContent(tripLike(user, tripId, trip.people), day) || trip.test === true || day.test === true;
  // Instance-level, like every capability in v2 (decision 5): whether this
  // server can send mail or WhatsApp at all is the operator's fact, not a
  // journal's. B1617.
  const channels = (["mail", "whatsapp"] as const)
    .filter((channel) => isEnabled(channel))
    .map((channel) => ({
      channel,
      url: `${serverSite().url}/api/v2/${user}/trips/${tripId}/days/${slug}/send`,
    }));
  const notify =
    sendMailRequested || sendWhatsappRequested || test || channels.length === 0
      ? undefined
      : {
          channels,
          ask:
            "Nobody has been told this day is up. Ask them, in words, whether to announce it — " +
            `by ${channels.map((c) => (c.channel === "mail" ? "email" : "WhatsApp")).join(" or ")}, ` +
            'or not at all — and POST {"channels":["mail"|"whatsapp"]} to that URL for whichever ' +
            "they choose. Do not decide for them, and do not send on a channel they did not name.",
        };

  return ok({
    slug,
    status: "published",
    url: `${serverSite().url}${journalPath(user)}/trips/${tripId}/day/${slug}`,
    note: publishNotice({
      title: day.title,
      date: day.date,
      url: `${serverSite().url}${journalPath(user)}`,
      test,
      visibility: trip.visibility,
      listed: trip.listed,
      locale: getUser(user)?.defaultLocale,
    }),
    ...(mail ? { mail } : {}),
    ...(whatsapp ? { whatsapp } : {}),
    ...(notify ? { notify } : {}),
  });
}
