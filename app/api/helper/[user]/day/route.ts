import { reversePlace } from "@/lib/addressLookup";
import {
  createDraft,
  editEntry,
  factsOfInput,
  renameEntrySlug,
  slugAvailable,
  type DraftInput,
  type EditInput,
} from "@/lib/api/entries";
import { fillDayWeatherQuietly } from "@/lib/api/weather";
import { isEnabled } from "@/lib/capabilities";
import { AS_AUTHOR, getEntryBySlug } from "@/lib/entries";
import { NO_PROSE } from "@/lib/helper/draft";
import { dayForWizard, isHelperOwner, notYourJournal, previewOf } from "@/lib/helper/server";
import { stashWords } from "@/lib/helper/undo";
import { requestLocale } from "@/lib/locales";
import { parsePhotoVisibility } from "@/lib/photos";
import { slugify } from "@/lib/slug.ts";
import { declinesIn, missingFrom } from "@/lib/tracks";
import { getTrip, tripRef } from "@/lib/trips";
import { refused, wrote } from "@/lib/helper/thread";

export const dynamic = "force-dynamic";

/**
 * The wizard's own door onto one day — B682.
 *
 * ## Why this is not `/api/v1/…`
 *
 * It looks like a second implementation of `POST .../days` and it is not: the
 * only thing here that touches content is `createDraft` and `editEntry`, the
 * same two functions that route calls. What differs is the credential. Every
 * `/api/v1` route authenticates a bearer token and nothing else, on purpose
 * (decision 24), and the browser has a cookie — so a wizard that "drove the v1
 * routes" would have had to put a seven-day write token into a page, which is
 * the exact thing B283's twenty-minute handover exists to avoid.
 *
 * So: cookie only, owner only, outside `/api/v1`, and outside the contract
 * `/openapi.json` publishes — the same shape the postcard send route already
 * has, and for the same reason. `docs/plans/2026-09-07-web-helper-agent.md` §4
 * decided it.
 *
 * ## What is deliberately missing
 *
 * There is no `status`, no publish, and no way to reach one from here — that
 * is `./publish/route.ts`, which is a button somebody presses. Everything
 * written by this route is a draft, exactly as everything an agent writes is.
 */

/** 404 for a journal that is not this reader's, the same answer as for one
 *  that does not exist — a wizard URL must not confirm whose journal it is. */
async function gate(request: Request, user: string): Promise<Response | null> {
  if (!(await isHelperOwner(user))) {
    return notYourJournal(request, user);
  }
  return null;
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

/** The day — draft or published, since B816 — as a reader would see it, in
 *  one answer, so the wizard never has to guess what it just did. */
function state(user: string, trip: string, slug: string): Response {
  const draft = dayForWizard(user, trip, slug);
  if (!draft) return Response.json({ error: "unknown_day" }, { status: 404 });
  return Response.json({ ok: true, draft, preview: previewOf(user, trip, slug) });
}

export async function GET(request: Request, { params }: RouteContext<"/api/helper/[user]/day">) {
  const { user } = await params;
  const gated = await gate(request, user);
  if (gated) return gated;

  const url = new URL(request.url);
  const trip = url.searchParams.get("trip") ?? "";
  const slug = url.searchParams.get("slug") ?? "";
  if (!getTrip(tripRef(user, trip))) {
    return Response.json({ error: "unknown_trip" }, { status: 404 });
  }
  return state(user, trip, slug);
}

/**
 * Create the day, as soon as the trip and the date are known.
 *
 * Early on purpose: from here on the draft on disk *is* the session, so a tab
 * closed on the bus loses nothing but which screen it was showing.
 *
 * Two fields are filled in without anybody typing them, and neither is a
 * guess. `location` comes from the coordinates in the photographs, through the
 * `addressLookup` provider — off, or unreachable, and the day simply has no
 * place, which is the honest outcome. `weather: true` is a *request*: this
 * server looks the day up in a public archive afterwards, which is the only
 * route to weather that AGENTS.md permits at all.
 *
 * The title is the date, and the prose is `NO_PROSE`. Both are placeholders
 * and both are visibly nothing: the words step replaces them with what the
 * person actually says, and a plausible invented title would be harder to
 * notice than an ISO date.
 */
export async function POST(request: Request, { params }: RouteContext<"/api/helper/[user]/day">) {
  const { user } = await params;
  const gated = await gate(request, user);
  if (gated) return gated;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "invalid_json" }, { status: 400 });

  const tripId = text(body.trip) ?? "";
  const ref = tripRef(user, tripId);
  const trip = getTrip(ref);
  if (!trip) {
    refused(user, "start_day", "unknown_trip");
    return Response.json({ error: "unknown_trip" }, { status: 404 });
  }

  const date = text(body.date) ?? "";
  const lat = number(body.lat);
  const lng = number(body.lng);

  const place =
    lat !== undefined && lng !== undefined && isEnabled("addressLookup", user)
      ? await reversePlace(lat, lng, await requestLocale())
      : null;

  const input: DraftInput = {
    title: date,
    date,
    content: NO_PROSE,
    ...(text(body.time) ? { time: text(body.time) } : {}),
    ...(lat !== undefined ? { lat } : {}),
    ...(lng !== undefined ? { lng } : {}),
    ...(place ? { location: place.location, country: place.country } : {}),
    ...(place?.countryCode ? { countryCode: place.countryCode } : {}),
    // B325 — a request for a lookup, never an answer. The archive is asked
    // below, once the day is on disk.
    weather: true,
    ...declinesIn(body),
  };

  // The same gate `POST /api/v1/.../days` applies, asked here so the wizard
  // can put the trip's own questions on the screen with buttons rather than
  // handing somebody a 422 they cannot act on.
  const missing = missingFrom(factsOfInput(input), trip.tracks, "write");
  if (missing.length > 0) {
    refused(user, "start_day", "incomplete_day");
    return Response.json(
      { error: "incomplete_day", missing: missing.map((m) => m.field) },
      { status: 422 },
    );
  }

  const written = createDraft(ref, input);
  if (!written.ok) {
    // `code`, when present, is the stable identifier `failureSentence()` in
    // `components/HelperAsk.tsx` can turn into a sentence — B785. `error`
    // itself is an English sentence written for an agent reading
    // `/api/v1/…`, and this route is read by a person on a possibly-German
    // screen.
    const answer = written.code ?? written.error;
    refused(user, "start_day", answer);
    return Response.json({ error: answer }, { status: written.bug ? 500 : 400 });
  }
  await fillDayWeatherQuietly(ref, written.slug);

  wrote(user, "start_day", { trip: tripId, slug: written.slug, date });
  return Response.json({ ok: true, trip: tripId, slug: written.slug }, { status: 201 });
}

/**
 * The words, and the answers to the trip's questions.
 *
 * Nothing here can publish and nothing here writes weather: `weatherData` is
 * the field a person's own thermometer reading goes in, it is not something a
 * wizard has, and it is not in the list below.
 *
 * Since B816 this is also how a **published** day is corrected, and that is
 * `editEntry`'s guarantee rather than this route's care: a draft stays a draft
 * and a published day stays published whatever the body asks for. What the
 * wizard owes the person is the sentence — saving a day that is on the site
 * changes what people can already read — and it says it on the screen before
 * the button.
 *
 * Since B1276 a real `title` also gives a still-drafting day its real slug,
 * in place of the `<date>-<date>.md` it was created with — see the doc
 * comment on `renameEntrySlug` for the whole of it. Forward only: a day
 * already published never has its address changed here.
 */
export async function PATCH(request: Request, { params }: RouteContext<"/api/helper/[user]/day">) {
  const { user } = await params;
  const gated = await gate(request, user);
  if (gated) return gated;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "invalid_json" }, { status: 400 });

  const tripId = text(body.trip) ?? "";
  const ref = tripRef(user, tripId);
  if (!getTrip(ref)) {
    refused(user, "set_day_words", "unknown_trip");
    return Response.json({ error: "unknown_trip" }, { status: 404 });
  }
  const slug = text(body.slug) ?? "";

  // Captions, keyed by `src` — how a person keeps or edits what
  // `describe-photos` (B687) suggested. `editEntry` refuses a `src` the day
  // does not carry, so this cannot be used to invent a gallery item.
  const captions =
    body.captions && typeof body.captions === "object" && !Array.isArray(body.captions)
      ? Object.fromEntries(
          Object.entries(body.captions as Record<string, unknown>)
            .filter((pair): pair is [string, string] => typeof pair[1] === "string"),
        )
      : undefined;

  // Holding one photograph back, keyed by `src` exactly as the captions are —
  // B596's label, reached from the browser for the first time by B851. The
  // gentler half of "take that picture out": `null` clears the label, and
  // there is no `public` to send, so nothing here can widen what the trip
  // already decided. `parsePhotoVisibility` is the same parser the file
  // reader uses, so an unrecognised word lands closed rather than being
  // dropped.
  const photoVisibility =
    body.photoVisibility && typeof body.photoVisibility === "object" && !Array.isArray(body.photoVisibility)
      ? Object.fromEntries(
          Object.entries(body.photoVisibility as Record<string, unknown>).map(([src, said]) => [
            src,
            said === null ? null : (parsePhotoVisibility(said) ?? null),
          ]),
        )
      : undefined;

  const input: EditInput = {
    ...(text(body.title) ? { title: text(body.title) } : {}),
    ...(typeof body.content === "string" ? { content: body.content } : {}),
    ...(captions ? { captions } : {}),
    ...(photoVisibility ? { photoVisibility } : {}),
    ...declinesIn(body),
  };
  if (Object.keys(input).length === 0) {
    refused(user, "set_day_words", "nothing_to_change");
    return Response.json({ error: "nothing_to_change" }, { status: 400 });
  }

  // Read once, for whichever of the two things below need it: the stash
  // wants the day's *current* words before they are overwritten, and the
  // rename check wants to know whether this day is still a draft.
  const before =
    input.content !== undefined || input.title !== undefined
      ? getEntryBySlug(ref, slug, AS_AUTHOR)
      : null;

  /**
   * Stashed before the overwrite, and only for a words write — B1218 (D47).
   *
   * `undo_words` is what reads this back; one prior version per day, so a
   * second words write before anybody presses undo simply replaces it. A
   * caption or a track answer changing nothing about the prose has nothing
   * here worth restoring, so the stash only fires when `content` is part of
   * this press.
   */
  if (input.content !== undefined && before) {
    stashWords(ref, slug, { title: before.title, content: before.content });
  }

  /**
   * A real title turns a still-drafting day's `<date>-<date>.md` into a real
   * address — B1276. Computed and checked *before* `editEntry` runs, so a
   * title that collides with another day's slug refuses outright, leaving
   * this day exactly where it was rather than saving new words under a slug
   * nothing will ever reach.
   *
   * `before.draft` is the forward-only guard: a day already published keeps
   * its slug whatever title arrives, because that URL may already be in
   * somebody's email.
   */
  let candidateSlug: string | undefined;
  if (input.title !== undefined && before?.draft) {
    const candidate = slugify(input.title);
    if (candidate !== slug) {
      if (!slugAvailable(ref, candidate)) {
        refused(user, "set_day_words", "slug_taken");
        return Response.json({ error: "slug_taken" }, { status: 400 });
      }
      candidateSlug = candidate;
    }
  }

  const edited = editEntry(ref, slug, input);
  if (!edited.ok) {
    refused(user, "set_day_words", edited.error);
    return Response.json({ error: edited.error }, { status: edited.bug ? 500 : 400 });
  }

  // The rename itself, now that the words are safely on disk under the old
  // slug. `edited.status` is asked again rather than trusted from `before`,
  // for the same forward-only reason: nothing between the two reads should
  // be able to publish a day out from under a rename that assumed it was
  // still a draft, however unlikely one process makes that.
  let finalSlug = slug;
  if (candidateSlug && edited.status === "draft") {
    const renamed = renameEntrySlug(ref, slug, candidateSlug);
    // A collision or a filesystem error here is a race against the check
    // above, which already passed — leave the day on its old slug rather
    // than fail a write that has already succeeded; the next PATCH retries.
    if (renamed.ok) finalSlug = renamed.slug;
  }

  wrote(user, "set_day_words", { trip: tripId, slug: finalSlug, changed: Object.keys(input) });
  return state(user, tripId, finalSlug);
}
