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
// (`lib/digest/dayLetter.ts`, `lib/digest/dayWhatsapp.ts`), which already
// degrade to a clean `{ok:false, reason:"unknown_trip"}` rather than throwing
// when the v1 reader they depend on cannot see a v2-native trip (B1598) — so
// a send requested against a v2-only day reports `attempted:false` honestly
// rather than crashing, until that read layer is rebuilt.
import { dayDoc, dayWrite, publishRequest, DAY_DECLINABLE_KEYS } from "@/lib/api/v2/schemas";
import { incompleteFrom, problemsFrom } from "@/lib/api/v2/incomplete";
import { exemptSingleLocaleTranslations } from "@/lib/api/v2/write";
import { fail, ok, readDryRun, readJson } from "@/lib/api/v2/route";
import { resolveBearer, ownsUser } from "@/lib/api/v2/auth";
import { mayActAsOwner, mayWriteTrip, refuseWrite } from "@/lib/api/auth";
import { publishNotice } from "@/lib/api/entries";
import { isTestContent } from "@/lib/access";
import { isEnabled } from "@/lib/capabilities";
import { balanceOf } from "@/lib/credits";
import { formatCredits } from "@/lib/credits/format";
import { serverSite } from "@/lib/site";
import { getUser } from "@/lib/users";
import { ERROR_CODES } from "@/lib/api/errorCodes";
import { readTripFile, readDayFile, writeDayFile } from "@/lib/api/v2/store";
import { mailSummary } from "@/lib/api/dayMail";
import { whatsappSummary } from "@/lib/api/dayWhatsapp";
import { stripMediaEcho, v1Slug } from "@/lib/api/v2/days";
import { sendDayLetter, type DayLetterOutcome } from "@/lib/digest/dayLetter";
import { sendDayWhatsapp, whatsappWouldCost, type DayWhatsappOutcome } from "@/lib/digest/dayWhatsapp";
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

  const declined = { ...day.declined };
  for (const field of declineTracked ?? []) {
    declined[field] = "declined at publish (declineTracked)";
  }

  const merged = { ...day, declined: Object.keys(declined).length > 0 ? declined : undefined, status: "draft" as const };
  // Completeness is `dayWrite`'s own check (the `superRefine` `dayDoc` does
  // not carry) — the media echo is stripped first, same as PATCH/PUT, since
  // this day came off disk with server-added fields `dayWrite` refuses.
  // B1667 — same door-level exemption the write routes apply: a
  // single-locale journal has no honest answer for `translations` either
  // way, so this completeness recheck must not re-demand it here either.
  // Applied to the throwaway validation candidate only — `merged` itself
  // (written to disk below) never carries the synthesised value.
  const publishCandidate = stripMediaEcho({ ...merged });
  exemptSingleLocaleTranslations(publishCandidate, getUser(user)?.locales ?? []);
  const check = dayWrite.safeParse(publishCandidate);
  if (!check.success) {
    const { missing } = incompleteFrom(
      check.error,
      dayDoc.shape as unknown as Record<string, import("zod").ZodType>,
      DAY_DECLINABLE_KEYS,
    );
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

  const ref = `${user}/${tripId}`;
  writeDayFile(user, tripId, slug, { ...merged, declined, status: "published" });

  // Neither send function throws for an ordinary reason not to send — both
  // resolve to `{ok:false, reason:...}` (including `"unknown_trip"`, the
  // shape a v2-native day currently gets from their v1 reader — B1598).
  let mail: Record<string, unknown> | undefined;
  if (sendMailRequested) {
    mail = mailSummary(await sendDayLetter(user, ref, v1Slug(slug)));
  }
  let whatsapp: Record<string, unknown> | undefined;
  if (sendWhatsappRequested) {
    whatsapp = whatsappSummary(await sendDayWhatsapp(user, ref, v1Slug(slug)));
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
