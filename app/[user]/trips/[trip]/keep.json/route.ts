import fs from "node:fs";
import { mayReadTrip, mayViewCosts, readFor } from "@/lib/tripGate";
import { getDays } from "@/lib/entries";
import { isVideoSrc, resolveMediaFile } from "@/lib/media";
import { currentTripRef, getTrip, mediaWithOwner, tripRef } from "@/lib/trips";
import { userExists } from "@/lib/users";

export const dynamic = "force-dynamic";

/** `story.json`'s own window size; the manifest lists the same windows. */
const WINDOW = 24;
/** The widths the pages ask for: the grid and the day at phone width, and
 *  the open photograph. Anything else the media route resizes on demand. */
const WIDTHS = [640, 1200] as const;

/**
 * `/<user>/trips/<trip>/keep.json` — everything a reader needs to read this
 * trip with no signal, for the service worker to fetch ahead — B2158 (W43).
 *
 * The same gate as `story.json` and the pages: `mayReadTrip`, then
 * `readFor` for which days (drafts) and `mayViewCosts`. What it lists is
 * addresses, never bytes: the pages, the story windows, every served
 * photograph the listed days and the gallery reference at the two widths
 * the pages use, and each clip's poster. **Never an original** — the media
 * route does not serve one to a reader anyway. Photographs a reader may not
 * see are simply not listed, because `getDays` under `readFor` already
 * withholds them (B596).
 *
 * `bytes` is an estimate from the stored derivatives on disk — the resized
 * copies are made on demand and are smaller — so the control can say
 * "about 84 MB" before keeping, and refuse past the ceiling with a number.
 */
export async function GET(request: Request, { params }: RouteContext<"/[user]/trips/[trip]/keep.json">) {
  const { user, trip: tripId } = await params;
  if (!userExists(user)) return new Response("Not found", { status: 404 });
  const ref = tripRef(user, tripId);
  const trip = getTrip(ref);
  if (!trip) return new Response("Not found", { status: 404 });
  if (!(await mayReadTrip(trip))) return new Response("Forbidden", { status: 403 });

  const { read } = await readFor(trip, request);
  const days = getDays(ref, read);
  const base = `/${encodeURIComponent(user)}`;
  // The current trip lives at the bare URLs; every other trip under
  // `/trips/<id>`. Listing the long form for the current trip would list
  // six redirects, which a cache cannot keep.
  const tripBase = currentTripRef(user) === ref ? base : `${base}/trips/${encodeURIComponent(tripId)}`;

  const pages = [tripBase, `${tripBase}/map`, `${tripBase}/gallery`];
  const data: string[] = [];
  for (let from = 0; from < Math.max(days.length, 1); from += WINDOW) {
    data.push(`${base}/story.json?trip=${encodeURIComponent(`${user}/${tripId}`)}&from=${from}&to=${from + WINDOW}`);
  }

  // Served URLs, `/<user>/media/<trip>/…` — what `getDays` already hands
  // the pages (`mediaWithOwner`), so the address kept is the address asked.
  const urls = new Set<string>();
  for (const day of days) {
    for (const entry of day.entries) {
      pages.push(`${tripBase}/day/${encodeURIComponent(entry.slug)}`);
      for (const item of entry.gallery ?? []) {
        urls.add(item.src);
        if (item.poster) urls.add(item.poster);
      }
    }
  }
  if (trip.cover) urls.add(mediaWithOwner(trip.cover, user));

  const media: string[] = [];
  let bytes = 0;
  const prefix = `${base}/media/`;
  for (const url of urls) {
    // A clip is served as it is (one address); a photograph at the widths
    // the pages ask for.
    if (isVideoSrc(url)) media.push(url);
    else for (const w of WIDTHS) media.push(`${url}?w=${w}`);
    // The same resolution the media route uses, so a stored path that the
    // route would refuse counts nothing here either.
    const file = url.startsWith(prefix) ? resolveMediaFile(user, url.slice(prefix.length).split("/")) : null;
    if (file) {
      try {
        bytes += fs.statSync(file).size;
      } catch {
        // A reference to a file that is gone lists nothing and counts nothing.
      }
    }
  }

  return new Response(
    JSON.stringify({
      user,
      trip: tripId,
      title: trip.title,
      build: process.env.GIT_SHA ?? null,
      pages,
      data,
      media,
      counts: { days: days.length, media: urls.size },
      bytes,
      costs: await mayViewCosts(trip),
    }),
    {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        // Per reader, like story.json: which days and which photographs are
        // listed depends on the cookie.
        "Cache-Control": "private, no-store",
        Vary: "Cookie",
      },
    },
  );
}
