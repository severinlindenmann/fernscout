// GET /api/web/{user}/trips/{trip}/days/{slug}/story/video — the ~8s MP4
// twin of the picture route beside it (B2665). Same gates, same facts.
//
// The bottom panel stays for the whole clip; its last line follows the
// photo on screen — that photo's own caption — and on the last photo it
// carries the link when the day may have one (`storyDayLink`).
import { isOwner } from "@/lib/contacts/session";
import { getUser } from "@/lib/users";
import { readDayFile, readTripFile, resolveDayStem } from "@/lib/api/v2/store";
import { getTrip } from "@/lib/trips";
import { journalPath } from "@/lib/journalPath";
import { dayOfTrip } from "@/lib/studio/monthGrid";
import { storyCardFacts, storyPhotos, storyShareLink } from "@/lib/storyCard";
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

  const url = new URL(request.url);
  const showCaptions = url.searchParams.get("captions") === "1";
  const wantLink = url.searchParams.get("link") !== "0";
  const wantReadAlong = url.searchParams.get("readalong") === "1";

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
  const { url: link, readAlong } = wantLink
    ? await storyShareLink(user, tripId, stem, trip, day, wantReadAlong)
    : { url: null, readAlong: false };

  const dayNumber = dayOfTrip(day.date, tripFile.dates.from);
  const facts = storyCardFacts({ day, dayNumber, tripTitle: tripFile.title, link, readAlong, locale: owner.defaultLocale });

  const key = storyVideoCacheKey({
    dayJson: JSON.stringify({ day }),
    photoFiles: segments.map((s) => s.file),
    tripTitle: tripFile.title,
    locale: owner.defaultLocale,
    link,
    readAlong,
    captions: showCaptions,
  });
  const bytes = await renderStoryVideo({ key, segments, facts, rateLimitKey: user, showCaptions });
  if (bytes === "rate_limited") return Response.json({ error: "rate_limited" }, { status: 429 });
  if (!bytes) return Response.json({ error: "render_failed" }, { status: 500 });

  return videoRangeResponse(request, bytes);
}

/**
 * Answers the byte range Safari asks for before it will even start playing
 * a clip (B2665 round 2) — `a-b`, `a-` and the suffix form `-n`. An
 * unsatisfiable range answers 416 with the total size rather than guessing;
 * no (or an invalid) range still answers the whole clip, with
 * `Accept-Ranges` so the player knows it may ask for one next time. Every
 * auth/gate check above has already run before a single byte is read here.
 */
function videoRangeResponse(request: Request, bytes: Buffer): Response {
  const total = bytes.length;
  const baseHeaders = {
    "Content-Type": "video/mp4",
    "Cache-Control": "private, no-store",
    "Accept-Ranges": "bytes",
  };

  const header = request.headers.get("range");
  if (!header) {
    return new Response(new Uint8Array(bytes), {
      headers: { ...baseHeaders, "Content-Length": String(total) },
    });
  }

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match || (match[1] === "" && match[2] === "")) {
    return new Response(new Uint8Array(bytes), {
      headers: { ...baseHeaders, "Content-Length": String(total) },
    });
  }

  let start: number;
  let end: number;
  if (match[1] === "") {
    // Suffix form, "bytes=-n": the last n bytes.
    const suffixLength = Number(match[2]);
    start = Math.max(total - suffixLength, 0);
    end = total - 1;
  } else {
    start = Number(match[1]);
    end = match[2] === "" ? total - 1 : Number(match[2]);
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= total || start < 0) {
    return new Response(null, {
      status: 416,
      headers: { ...baseHeaders, "Content-Range": `bytes */${total}` },
    });
  }
  end = Math.min(end, total - 1);

  const slice = bytes.subarray(start, end + 1);
  return new Response(new Uint8Array(slice), {
    status: 206,
    headers: {
      ...baseHeaders,
      "Content-Length": String(slice.length),
      "Content-Range": `bytes ${start}-${end}/${total}`,
    },
  });
}
