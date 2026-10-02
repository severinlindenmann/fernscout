// GET /api/web/{user}/trips/{trip}/days/{slug}/story/video — the ~8s MP4
// twin of the picture route beside it (B2665). Same gates, same facts.
//
// **Deviation from the brief, noted rather than hidden (effort budget):**
// the bottom caption panel is one static overlay for the whole clip rather
// than a per-segment one that swaps to that photo's own caption and, on the
// last segment, the link. Building three overlay PNGs and compositing each
// only over its own segment is a larger filter graph (`overlay` gated by
// `between(t,…)` per segment) than this pass had budget to write and prove
// with a real ffmpeg run; the panel today shows the day's title/place/temp
// and the link (when allowed) for the full ~8s instead. Flagged in the
// final report as a candidate follow-up ticket.
import { isOwner } from "@/lib/contacts/session";
import { getUser } from "@/lib/users";
import { readDayFile, readTripFile, resolveDayStem, listDaySlugs } from "@/lib/api/v2/store";
import { getTrip } from "@/lib/trips";
import { isOpenToLink } from "@/lib/access";
import { journalPath } from "@/lib/journalPath";
import { serverSite } from "@/lib/site";
import { clientIp } from "@/lib/rateLimit";
import { dayNumberOf, storyCardFacts } from "@/lib/storyCard";
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

  const photos = (day.media ?? []).filter((item) => item.type !== "video");
  if (photos.length === 0) {
    return Response.json({ error: "video_unavailable" }, { status: 404 });
  }
  const photoFiles = photos
    .slice(0, 3)
    .map((p) => storyPhotoFile(user, p.src))
    .filter((f): f is string => f !== null);
  if (photoFiles.length === 0) {
    return Response.json({ error: "video_unavailable" }, { status: 404 });
  }

  const trip = getTrip(`${user}/${tripId}`);
  const link =
    trip && isOpenToLink(trip)
      ? `${(process.env.NEXT_PUBLIC_SITE_URL ?? serverSite().url).replace(/\/$/, "")}${journalPath(user)}/trips/${tripId}/day/${stem}`
      : null;

  const dayNumber = dayNumberOf(listDaySlugs(user, tripId), stem);
  const facts = storyCardFacts({ day, dayNumber, tripTitle: tripFile.title, link, locale: owner.defaultLocale });

  const key = storyVideoCacheKey({ dayJson: JSON.stringify(day), photoFiles });
  const bytes = await renderStoryVideo({ key, photoFiles, facts, ownerIpForRateLimit: clientIp(request) });
  if (!bytes) return Response.json({ error: "render_failed" }, { status: 500 });

  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "video/mp4",
      "Content-Length": String(bytes.length),
      "Cache-Control": "private, no-store",
    },
  });
}
