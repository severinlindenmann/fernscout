// GET /api/web/{user}/trips/{trip}/days/{slug}/story/video — the ~8s MP4
// twin of the picture route beside it (B2665). Same gates, same facts.
//
// The bottom panel stays for the whole clip; its last line follows the
// photo on screen — that photo's own caption — and on the last photo it
// carries the link when the day may have one (`storyDayLink`).
import { isOwner } from "@/lib/contacts/session";
import { getUser } from "@/lib/users";
import { readDayFile, readTripFile, resolveDayStem, listDaySlugs } from "@/lib/api/v2/store";
import { getTrip } from "@/lib/trips";
import { journalPath } from "@/lib/journalPath";
import { dayNumberOf, storyCardFacts, storyDayLink, storyPhotos } from "@/lib/storyCard";
import { storyPhotoFile } from "@/lib/storyMedia";
import { renderStoryVideo, storyVideoCacheKey, videoToolsAvailable } from "@/lib/storyVideo";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: RouteContext<"/api/web/[user]/trips/[trip]/days/[slug]/story/video">,
) {
  if (request.headers.get("authorization")) {
    return Response.json(
      { error: "not_for_agents", message: "This is the owner's own door, from a browser." },
      { status: 403 },
    );
  }

  const { user, trip: tripId, slug } = await params;
  const owner = getUser(user);
  if (!owner) return Response.json({ error: "unknown_user" }, { status: 404 });
  if (!(await isOwner(user))) return Response.json({ error: "forbidden" }, { status: 403 });

  if (!(await videoToolsAvailable())) {
    return Response.json({ error: "video_unavailable" }, { status: 404 });
  }

  const tripFile = readTripFile(user, tripId);
  if (!tripFile) return Response.json({ error: "unknown_trip" }, { status: 404 });

  const stem = resolveDayStem(user, tripId, slug);
  const day = stem ? readDayFile(user, tripId, stem) : null;
  if (!stem || !day) return Response.json({ error: "unknown_day" }, { status: 404 });
  if (day.status !== "published") return Response.json({ error: "not_published" }, { status: 409 });

  const photos = storyPhotos(day);
  if (photos.length === 0) {
    return Response.json({ error: "video_unavailable" }, { status: 404 });
  }
  const segments = photos
    .slice(0, 3)
    .map((p) => ({ file: storyPhotoFile(user, p.src), caption: p.caption }))
    .filter((s): s is { file: string; caption: string | undefined } => s.file !== null);
  if (segments.length === 0) {
    return Response.json({ error: "video_unavailable" }, { status: 404 });
  }

  const trip = getTrip(`${user}/${tripId}`);
  const link = storyDayLink(user, tripId, stem, trip, day);

  const dayNumber = dayNumberOf(listDaySlugs(user, tripId), stem);
  const facts = storyCardFacts({ day, dayNumber, tripTitle: tripFile.title, link, locale: owner.defaultLocale });

  const key = storyVideoCacheKey({ dayJson: JSON.stringify({ day, link }), photoFiles: segments.map((s) => s.file) });
  const bytes = await renderStoryVideo({ key, segments, facts, rateLimitKey: user });
  if (bytes === "rate_limited") return Response.json({ error: "rate_limited" }, { status: 429 });
  if (!bytes) return Response.json({ error: "render_failed" }, { status: 500 });

  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(bytes.length),
      "Cache-Control": "private, no-store",
    },
  });
}
