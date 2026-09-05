import fs from "node:fs";
import { contentTypeFor, resolveMediaFile, resizedCopy } from "@/lib/media";
import { parseWidth } from "@/lib/mediaSizes";
import { draftsVisibleTo, mayReadTrip } from "@/lib/tripGate";
import { getTrip } from "@/lib/trips";
import { getEntryBySlug } from "@/lib/entries";

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
 * Whether this folder belongs to a day nobody has published.
 *
 * A folder matching no entry at all is left alone: ingest writes media before
 * the words exist, and an orphan is already referenced by nothing. Only a slug
 * that *is* an entry, and that entry a draft, is a draft folder.
 *
 * Says nothing about who is asking — that is the caller's second question, and
 * keeping the two apart is what B327 got wrong here. This used to end in
 * `!(await isOwner(username))`, which made "is it a draft" and "may you see
 * it" one answer and the second of them the wrong one.
 */
function isDraftDay(ref: string, daySlug: string | undefined): boolean {
  if (!daySlug) return false;
  return getEntryBySlug(ref, daySlug, { includeDrafts: true })?.draft === true;
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

  /**
   * And the day's own state, which the trip gate above says nothing about.
   *
   * A photograph uploaded to a draft used to be public the moment it landed:
   * the entry's text stayed hidden and its pictures did not, which is half of
   * the one rule this project has.
   *
   * **Who may see it is `draftsVisibleTo`, and this was the tenth reading path
   * — B327 changed nine and missed this one.** It is not a `page.tsx`, so the
   * structural test that was supposed to catch exactly this walked past it.
   * The result was a buddy who could open the draft day, read every word, and
   * get a 404 for each of its photographs: the failure the ticket set out to
   * remove, on the one surface that still had it.
   */
  const draft = isDraftDay(trip.ref, segments[1]);
  if (draft && !(await draftsVisibleTo(trip)).visible) {
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
    /**
     * Content is immutable in practice: a changed photo gets a new filename
     * through the ingest pipeline rather than being overwritten in place.
     *
     * **Except for a draft's photographs, which no cache may keep.** `public`
     * invites any intermediary to store the response and hand it to the next
     * person who asks for that URL — and this is the one response here whose
     * body depends on who asked. It was already wrong before B327, when the
     * only 200 was the owner's; letting somebody on the trip through widens
     * the set of unpublished photographs a shared cache could be holding, so
     * it is fixed here rather than captured. A published photograph is the
     * same bytes for everybody and keeps the long cache it has always had.
     */
    "Cache-Control": draft
      ? "private, no-store"
      : "public, max-age=3600, stale-while-revalidate=86400",
    "X-Content-Type-Options": "nosniff",
    /**
     * B394: WebP is served here whatever `Accept` says — deliberately, since
     * it is near-universal and honouring the header would mean keeping a
     * JPEG derivative around too. `Vary: Accept` is the other half: without
     * it a shared cache cannot tell that the bytes depend on the header, so a
     * client that only takes JPEG could be handed a cached WebP response.
     * Declaring it now is what keeps content negotiation possible later
     * without a cache full of mislabelled entries to invalidate first.
     */
    Vary: "Accept",
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
