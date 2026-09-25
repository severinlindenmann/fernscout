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
import { isEnabled } from "@/lib/capabilities";
import { balanceOf } from "@/lib/credits";
import { formatCredits } from "@/lib/creditsFormat";
import { serverSite } from "@/lib/site";
import { getUser } from "@/lib/users";
import { ERROR_CODES } from "@/lib/api/errorCodes";
import { readTripFile, readDayFile, writeDayFile } from "@/lib/api/v2/store";
import { mailSummary } from "@/lib/api/dayMail";
import { whatsappSummary } from "@/lib/api/dayWhatsapp";
import { missingAtPublish, v1Slug } from "@/lib/api/v2/days";
import { claimChannel, releaseChannelClaim } from "@/lib/digest/dayNotify";
import { sendDayLetter, type DayLetterOutcome } from "@/lib/digest/dayLetter";
import { sendDayWhatsapp, whatsappWouldCost, type DayWhatsappOutcome } from "@paid/whatsapp/lib/digest/dayWhatsapp";
import type { Trip } from "@/lib/types";

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

  // The credits pre-flight — advisory, not the guard (see lib/digest/dayWhatsapp.ts
  // for the one that actually holds the line). Best-effort: a day this
  // server cannot yet read a real cost estimate for (B1598) is charged the
  // one-message floor rather than nothing.
  if (sendWhatsappRequested) {
    const balance = await balanceOf(user);
    if (balance !== null) {
      const needed = await whatsappWouldCost(user, `${user}/${tripId}`, v1Slug(slug)).catch(() => 1);
      if (needed > balance) {
        return fail(
          "no_credits",
          `Sending this day would take ${needed} credit(s); this journal has ${formatCredits(balance)} left. Nothing was published.`,
          { needed, balance },
          402,
        );
      }
    }
  }

  // B2245's mirror — the body and the credits check were awaited since `day`
  // was read, and a correction saved meanwhile would be published over by
  // the older text. Re-read synchronously right before the write (nothing
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
    mail = mailSummary(await sendDayLetter(user, ref, v1Slug(slug)));
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
    }
    // A lost claim reports nothing rather than inventing an outcome for a
    // send this call never made — the same silence `notify/route.ts` gives
    // for a channel already spoken for.
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
    url: `${serverSite().url}/${user}/trips/${tripId}/day/${slug}`,
    note: publishNotice({
      title: day.title,
      date: day.date,
      url: `${serverSite().url}/${user}`,
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
