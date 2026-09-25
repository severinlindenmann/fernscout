// POST /api/web/{user}/trips/{trip}/days/{slug}/publish — putting a draft on
// the site, from a cookie — B2140, the studio's "Publish a day".
//
// The twin of `../unpublish/route.ts` beside it, and the same shape for the
// same reason: `POST /api/v2/.../publish` takes a bearer token and a browser
// must never hold one (decision 24). `isOwner` on the cookie only — any
// `Authorization` header is refused outright — and then `applyPublish`, the
// exact function the v2 route calls after its own owner-only gate.
//
// **This door never sends.** Of the body the browser posted, only
// `declineOpen` is read, and the call to `applyPublish` is a body this route
// builds itself, so `sendMail`/`sendWhatsapp` can never ride along. Telling
// readers stays its own decision, on the day's own page (`DayNotify`), after
// it is up.
//
// **`declineOpen` — B2192, decision D3.** The share sheet names the fields
// still blank (`missingAtPublish`), and the owner's one tap on "Share this
// day" records each as left blank, with a reason that says exactly that. The
// list is never trusted: every name must be blank on this day *right now*
// (the same check the publish itself makes) and one the studio may answer —
// `visibility` and `status` are not (a draft already declines visibility on
// create, and status is never a blank). Anything else is refused whole, and
// nothing is written.
import { z } from "zod";
import { applyPublish } from "@/app/api/v2/[user]/trips/[trip]/days/[slug]/publish/route";
import { missingAtPublish } from "@/lib/api/v2/days";
import { DAY_DECLINABLE_KEYS } from "@/lib/api/v2/schemas";
import { readDryRun } from "@/lib/api/v2/route";
import { readDayFile, readTripFile, resolveDayStem } from "@/lib/api/v2/store";
import { fillDayWeatherQuietly } from "@/lib/api/weather";
import { tripRef } from "@/lib/trips";
import { isOwner } from "@/lib/contacts/session";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

/** The reason every share-time decline carries — what happened, and no more. */
const SHARED_BLANK_REASON =
  "left blank when the owner shared this day from the studio (not asked field by field)";

const NOT_FROM_THE_STUDIO: ReadonlySet<string> = new Set(["visibility", "status"]);

const shareBody = z.object({ declineOpen: z.array(z.string()).max(DAY_DECLINABLE_KEYS.length).optional() });

const NOT_FOR_AGENTS = {
  error: "not_for_agents",
  message:
    "This is the owner's own door, from a browser. An agent publishes a day with " +
    "POST /api/v2/{user}/trips/{trip}/days/{slug}/publish, once the owner has said so.",
};

export async function POST(
  request: Request,
  { params }: RouteContext<"/api/web/[user]/trips/[trip]/days/[slug]/publish">,
) {
  if (request.headers.get("authorization")) {
    return Response.json(NOT_FOR_AGENTS, { status: 403 });
  }

  const { user, trip: tripId, slug } = await params;
  if (!getUser(user)) return Response.json({ error: "unknown_user" }, { status: 404 });
  if (!(await isOwner(user))) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  if (!readTripFile(user, tripId)) {
    return Response.json({ error: "unknown_trip" }, { status: 404 });
  }
  const stem = resolveDayStem(user, tripId, slug);
  const day = stem ? readDayFile(user, tripId, stem) : null;
  if (!stem || !day) {
    return Response.json({ error: "unknown_day" }, { status: 404 });
  }

  const parsed = shareBody.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return Response.json({ error: "invalid_request", message: "declineOpen must be a list of field names." }, { status: 400 });
  }
  const declineOpen = [...new Set(parsed.data.declineOpen ?? [])];
  const blank = new Set(missingAtPublish(day, getUser(user)?.locales ?? []).map((row) => row.field));
  const refused = declineOpen.filter(
    (field) => NOT_FROM_THE_STUDIO.has(field) || !(DAY_DECLINABLE_KEYS as readonly string[]).includes(field) || !blank.has(field),
  );
  if (refused.length > 0) {
    return Response.json(
      {
        error: "invalid_request",
        message:
          `Not left blank: ${refused.join(", ")}. Only a field this day has neither filled in nor ` +
          "answered, and that the studio may answer, can be recorded as left blank. Nothing was written.",
        refused,
      },
      { status: 400 },
    );
  }

  // A day saved too recently for the archive still carries `weather: true`
  // (asked, unanswered). Asked again now — capability-gated inside, every
  // failure swallowed, so it never stands between the owner and the share.
  if (day.weather === true && readDryRun(request) === false) {
    await fillDayWeatherQuietly(tripRef(user, tripId), stem);
  }

  const body = JSON.stringify(declineOpen.length > 0 ? { declineTracked: declineOpen } : {});
  return applyPublish(new Request(request.url, { method: "POST", body }), user, tripId, stem, SHARED_BLANK_REASON);
}
