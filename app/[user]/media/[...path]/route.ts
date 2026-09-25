import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { contentTypeFor, mediaDerivative, mediaEtag, resolveMedia, tripMediaDir } from "@/lib/media";
import { afterResponse } from "@/lib/afterResponse";
import { imageFactsFor, phashFor } from "@/lib/sidecar";
import { parseWidth } from "@/lib/mediaSizes";
import { parseRange } from "@/lib/mediaRange";
import { draftsVisibleTo, mayReadTrip, readerLevelFor } from "@/lib/tripGate";
import { getTrip } from "@/lib/trips";
import { AS_AUTHOR, entryForFolder, getAllEntries } from "@/lib/entries";
import type { Entry } from "@/lib/types";
import {
  loosestVisibility,
  maySeePhoto,
  mediaKey,
  strictestVisibility,
  type PhotoVisibility,
} from "@/lib/photos";

/**
 * Serves trip media from the content folder.
 *
 * Media moved out of `public/` so that a trip is one self-contained directory
 * (see lib/media.ts). Serving it through a route rather than copying it back
 * into `public/` at build time is what makes per-trip and per-photo visibility
 * possible at all: this is the single place the permission checks go, and
 * since B596 there are three of them — the trip's own gate, the day's draft
 * state, and the photograph's own label.
 *
 * B1863 adds a fourth question, and it is not about the reader at all: is
 * this even a photograph? All three checks above are answers about a gallery
 * item, and a file that is in no gallery — a sidecar, a stray — got the
 * day's answer instead, which for a published day is "anyone". So anything
 * whose extension is not a media type this route knows is refused outright.
 *
 * B1884 is the same question asked once more, of a file that *is* media: a
 * fifth check, or rather the removal of the fallback that stood in for one.
 * Nothing under this directory is served because a lookup failed to hold it
 * back; a file is served because a gallery item, a poster or the trip's cover
 * names it, and everything else is `private`. See `labelOf`.
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
 *
 * **The folder's name is asked of `entryForFolder`, not `getEntryBySlug`**
 * — B1884. A v1 folder is named for the day's slug and a v2 upload's folder
 * for the day's whole id, and matching only the first meant the lookup came
 * back empty for every v2 upload: a draft day's photographs were served as
 * though the day were published, because "no such day" and "no draft" were
 * the same answer here.
 */
function isDraftDay(entries: readonly Entry[], folder: string | undefined): boolean {
  return entryForFolder(entries, folder)?.draft === true;
}

/**
 * What this request has to satisfy, if anything — B596 for the photograph's
 * own label, B632 for the update it belongs to.
 *
 * Read from the gallery rather than from the path, because the label is a fact
 * about the picture and the path is only how it was asked for. Every entry in
 * the trip is searched rather than the day the folder names: the folder and
 * the day's slug agree by convention, and a convention is not a good enough
 * reason for a permission check to look in one place only.
 *
 * **The update's own `visibility` counts too, and missing that was a leak.**
 * B632 held an update back from the reading paths and stopped there: its
 * photographs carried no label of their own, so this route served them to
 * anybody who could guess `01.jpg` — the same half-a-feature B327 left behind
 * on this exact file, arriving by the same door. Within one update the
 * requirement is the *stricter* of the update's label and the picture's; a
 * `guest` photograph inside a `private` update stays private.
 *
 * **Across updates it is the looser**, which is the opposite rule and the
 * right one: the same file may appear in a public update and again in a
 * held-back one, and refusing it would break the page that is legitimately
 * showing it.
 *
 * A `poster` counts as the item it belongs to. A private clip's still frame is
 * a separate file with no label of its own, and it is a legible thumbnail of
 * the thing being held back.
 *
 * **A file nothing names is nobody's — B1884, and it is the fifth time this
 * function has been wrong about one.** It used to fall back to the update the
 * *folder* names, which asked a convention two writers spell differently (see
 * `isDraftDay`) and answered `undefined` — "anybody" — whenever the lookup
 * missed, which was every v2 upload folder. Teaching the lookup the second
 * spelling would fix that one; it would not fix the shape, which is that an
 * unrecognised file was served because a *lookup* failed rather than because
 * something said it could be.
 *
 * So the question is turned round. A file is served because something names
 * it — a gallery item, its poster, or the trip's own cover — and anything
 * else under a trip's media directory answers `private`: an orphan from
 * ingest, an original somebody copied in, a stray from a Finder, and whatever
 * the next writer leaves in there before anyone thinks about this route.
 *
 * `private` rather than an outright 404 because the people who were there are
 * exactly who such a file belongs to: the owner's own upload before a day
 * names it, and their own folder synced back. It is the strictest label there
 * is, so it is also `no-store` at every cache in between.
 *
 * The trip's cover is the one thing outside the gallery that names a file.
 * It need belong to no day (`daylessTripMediaSrcs`, lib/api/v2/media.ts, is
 * how one is chosen), and it is on the trip card for everybody the trip
 * already let in — so it is checked only after the gallery has had its say,
 * and a cover that is *also* a held-back day's photograph keeps that day's
 * answer rather than being widened by having been chosen.
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

function labelOf(
  entries: readonly Entry[],
  segments: string[],
  cover: string | undefined,
): PhotoVisibility | undefined {
  const wanted = pathKey(segments.join("/"));
  let matched = false;
  let demand: PhotoVisibility | undefined;

  for (const entry of entries) {
    for (const item of entry.gallery) {
      const hit = pathKey(item.src) === wanted || (item.poster && pathKey(item.poster) === wanted);
      if (!hit) continue;
      const here = strictestVisibility(entry.visibility, item.visibility);
      demand = matched ? loosestVisibility(demand, here) : here;
      matched = true;
    }
  }
  if (matched) return demand;

  // Nothing in any gallery mentions this file, so the trip's own cover is the
  // last thing that could name it — and if that does not either, nobody has
  // said this file may be served and the answer is the closed one.
  if (cover && pathKey(cover) === wanted) return undefined;
  return "private";
}

/**
 * Whether the validator a client sent back covers what we are about to serve
 * — B1730.
 *
 * `If-None-Match` is a list, each entry optionally weak, and `*` means "any
 * representation at all", which for a file that exists is a match. Weak
 * comparison is the right one for a conditional *read*: `W/"x"` and `"x"`
 * describe the same photograph even if a byte of metadata differs, and this
 * route never issues a weak tag anyway.
 *
 * **One thing deliberately not done: a `-gzip` suffix is not stripped.**
 * Caddy's `encode` appends one to the ETag of anything it compresses, and
 * B1729 is the damage that does to `If-Match`. Here it would be a different
 * and milder problem — a revalidation that misses and re-sends — and the
 * strip would be worse than the miss, because it would make a compressed and
 * an uncompressed body share one validator, which is the distinction the
 * suffix exists to draw. It does not arise today: `encode` compresses text
 * types and leaves image and video bodies alone. If that ever changes, the
 * fix is excluding this path from `encode` in `deploy/fernscout.caddy`, not
 * loosening the comparison here.
 */
function validatorCovers(header: string | null, etag: string): boolean {
  if (!header) return false;
  const sent = header.trim();
  if (sent === "*") return true;
  return sent.split(",").some((one) => one.trim().replace(/^W\//, "") === etag);
}

/** A cached copy up to this size is read in one go; a larger one streams. */
const WHOLE_READ_BYTES = 256 * 1024;

/** The requested slice, read on its own rather than by reading the file and
 * throwing most of it away — and off the request's thread, since a slice is
 * up to four megabytes of a clip somebody is scrubbing through. */
async function readSlice(file: string, start: number, end: number): Promise<Buffer> {
  const buffer = Buffer.alloc(end - start + 1);
  const handle = await fs.promises.open(file, "r");
  try {
    await handle.read(buffer, 0, buffer.byteLength, start);
  } finally {
    await handle.close();
  }
  return buffer;
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
   *
   * **The trip's entries are read once, here, for this gate and the label
   * gate below.** Each used to read them for itself — a directory listing and
   * a stat per entry file, twice over, for every thumbnail in every grid. One
   * read is also the more correct shape: the two answers now describe the
   * same state of the folder, where before an edit landing between them
   * could be seen by one gate and not the other. Nothing is remembered past
   * this request, so a publish or an unpublish is seen by the very next one.
   */
  const entries = getAllEntries(trip.ref, AS_AUTHOR);
  const draft = isDraftDay(entries, segments[1]);
  if (draft && !(await draftsVisibleTo(trip)).visible) {
    return new Response("Not found", { status: 404 });
  }

  /**
   * And the photograph's own label, which the two gates above say nothing
   * about — B596, and the check the docblock at the top of this file has been
   * promising since media moved out of `public/`.
   *
   * It has to be here and not only in the read layer. `visible()` in
   * lib/entries.ts keeps a labelled picture — and, since B632, a labelled
   * update entire — out of every gallery, every day page and every payload,
   * and leaves the files themselves one guessable URL away, which for the two
   * features whose entire purpose is holding something back would not be
   * features at all.
   *
   * 404, like every other refusal on this route: a 403 would confirm that
   * something is there.
   */
  const label = labelOf(entries, segments, trip.cover);
  if (label && !maySeePhoto(label, await readerLevelFor(trip))) {
    return new Response("Not found", { status: 404 });
  }

  // The stat `resolveMedia` takes is the one every later question about this
  // file is answered from — the `ETag`, the resize's cache key, the length.
  const found = resolveMedia(user, segments);
  if (!found) return new Response("Not found", { status: 404 });
  const { file, stat } = found;

  /**
   * And it has to be media — B1863.
   *
   * `contentTypeFor` answering `application/octet-stream` means "not a type
   * this route serves", and the honest answer to a request for such a file
   * is that this route has nothing at that address. The three gates above
   * are all about *photographs*: a file that is in no gallery carries no
   * label, so it fell through to the day's visibility — nothing, for a
   * published day — and the `.meta.json` sidecar beside every upload was
   * public even for a photograph the label check had just refused.
   *
   * Sidecars are written outside `media/` now (`tripSidecarPath`), which
   * closes it for anything written from here on. This is the half that
   * covers the thousands an existing journal already has sitting in there,
   * and every other stray file ingest or a Finder ever left behind. Before
   * the read, and 404 like every other refusal on this route.
   */
  if (contentTypeFor(file) === "application/octet-stream") {
    return new Response("Not found", { status: 404 });
  }

  /**
   * And measure it, once — B1955.
   *
   * `measureImage` (B1865) runs at upload, so every photograph uploaded before
   * it existed has no `image` block and never would: `imageFactsFor` was
   * written for exactly that case and had no production caller at all. The
   * backfill script fills a journal in one pass; this is what keeps the hole
   * closed afterwards, for a photograph restored from a backup, synced in, or
   * belonging to a journal nobody ran the script over.
   *
   * **Here rather than in `paid/photobook/lib/photobook/source.ts`**, which is where the
   * block is read. Measuring costs ~39 ms per photograph on this journal's
   * derivatives, and `buildBookSource` sees every picture in the trip at once
   * — three hundred of them is twelve seconds added to the preview request,
   * and the source and the planner are both deliberately synchronous
   * (`paid/photobook/lib/photobook/build.ts` says so), so the call could not go there without
   * making four scripts and the planner async for it. This route sees exactly
   * one photograph per request, the one somebody is looking at.
   *
   * **After the response**, so the reader waits for none of it, and through
   * `imageFactsFor`, so a photograph already measured costs one small read.
   * Above the `304` on purpose: a client holding a cached copy is still a
   * first use of a photograph nothing has measured.
   *
   * Only the three formats the backfill walks. `imageFactsFor` answers `null`
   * for anything that will not decode, but it answers it after a failed sharp
   * decode on every single request for that file, and an SVG placeholder is
   * served as often as a photograph.
   */
  if (/\.(jpe?g|png|webp)$/i.test(file)) {
    const relative = path.relative(tripMediaDir(trip.ref), file);
    afterResponse("image-facts", () => imageFactsFor(trip.ref, relative, file));
    // The same backfill, for the same reason, one field over — B1978. The
    // photobook de-duplicates a day's near-identical frames from this hash,
    // and every photograph uploaded before B1978 has none.
    afterResponse("image-phash", () => phashFor(trip.ref, relative, file));
  }

  // `?w=` — this route is its own image optimiser. See components/mediaLoader.
  // A width nobody can serve falls back to the file itself rather than
  // failing: a thumbnail slightly too large is a slow page, a 404 is a broken
  // one.
  const width = parseWidth(new URL(request.url).searchParams.get("w"));

  /**
   * How long a cache may hold this without asking again — and it is two
   * different answers for two different reasons. See the `Cache-Control`
   * note further down for the draft and label halves, which have not changed.
   *
   * **The published age went from an hour to a day in B1730**, and it could
   * only do that once there was a validator to be wrong against. Without an
   * `ETag` a stale entry can only be corrected by re-sending the photograph,
   * so a long age is a bet that nothing will ever change; with one, a cache
   * that guesses wrong pays for a 304 and a header, and the bet costs nothing
   * to lose. `stale-while-revalidate` is what actually needed it most — the
   * background revalidation it promises could not be a 304 before, so every
   * stale hit was a second full transfer of the same bytes.
   *
   * Not `immutable`, which would be a lie: the URL carries no content hash,
   * and a photograph replaced in place under the same name is a thing a
   * person can do with a text editor and `scp`.
   */
  const cacheControl =
    draft || label
      ? "private, no-store"
      : "public, max-age=86400, stale-while-revalidate=604800";

  /**
   * And the validator itself — B1730.
   *
   * **Above the resize on purpose.** A `304` is the one answer this route can
   * give without reading or encoding anything, and asking sharp for a
   * derivative we are about to not send would throw away most of what the
   * conditional request is worth. Below all three permission gates, equally
   * on purpose: a matching validator is not a reason to skip asking whether
   * this reader may have the file, and a `304` handed to somebody who should
   * get a `404` confirms the photograph exists.
   *
   * `width` rather than the width actually served: an unresizable file asked
   * for at `?w=320` is answered with the original, and keying the tag on what
   * was *asked* keeps one URL to one validator. The bytes behind two URLs
   * being identical costs a cache nothing — entries are per-URL either way.
   */
  const etag = mediaEtag(file, width, stat);
  if (etag && validatorCovers(request.headers.get("if-none-match"), etag)) {
    return new Response(null, {
      status: 304,
      headers: {
        ETag: etag,
        "Cache-Control": cacheControl,
        /**
         * The two headers a `304` does not strictly need, sent anyway.
         *
         * A cache is required to keep the stored response's fields and update
         * only those the `304` repeats, so the CSP and `nosniff` that came
         * with the original `200` survive on their own. This file has already
         * decided once that it would rather not depend on that kind of
         * agreement — the media CSP is declared here *and* in
         * `next.config.ts` precisely so neither can drift — and the same
         * reasoning applies to a response that stands in for one carrying it.
         * Two lines against ever having to reason about a cache's
         * header-merging again.
         */
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  }

  const sized = width ? await mediaDerivative(file, width, stat) : null;

  // Size without reading: a range request wants one window of a clip, and
  // reading 200 MB in order to hand back four of them is the cost B669 came
  // to remove. The whole file is still read for an ordinary 200 below.
  const size = sized ? sized.size : stat.size;
  const type = sized ? "image/webp" : contentTypeFor(file);

  const headers: Record<string, string> = {
    "Content-Type": type,
    "Content-Length": String(size),
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
    "Cache-Control": cacheControl,
    "X-Content-Type-Options": "nosniff",
    /**
     * B394: WebP is served here whatever `Accept` says — deliberately, since
     * it is near-universal and honouring the header would mean keeping a
     * JPEG derivative around too.
     *
     * **And so no `Vary: Accept`, which this route used to send.** `Vary`
     * says the bytes depend on a request header, and these do not: every
     * client gets the same WebP at a given `?w=` whatever it accepts. What
     * the false claim did cost was real — a shared cache keeps one entry per
     * distinct `Accept` string, and browsers, versions and the service worker
     * each send a different one, so a CDN held the same thumbnail several
     * times over and missed on most first asks. If this route ever does
     * negotiate a format, the header comes back in the same change.
     */
    /**
     * And the validator every one of the above is measured against — B1730.
     *
     * On the `no-store` responses too. It is true of them, a private cache
     * may still use it for a conditional read, and a validator that appeared
     * and disappeared depending on who was asking would be one more thing
     * varying by reader on a route that already has three.
     */
    ...(etag ? { ETag: etag } : {}),
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

  /**
   * And a clip can be scrubbed — B669.
   *
   * This route answered every request with the whole file and no
   * `Accept-Ranges`, which for a photograph is exactly right and for a video
   * is two faults. Dragging the scrubber past what has downloaded snaps back,
   * because the player has no way to ask for the part it wants; and Safari,
   * which is most of the phones this is read on, will not begin playing a
   * `video/mp4` served without a `206` at all.
   *
   * Below the gates on purpose: a range is a question about a file this
   * reader has already been allowed to have. A resized copy is exempt — it is
   * a small WebP this route made, and there is nothing to seek in it.
   */
  if (sized) {
    /**
     * A copy already on disk is read from the handle `mediaDerivative`
     * opened, off the request's thread — it used to be `readFileSync`'d, which
     * blocked every other request on this process for each thumbnail in
     * every grid. One just made is in memory already and is sent as it is.
     *
     * A thumbnail is one read of a known length; a stream costs a second
     * read to find the end and a conversion to a web stream, which measured
     * slower for the few tens of kilobytes a grid tile is. Past
     * `WHOLE_READ_BYTES` — a 2000px copy of a busy photograph can approach a
     * megabyte — it is streamed, so a burst of those is never all in memory
     * at once.
     */
    if ("bytes" in sized) return new Response(new Uint8Array(sized.bytes), { headers });
    const { handle } = sized;
    if (sized.size <= WHOLE_READ_BYTES) {
      try {
        const buffer = new Uint8Array(sized.size);
        const { bytesRead } = await handle.read(buffer, 0, sized.size, 0);
        return new Response(buffer.subarray(0, bytesRead), {
          headers: { ...headers, "Content-Length": String(bytesRead) },
        });
      } finally {
        await handle.close().catch(() => {});
      }
    }
    return new Response(Readable.toWeb(handle.createReadStream()) as ReadableStream<Uint8Array>, { headers });
  }

  headers["Accept-Ranges"] = "bytes";
  const range = parseRange(request.headers.get("range"), size);
  if (range === "invalid") {
    return new Response("Range not satisfiable", {
      status: 416,
      headers: { ...headers, "Content-Range": `bytes */${size}` },
    });
  }
  if (range) {
    const slice = await readSlice(file, range.start, range.end);
    return new Response(new Uint8Array(slice), {
      status: 206,
      headers: {
        ...headers,
        "Content-Length": String(slice.byteLength),
        "Content-Range": `bytes ${range.start}-${range.end}/${size}`,
      },
    });
  }

  /**
   * Streamed, not read — B1730.
   *
   * This was `fs.readFileSync`, which for a photograph nobody notices and for
   * a clip is the whole file in memory before a byte goes out. `media/` takes
   * video (`contentTypeFor` maps mp4, webm and mov, and B669 added the range
   * support above precisely because clips are served here) and the upload
   * ceiling is 512 MiB, so one request from a client that does not ask for a
   * range — `curl`, a crawler, a `<video>` preload in a browser that does not
   * range-request — was one allocation of the whole file. `Content-Length` is
   * already known from the stat above, so nothing is lost by not holding it.
   *
   * The `206` is a bounded slice the client asked for and not worth a
   * stream; the resized copy above streams too once it is large enough to
   * be worth one.
   */
  const body = Readable.toWeb(fs.createReadStream(file)) as ReadableStream<Uint8Array>;
  return new Response(body, { headers });
}
