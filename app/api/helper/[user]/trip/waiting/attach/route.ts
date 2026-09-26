import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { attachTripWaitingMedia } from "@/lib/studio/inbox";
import { readJsonBody } from "@/lib/api/jsonBody";

export const dynamic = "force-dynamic";

/**
 * Put a day-less trip photograph onto one of that trip's own days —
 * B2207. A photograph filed with a trip and a declined day
 * (`storeTripPhoto`, `lib/api/v2/media.ts`) sits under
 * `trips/<id>/media/`, referenced by no day, and so it never appeared on
 * the studio's own "waiting for a day" inbox — this is the door the studio
 * inbox page uses once it does.
 *
 * Owner cookie only, same as every route under `app/api/helper/`
 * (AGENTS.md: agent bearer tokens reach `/api/**`, never a rendered owner
 * page). `attachTripWaitingMedia` (lib/studio/inbox.ts) does the actual
 * work — it never re-uploads or moves the file, only writes the gallery
 * reference that stops treating it as unreferenced.
 *
 * **Body:** `{ "trip": string, "file": string, "slug": string }` — the
 * trip's own id, the filename exactly as it sits in `trips/<id>/media/`
 * (the same string the studio inbox page's own listing gave back), and the
 * day's slug within that trip.
 */
export async function POST(
  request: Request,
  { params }: RouteContext<"/api/helper/[user]/trip/waiting/attach">,
) {
  const { user } = await params;
  if (!(await isHelperOwner(user))) {
    return notYourJournal(request, user);
  }

  const jsonBody = await readJsonBody(request);
  if (!jsonBody.ok) return jsonBody.response;
  const body = (jsonBody.value) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "invalid_json" }, { status: 400 });

  const trip = typeof body.trip === "string" ? body.trip.trim() : "";
  const file = typeof body.file === "string" ? body.file.trim() : "";
  const slug = typeof body.slug === "string" ? body.slug.trim() : "";
  if (!trip || !file || !slug) {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }

  const result = attachTripWaitingMedia(user, trip, file, slug);
  if (!result.ok) {
    if (result.error === "unknown_trip" || result.error === "unknown_file") {
      return Response.json({ error: result.error }, { status: 404 });
    }
    if (result.error === "already_attached") {
      return Response.json({ error: result.error }, { status: 409 });
    }
    // `attachGallery`'s own errors — "no entry \"<slug>\" in this trip" among
    // them — are a sentence, not a code; the studio page shows a generic
    // failure rather than pretending to have a translation for prose.
    return Response.json({ error: "not_attached", message: result.error }, { status: 400 });
  }
  return Response.json({ ok: true, attached: result.attached });
}
