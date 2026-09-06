import fs from "node:fs";
import { contentTypeFor, resolveMediaFile, resizedCopy } from "@/lib/media";
import { parseWidth } from "@/lib/mediaSizes";
import { draftsVisibleTo, mayReadTrip, readerLevelFor } from "@/lib/tripGate";
import { getTrip } from "@/lib/trips";
import { AS_AUTHOR, getAllEntries, getEntryBySlug } from "@/lib/entries";
import { maySeePhoto, mediaKey, type PhotoVisibility } from "@/lib/photos";

/**
 * Serves trip media from the content folder.
 *
 * Media moved out of `public/` so that a trip is one self-contained directory
 * (see lib/media.ts). Serving it through a route rather than copying it back
 * into `public/` at build time is what makes per-trip and per-photo visibility
 * possible at all: this is the single place the permission checks go, and
 * since B596 there are three of them — the trip's own gate, the day's draft
 * state, and the photograph's own label.
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
  return getEntryBySlug(ref, daySlug, AS_AUTHOR)?.draft === true;
}

/**
 * The label on the photograph this request is for, if it has one — B596.
 *
 * Read from the gallery rather than from the path, because the label is a fact
 * about the picture and the path is only how it was asked for. Every entry in
 * the trip is searched rather than the day the folder names: the folder and
 * the day's slug agree by convention, and a convention is not a good enough
 * reason for a permission check to look in one place only. The parse is cached
 * per directory, so this is a walk over objects already in memory.
 *
 * A `poster` counts as the item it belongs to. A private clip's still frame is
 * a separate file with no label of its own, and it is a legible thumbnail of
 * the thing being held back.
 *
 * `undefined` for a file no gallery mentions — an original, a trip's cover, a
 * folder left behind by a deleted day. Those are the trip gate's business and
 * not this function's.
 *
 * **The comparison is deliberately looser than the filesystem's.** A path is
 * matched case-folded and NFC-normalised, because the question here is not
 * "are these the same string" but "could this request reach that file" — and
 * on a case-insensitive volume (APFS, which is every Mac this is developed on,
 * and some deployments) `03.JPG` opens `03.jpg` while a byte comparison says
 * they are different photographs. `resolveMediaFile` refuses `.`, `..` and
 * empty segments, so those spellings never get this far; case and Unicode
 * normalisation are the two that do.
 *
 * Loosening it can only ever find *more* labels, which is the safe direction:
 * a match that should not have happened refuses a file, and a match that is
 * missed serves a photograph somebody asked to hold back. Two files in one
 * folder differing only in case cannot both exist on the volumes this
 * matters for anyway.
 */
function pathKey(src: string): string {
  return mediaKey(src).normalize("NFC").toLowerCase();
}

function labelOf(ref: string, segments: string[]): PhotoVisibility | undefined {
  const wanted = pathKey(segments.join("/"));
  for (const entry of getAllEntries(ref, AS_AUTHOR)) {
    for (const item of entry.gallery) {
      if (!item.visibility) continue;
      if (pathKey(item.src) === wanted) return item.visibility;
      if (item.poster && pathKey(item.poster) === wanted) return item.visibility;
    }
  }
  return undefined;
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

  /**
   * And the photograph's own label, which the two gates above say nothing
   * about — B596, and the check the docblock at the top of this file has been
   * promising since media moved out of `public/`.
   *
   * It has to be here and not only in the read layer. `visible()` in
   * lib/entries.ts keeps a labelled picture out of every gallery, every day
   * page and every payload — and leaves the file itself one guessable URL
   * away, which for the one feature whose entire purpose is holding a
   * photograph back would not be a feature at all.
   *
   * 404, like every other refusal on this route: a 403 would confirm that
   * something is there.
   */
  const label = labelOf(trip.ref, segments);
  if (label && !maySeePhoto(label, await readerLevelFor(trip))) {
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
     *
     * **A labelled photograph is on the same footing, for a reason that is
     * not the same reason** — B596. Its bytes *are* identical for everybody
     * who may have them; what varies is whether the answer is 200 or 404. A
     * shared cache cannot see that distinction, so a long `public` age on the
     * one 200 would leave an intermediary holding a held-back photograph,
     * ready for the next person who asks for that URL.
     */
    "Cache-Control": draft || label
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
