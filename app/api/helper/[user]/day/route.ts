import { reversePlace } from "@/lib/addressLookup";
import { createDraft, editEntry, factsOfInput, type DraftInput, type EditInput } from "@/lib/api/entries";
import { fillDayWeatherQuietly } from "@/lib/api/weather";
import { isEnabled } from "@/lib/capabilities";
import { NO_PROSE } from "@/lib/helper/draft";
import { dayForWizard, isHelperOwner, notYourJournal, previewOf } from "@/lib/helper/server";
import { requestLocale } from "@/lib/locales";
import { missingFrom, TRACKS, UNKNOWN, type Track } from "@/lib/tracks";
import { getTrip, tripRef } from "@/lib/trips";

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

type Answer = "none" | "unknown";

/**
 * The three answers a trip can ask a day for, and the two ways to say a day
 * has none of it — `lib/tracks.ts`.
 *
 * They travel as words rather than as `false`/`"unknown"` so that the wizard's
 * buttons and this parser cannot drift; the values below are the ones the
 * writer actually understands. `"none"` is a statement ("nothing was spent"),
 * `"unknown"` is the other one ("money was spent and nobody has the figures"),
 * and the difference is B540's — a decline that means "I do not know" is a
 * sentence somebody's journal will carry as fact.
 */
function declines(raw: unknown): Partial<Record<Track, false | typeof UNKNOWN>> {
  const given = (raw ?? {}) as Record<string, unknown>;
  const out: Partial<Record<Track, false | typeof UNKNOWN>> = {};
  for (const key of TRACKS) {
    const said = given[key] as Answer | undefined;
    if (said === "none") out[key] = false;
    else if (said === "unknown") out[key] = UNKNOWN;
  }
  return out;
}

/** 404 for a journal that is not this reader's, the same answer as for one
 *  that does not exist — a wizard URL must not confirm whose journal it is. */
async function gate(request: Request, user: string): Promise<Response | null> {
  if (!(await isHelperOwner(user))) {
    return notYourJournal(request);
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
  const refused = await gate(request, user);
  if (refused) return refused;

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
  const refused = await gate(request, user);
  if (refused) return refused;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "invalid_json" }, { status: 400 });

  const tripId = text(body.trip) ?? "";
  const ref = tripRef(user, tripId);
  const trip = getTrip(ref);
  if (!trip) return Response.json({ error: "unknown_trip" }, { status: 404 });

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
    ...declines(body.answers),
  };

  // The same gate `POST /api/v1/.../days` applies, asked here so the wizard
  // can put the trip's own questions on the screen with buttons rather than
  // handing somebody a 422 they cannot act on.
  const missing = missingFrom(factsOfInput(input), trip.tracks, "write");
  if (missing.length > 0) {
    return Response.json(
      { error: "incomplete_day", missing: missing.map((m) => m.field) },
      { status: 422 },
    );
  }

  const written = createDraft(ref, input);
  if (!written.ok) {
    return Response.json({ error: written.error }, { status: written.bug ? 500 : 400 });
  }
  await fillDayWeatherQuietly(ref, written.slug);

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
 */
export async function PATCH(request: Request, { params }: RouteContext<"/api/helper/[user]/day">) {
  const { user } = await params;
  const refused = await gate(request, user);
  if (refused) return refused;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "invalid_json" }, { status: 400 });

  const tripId = text(body.trip) ?? "";
  const ref = tripRef(user, tripId);
  if (!getTrip(ref)) return Response.json({ error: "unknown_trip" }, { status: 404 });
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

  const input: EditInput = {
    ...(text(body.title) ? { title: text(body.title) } : {}),
    ...(typeof body.content === "string" ? { content: body.content } : {}),
    ...(captions ? { captions } : {}),
    ...declines(body.answers),
  };
  if (Object.keys(input).length === 0) {
    return Response.json({ error: "nothing_to_change" }, { status: 400 });
  }

  const edited = editEntry(ref, slug, input);
  if (!edited.ok) {
    return Response.json({ error: edited.error }, { status: edited.bug ? 500 : 400 });
  }
  return state(user, tripId, slug);
}
