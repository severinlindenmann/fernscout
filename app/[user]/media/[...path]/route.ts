import fs from "node:fs";
import { contentTypeFor, resolveMediaFile, resizedCopy } from "@/lib/media";
import { parseWidth } from "@/lib/mediaSizes";
import { mayReadTrip } from "@/lib/tripGate";
import { getTrip } from "@/lib/trips";
import { getEntryBySlug } from "@/lib/entries";
import { isOwner } from "@/lib/contacts/session";

/**
 * Serves trip media from the content folder.
 *
 * Media moved out of `public/` so that a trip is one self-contained directory
 * (see lib/media.ts). Serving it through a route rather than copying it back
 * into `public/` at build time is also what makes per-trip and per-photo
 * visibility possible later: this is the single place a permission check will
 * go.
 */
/**
 * Whether this folder belongs to a day nobody has published, seen by somebody
 * who is not its author.
 *
 * A folder matching no entry at all is left alone: ingest writes media before
 * the words exist, and an orphan is already referenced by nothing. Only a slug
 * that *is* an entry, and that entry a draft, is withheld.
 */
async function isDraftDay(
  ref: string,
  daySlug: string | undefined,
  username: string,
): Promise<boolean> {
  if (!daySlug) return false;
  const entry = getEntryBySlug(ref, daySlug, { includeDrafts: true });
  if (!entry?.draft) return false;
  return !(await isOwner(username));
}

export async function GET(
  request: Request,
  { params }: RouteContext<"/[user]/media/[...path]">,
) {
  const { user, path: segments } = await params;

  // Photographs are the most private thing here. A restricted trip's media must
  // not be fetchable by guessing a path, so the gate runs before the file is
  // even resolved — and a refusal is a 404, which tells a prober nothing.
  const trip = getTrip(`${user}/${segments[0] ?? ""}`);
  if (!trip || !(await mayReadTrip(trip))) {
    return new Response("Not found", { status: 404 });
  }

  // And the day's own state, which the trip gate above says nothing about.
  // A photograph uploaded to a draft used to be public the moment it landed:
  // the entry's text stayed hidden and its pictures did not, which is half of
  // the one rule this project has. Served to the owner, because reviewing a
  // draft means looking at what an agent attached to it.
  if (await isDraftDay(trip.ref, segments[1], user)) {
    return new Response("Not found", { status: 404 });
  }

  const file = resolveMediaFile(user, segments);
  if (!file) return new Response("Not found", { status: 404 });

  // `?w=` — this route is its own image optimiser. See components/mediaLoader.
  // A width nobody can serve falls back to the file itself rather than
  // failing: a thumbnail slightly too large is a slow page, a 404 is a broken
  // one.
  const width = parseWidth(new URL(request.url).searchParams.get("w"));
  const sized = width ? await resizedCopy(file, width) : null;

  const body = sized ?? fs.readFileSync(file);
  const type = sized ? "image/webp" : contentTypeFor(file);

  const headers: Record<string, string> = {
    "Content-Type": type,
    "Content-Length": String(body.byteLength),
    // Content is immutable in practice: a changed photo gets a new filename
    // through the ingest pipeline rather than being overwritten in place.
    "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
    "X-Content-Type-Options": "nosniff",
    /**
     * Nothing served out of a content folder is a document. B02.
     *
     * `default-src 'none'` leaves an SVG nothing to fetch and `sandbox` puts
     * it in an opaque origin, so a file navigated to directly is no longer
     * same-site with the guest cookie. Neither affects an `<img>`: a CSP on an
     * image response governs the image only when a browser treats it as a
     * document, which is exactly the case being closed.
     *
     * `next.config.ts` declares the same policy for this path. Both, on
     * purpose — the config rule is a path pattern that has to stay in step
     * with the route tree, and this one cannot drift from the response it is
     * attached to.
     */
    "Content-Security-Policy": "default-src 'none'; sandbox",
  };

  /**
   * And SVG specifically is never opened, only downloaded.
   *
   * `dangerouslyAllowSVG` is on for `next/image` because the example content's
   * placeholders are SVG, and this is the matching admission on the route that
   * actually serves them. `attachment` is ignored for a subresource load, so
   * the placeholders keep rendering; what it changes is a browser that
   * *navigates* to the file, which is the only way an SVG's script ever runs.
   * Belt to the sandbox's braces, and the cheaper of the two to reason about.
   */
  if (type === "image/svg+xml") headers["Content-Disposition"] = "attachment";

  return new Response(new Uint8Array(body), { headers });
}
