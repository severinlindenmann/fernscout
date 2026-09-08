import {
  authenticate,
  errorResponse,
  mayWriteTrip,
  outOfScope,
  ownsUser,
  refuseWrite,
} from "@/lib/api/auth";
import { isTestContent } from "@/lib/access";
import {
  EDITABLE_DAY_FIELDS,
  editEntry,
  journalLanguages,
  type EditInput,
} from "@/lib/api/entries";
import { fillTripRatesQuietly } from "@/lib/api/tripRates";
import { fillDayWeatherQuietly, weatherOffRefusal } from "@/lib/api/weather";
import { AS_AUTHOR, getEntryBySlug } from "@/lib/entries";
import { getTrip, tripRef } from "@/lib/trips";
import { validateEntryEdit } from "@/lib/validate/entry";

export const dynamic = "force-dynamic";

/**
 * One day, in full — including a draft.
 *
 * The gap this fills: an agent could write a day and never read it back.
 * `/drafts` lists slugs, titles and dates; the markdown twin at
 * `/<user>/day/<slug>.md` is gated like the public page and so answers 404 for
 * anything unpublished. So an agent that wanted to check its own work before
 * telling a person it was ready — which is exactly what we ask it to do — had
 * nowhere to look, and neither did the owner's own tooling. Both the companion
 * and the owner asked for this in testing.
 *
 * Authenticated and scoped like every other write on this path, because a
 * draft is the most private thing in the journal: it is what somebody has not
 * decided to publish. `mayWriteTrip` rather than a read check — whoever may
 * change the day may read it.
 *
 * A trip that does not exist and a trip that is not yours answer the same way,
 * so a token scoped to one trip cannot enumerate the journal's others.
 */
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/v1/[user]/trips/[trip]/days/[slug]">,
) {
  const auth = await authenticate(request);
  if (!auth.ok) return errorResponse(auth);

  const { user, trip, slug } = await params;
  if (!ownsUser(auth.session, user)) {
    return outOfScope(auth.session, user);
  }

  const ref = tripRef(user, trip);
  const found = getTrip(ref);
  if (!found) return Response.json({ error: "unknown_trip" }, { status: 404 });
  const gate = await mayWriteTrip(auth.session, found);
  if (!gate.ok) return refuseWrite(gate);

  const entry = getEntryBySlug(ref, slug, AS_AUTHOR);
  if (!entry) return Response.json({ error: "unknown_day" }, { status: 404 });

  return Response.json({
    trip: ref,
    slug: entry.slug,
    title: entry.title,
    date: entry.date,
    ...(entry.time ? { time: entry.time } : {}),
    location: entry.location,
    country: entry.country,
    ...(entry.countryCode ? { countryCode: entry.countryCode } : {}),
    // What the day deliberately has none of — B531 writes it into the file and
    // nothing read it back out, so an agent reading a day it did not write
    // could not tell "there was no money on this day" from "nobody asked". It
    // then asks again, and asking again is how an amount gets invented. B540.
    ...(entry.without?.length ? { without: entry.without } : {}),
    // And what nobody knows — B560. The two have to be distinguishable here of
    // all places: an agent reading a day back to check its own work must not
    // read "nobody recorded the money" as "there was none".
    ...(entry.unrecorded?.length ? { unrecorded: entry.unrecorded } : {}),
    ...(Number.isFinite(entry.lat) ? { lat: entry.lat } : {}),
    ...(Number.isFinite(entry.lng) ? { lng: entry.lng } : {}),
    gallery: entry.gallery,
    tags: entry.tags,
    costs: entry.costs,
    // Both accepted on the way in, and until W38 neither came back — so an
    // agent doing what the guide asks, reading its own work back before
    // telling somebody it is ready, could confirm the prose and the costs and
    // not the rest. A field the API takes is a field it has to show.
    ...(entry.transport ? { transport: entry.transport } : {}),
    // Same principle, same bug shape as `transport` above: accepted on the way
    // in and never shown, so an agent that set the arrival scene — or hit the
    // "written as sent, read back as the default" case documented for an
    // unrecognised value — had no way to tell either from silence. Omitted
    // when absent because "default" *is* the absent state (see the comment on
    // `Entry.travelScene`), so there is nothing to distinguish by adding it
    // back explicitly. B540.
    ...(entry.travelScene ? { travelScene: entry.travelScene } : {}),
    // Same shape as `weatherData` on the way in — `DayWeather` always carries
    // its own `source` and `recordedAt`, so there is no way to show a number
    // without also showing where it came from. B540.
    ...(entry.weather ? { weather: entry.weather } : {}),
    // The other half of B294: a journal with two or more locales refuses a day
    // without every translation, so an agent has to be able to read back what
    // it wrote to check it stuck. Same shape it is written in — `{title,
    // content}` per locale — so a read-back could be fed straight into a PATCH.
    ...(entry.translations && Object.keys(entry.translations).length > 0
      ? { translations: entry.translations }
      : {}),
    /**
     * The flag the *page* will act on, not just the entry's own.
     *
     * A day in a test trip carries no flag of its own and still gets the
     * banner, so reporting only `entry.test` told an agent that had marked the
     * whole trip that its day was ordinary. `isTestContent` is the predicate
     * the renderer uses; this is the same question.
     */
    ...(isTestContent(found, entry) ? { test: true } : {}),
    // B632 — a field this endpoint takes on the way in has to be readable
    // back, or an agent checking its own work cannot tell whether the label
    // stuck.
    ...(entry.visibility ? { visibility: entry.visibility } : {}),
    content: entry.content,
    // Stated rather than implied. An agent reporting back to a person needs to
    // say whether this is on the site, and `status` absent from a response is
    // too easy to read as "published".
    status: entry.draft ? "draft" : "published",
  });
}

/**
 * Edit a day that already exists — B266.
 *
 * Before this there was no way to change a day once written, and the agent
 * that tried reached for `.../publish` instead, because it was the only verb
 * that touched an existing file — and published fifteen unreviewed days while
 * reporting them as drafts. See `lib/api/entries.ts`'s `editEntry` for how
 * this is made structurally incapable of repeating that: `status` is not a
 * field this writes, by type and by an explicit refusal below, and a draft
 * stays a draft and a published day stays published whatever the body asks
 * for — checked again after the edit, not merely assumed from the code.
 *
 * Same authority as writing a day in the first place: whoever `mayWriteTrip`
 * lets create a day may correct one, trip-scoped tokens included. Publishing
 * and unpublishing stay owner-only, through their own endpoint — this one
 * cannot reach either.
 */
export async function PATCH(
  request: Request,
  { params }: RouteContext<"/api/v1/[user]/trips/[trip]/days/[slug]">,
) {
  const auth = await authenticate(request);
  if (!auth.ok) return errorResponse(auth);

  const { user, trip, slug } = await params;
  if (!ownsUser(auth.session, user)) {
    return outOfScope(auth.session, user);
  }

  const ref = tripRef(user, trip);
  const found = getTrip(ref);
  if (!found) return Response.json({ error: "unknown_trip" }, { status: 404 });
  const gate = await mayWriteTrip(auth.session, found);
  if (!gate.ok) return refuseWrite(gate);

  const body = (await request.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const keys = Object.keys(body);
  if (keys.length === 0) {
    return Response.json(
      {
        error: "invalid_request",
        message: `Name what to change: one or more of ${EDITABLE_DAY_FIELDS.join(", ")}.`,
      },
      { status: 400 },
    );
  }

  /**
   * Named rather than dropped — the same shape as `owner.email` on the
   * journal config PATCH. `status` is the one this ticket is about: a day
   * moves between draft and published only through `.../publish`, never by
   * this call, whatever it is asked to set — so a body that names it is
   * refused whole rather than partially applied, and the caller is told why
   * instead of quietly being ignored.
   */
  const unwritable = keys.filter(
    (key) => !(EDITABLE_DAY_FIELDS as readonly string[]).includes(key),
  );
  if (unwritable.length > 0) {
    return Response.json(
      {
        error: "unsupported_field",
        message:
          `This call changes ${unwritable.map((k) => JSON.stringify(k)).join(", ")} for nobody, ` +
          "and nothing was written. A day moves between draft and published only through " +
          "POST .../publish — never through this call, whatever it is asked to set. This " +
          `endpoint writes ${EDITABLE_DAY_FIELDS.join(", ")}.`,
      },
      { status: 400 },
    );
  }

  // The one fact `checkCaptions` cannot know on its own, since the validator
  // is pure and has no filesystem — this is the day's gallery as it stands
  // right now, so a `src` that names no photograph on it is refused rather
  // than silently matching nothing. B540. A day this call cannot even find
  // is `editEntry`'s 404 to report, so this does not turn a missing day into
  // a validation error of its own.
  const current = getEntryBySlug(ref, slug, AS_AUTHOR);
  const problems = validateEntryEdit(
    body,
    journalLanguages(user),
    current?.gallery.map((item) => item.src),
  );
  if (problems.length > 0) {
    return Response.json({ error: "invalid_entry", problems }, { status: 400 });
  }

  // B778 — the same refusal the create route makes, for the same reason: this
  // answered `200 {"changed":["weather"]}` for a lookup that could never
  // happen, and the only way to find out was to re-read the day and guess why.
  const weatherOff = weatherOffRefusal(user, body);
  if (weatherOff) return Response.json(weatherOff, { status: 400 });

  const result = editEntry(ref, slug, body as EditInput);
  if (!result.ok) {
    const status = result.bug
      ? 500
      : result.error === "unknown_day"
        ? 404
        : 400;
    return Response.json({ error: result.error }, { status });
  }

  // B325, the same call the create route makes and for the same reasons: a
  // day that has just acquired `weather: true`, or a coordinate it did not
  // have, is a day that can now be looked up. It cannot fail this edit.
  //
  // B538 — only when the patch actually touches a field the lookup depends
  // on. Without this, a day the archive has no answer for (no row yet, a
  // coordinate over open water, a provider outage) re-fetched on every PATCH
  // for as long as the answer stayed missing — ten prose corrections meant
  // ten requests to open-meteo.com for an edit that never came near the
  // weather. The sweep (`npm run weather:update`) is what exists for the
  // "not yet answered" case; it runs on a timer, not per keystroke.
  if (
    keys.some(
      (key) =>
        key === "weather" || key === "lat" || key === "lng" || key === "date",
    )
  ) {
    await fillDayWeatherQuietly(ref, result.slug);
  }
  // B543, the same call: an edit may add a cost, or change one's currency,
  // that the trip's `rates:` table does not cover yet.
  await fillTripRatesQuietly(ref);

  // The half B263 and this ticket both turn on: what the agent reports back
  // has to be the day's actual state, not its own intention. So this says it
  // plainly rather than leaving it to be inferred from a 200.
  return Response.json({
    ok: true,
    slug: result.slug,
    status: result.status,
    changed: keys,
    ...(result.costCurrency ? { costCurrency: result.costCurrency } : {}),
    note:
      (result.status === "draft"
        ? `Still a draft — not on the site. This call cannot publish it; ` +
          `POST .../days/${result.slug}/publish when they say so.`
        : "Still published — anyone who already read it can now see this change. " +
          "This call cannot take it off the site or move it back to draft.") +
      (result.costCurrency
        ? ` A cost line named no currency, so it was written in ${result.costCurrency} — this day's own.`
        : ""),
  });
}
