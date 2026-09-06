import { authenticate, errorResponse, mayWriteTrip, outOfScope, ownsUser, refuseWrite } from "@/lib/api/auth";
import { attachGallery, isPublished } from "@/lib/api/entries";
import { storeUploads, type KeptOriginal, type UploadCandidate } from "@/lib/api/media";
import { getTrip, mediaWithOwner, tripRef } from "@/lib/trips";
import { fetchImage } from "@/lib/api/fetchMedia";
import { getUser } from "@/lib/users";
import {
  IMAGE_MAX_BYTES,
  MAX_ITEMS_PER_DAY,
  REQUEST_MAX_BYTES,
  captionsFor,
} from "@/lib/validate/media";
import type { GalleryItem } from "@/lib/types";

export const dynamic = "force-dynamic";

/** Same shape the media validator prints, so a size in a refusal here reads
 *  like a size in a refusal there. */
function megabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * `storeUploads` hands back trip-relative `src`/`poster` values, on purpose —
 * `attachGallery` below writes them straight into the entry's frontmatter,
 * and that file has to stay portable across owners (see `frontmatterSrc` and
 * `mediaWithOwner` in lib/trips.ts). But this response is not the frontmatter;
 * it is what an agent reads to correct a caption **keyed by `src`**, and the
 * day it reads back next has the username on the front. Handing back the
 * trip-relative form here was a key nothing else in the API ever answers
 * with — B540. So the frontmatter write below gets the items as they came
 * back from `storeUploads`, and only the JSON response gets this applied.
 */
function withOwner(items: GalleryItem[], user: string): GalleryItem[] {
  return items.map((item) => ({
    ...item,
    src: mediaWithOwner(item.src, user),
    poster: item.poster ? mediaWithOwner(item.poster, user) : undefined,
  }));
}

/**
 * `POST /api/v1/<user>/trips/<trip>/media` — put photographs on a day.
 *
 * Until this existed the only way media reached a journal was `npm run
 * ingest`, reading a folder on the same machine — so an agent working over
 * the network could write the words and nothing else.
 *
 * It writes the files **and puts them in the day**. It used to do only the
 * first and hand back a `gallery:` block to paste into the entry, which no
 * call could do: a day has no PATCH. Days written before their photographs
 * read back with an empty gallery and stayed that way. The block still comes
 * back in `items`, now as a record of what was attached rather than as
 * homework.
 *
 * The original of every file is kept; see lib/api/media.ts for why.
 */
/**
 * The one way a `day` can be wrong, answered before anything is read.
 *
 * `day` was always required — `storeUploads` refuses a slug that names no
 * entry — but it used only to decide a folder name. Now that it decides which
 * file gets edited, saying so up front is worth the six lines: a request with
 * no day is one that would write photographs attached to nothing.
 *
 * A published day is no longer refused here — see B393. `PATCH` on the day
 * route already lets a published day's prose be corrected, on the same
 * reasoning: say plainly that readers will see the change, and let the owner
 * decide, rather than refuse and point at a door that does not exist.
 */
function dayProblem(day: string): Response | null {
  if (!day) {
    return Response.json(
      {
        error: "missing_day",
        message:
          'Send "day": "<slug>" — the day these photographs belong to. It has to exist ' +
          "already: write the day first, then send its pictures, and they are added to it.",
      },
      { status: 400 },
    );
  }
  return null;
}

/**
 * The 201 for a batch that landed, whether or not it reached the entry.
 *
 * Attaching can only fail if the entry has no frontmatter to splice into — a
 * file somebody wrote by hand in a shape this will not guess at. The files are
 * already on disk by then, so the honest answer is the success it is, plus
 * `attached: false` and the block to add by hand.
 */
function stored(
  ref: string,
  day: string,
  items: GalleryItem[],
  kept: KeptOriginal[],
  attached: boolean,
  error?: string,
) {
  const published = isPublished(ref, day);
  const attachedNote = attached
    ? `Added to "${day}". Nothing to paste — read the day back to see it. ` +
      `\`kept\` is what was stored untouched for print; \`items\` is the resized copy the ` +
      `site serves.`
    : `${error} The originals in \`kept\` are stored either way.`;
  return Response.json(
    {
      ok: true,
      day,
      items,
      /**
       * What was kept, beside what is served.
       *
       * `items` are the derivatives, and their `width`/`height` are the served
       * copy's — so an agent that sent 3000px and read 2000px back had no way
       * to tell that the original survived, on a route whose documentation
       * promises a photobook is printed from it. Now it can compare the two.
       */
      kept,
      attached,
      // Same honesty PATCH gives a prose edit to a published day (B266): say
      // plainly that readers already see it, rather than let a 201 imply the
      // change is still private. See B393.
      note: published
        ? `${attachedNote} Still published — anyone who already read it can now see this change.`
        : attachedNote,
    },
    { status: 201 },
  );
}

export async function POST(
  request: Request,
  { params }: RouteContext<"/api/v1/[user]/trips/[trip]/media">,
) {
  const auth = await authenticate(request);
  if (!auth.ok) return errorResponse(auth);

  const { user, trip } = await params;
  if (!ownsUser(auth.session, user)) {
    return outOfScope(auth.session, user);
  }

  const ref = tripRef(user, trip);
  const found = getTrip(ref);
  // Same answer whether the trip is missing or simply not this token's — see
  // the days route.
  if (!found) return Response.json({ error: "unknown_trip" }, { status: 404 });
  const gate = await mayWriteTrip(auth.session, found);
  if (!gate.ok) return refuseWrite(gate);

  // Two ways in. JSON carries a list of URLs for this server to fetch;
  // multipart carries the bytes. The first is the convenient one and the one
  // that has to be careful — see lib/api/fetchMedia.ts.
  if ((request.headers.get("content-type") ?? "").includes("application/json")) {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const day = typeof body?.day === "string" ? body.day.trim() : "";
    const wrongDay = dayProblem(day);
    if (wrongDay) return wrongDay;

    const urls = Array.isArray(body?.urls) ? body.urls.filter((u): u is string => typeof u === "string") : [];
    if (urls.length === 0) {
      return Response.json(
        { error: "expected_urls", hint: 'Send {"day": "...", "urls": ["https://…"]}, or multipart bytes.' },
        { status: 400 },
      );
    }

    const captions = captionsFor(body?.captions, urls.length);
    if (!captions.ok) {
      return Response.json({ error: "invalid_media", problems: [captions.problem] }, { status: 400 });
    }

    const limits = getUser(user)!.media;
    const fetched: UploadCandidate[] = [];
    const failures: { url: string; reason: string }[] = [];
    for (const [at, url] of urls.slice(0, limits.itemsPerDay).entries()) {
      const got = await fetchImage(url, limits.imageBytes);
      if (got.ok) fetched.push({ ...got.media, caption: captions.captions[at] });
      else failures.push(got.problem);
    }
    // All or nothing: a half-imported day is the state that is annoying to
    // clean up by hand, and the agent can see exactly which URL was the
    // problem and retry the lot.
    if (failures.length > 0) {
      return Response.json({ error: "could_not_fetch", failures }, { status: 400 });
    }

    const written = await storeUploads(ref, day, fetched);
    if (!written.ok) {
      return Response.json({ error: "invalid_media", problems: written.problems }, { status: 400 });
    }
    const attached = attachGallery(ref, day, written.items);
    return stored(
      ref,
      day,
      withOwner(written.items, user),
      written.kept,
      attached.ok,
      attached.ok ? undefined : attached.error,
    );
  }

  /**
   * Too big, said as too big — B523.
   *
   * Read before the body is touched, because by the time `formData()` runs the
   * body has already been silently truncated to `REQUEST_MAX_BYTES` (see that
   * constant: Next buffers a proxied request and cuts rather than refuses).
   * The parse then fails and the honest-looking answer is
   * `expected_multipart`, which names a malformed Content-Type and sends the
   * caller to inspect its own request. One real import spent three wrong
   * hypotheses and fifteen uploads on that.
   *
   * `Content-Length` is what a multipart upload always carries. A chunked
   * request has none, and falls through to the hint below, which now names
   * this cap as the other thing that can be wrong.
   */
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > REQUEST_MAX_BYTES) {
    return Response.json(
      {
        error: "body_too_large",
        problems: [
          {
            field: "body",
            got: `${megabytes(declared)} in one request`,
            expected: `at most ${megabytes(REQUEST_MAX_BYTES)}`,
          },
        ],
        message:
          `This is the whole request, not one file: a photograph may be ` +
          `${megabytes(IMAGE_MAX_BYTES)} and up to ${MAX_ITEMS_PER_DAY} may go in one call, ` +
          `but together they have to fit in ${megabytes(REQUEST_MAX_BYTES)}. Send fewer files ` +
          `per request — a day can be filled by several calls, and each one appends. A single ` +
          `file larger than that cannot come through this door at all; \`npm run ingest\`, ` +
          `which reads a folder on the same machine, has no such limit.`,
      },
      { status: 413 },
    );
  }

  const form = await request.formData().catch(() => null);
  if (!form) {
    return Response.json(
      {
        error: "expected_multipart",
        hint:
          "Content-Type: multipart/form-data with files under `files`, or " +
          'application/json with {"day": "...", "urls": ["https://…"]}. If the request really ' +
          `was multipart, the other thing that produces this is a body over ` +
          `${megabytes(REQUEST_MAX_BYTES)} sent without a Content-Length — that much is ` +
          `buffered and the rest is dropped, so what arrives here no longer parses.`,
      },
      { status: 400 },
    );
  }

  const day = String(form.get("day") ?? "").trim();
  const wrongDay = dayProblem(day);
  if (wrongDay) return wrongDay;

  const files = form.getAll("files").filter((f): f is File => f instanceof File);

  // Refused before anything is read into memory: a request carrying a
  // gigabyte should not be buffered in order to be told it is too big.
  if (files.length > MAX_ITEMS_PER_DAY) {
    return Response.json(
      {
        error: "invalid_media",
        problems: [
          {
            field: "files",
            got: `${files.length} items`,
            expected: `at most ${MAX_ITEMS_PER_DAY} per request`,
          },
        ],
      },
      { status: 400 },
    );
  }
  const oversize = files.find((f) => f.size > IMAGE_MAX_BYTES);
  if (oversize) {
    return Response.json(
      {
        error: "invalid_media",
        problems: [
          {
            field: `${oversize.name}.size`,
            got: `${(oversize.size / 1024 / 1024).toFixed(1)} MB`,
            expected: `at most ${(IMAGE_MAX_BYTES / 1024 / 1024).toFixed(0)} MB`,
          },
        ],
      },
      { status: 400 },
    );
  }

  const captions = captionsFor(form.getAll("captions"), files.length);
  if (!captions.ok) {
    return Response.json({ error: "invalid_media", problems: [captions.problem] }, { status: 400 });
  }

  const uploads: UploadCandidate[] = [];
  for (const [at, file] of files.entries()) {
    uploads.push({
      filename: file.name,
      bytes: Buffer.from(await file.arrayBuffer()),
      caption: captions.captions[at],
    });
  }

  const result = await storeUploads(ref, day, uploads);
  if (!result.ok) {
    return Response.json({ error: "invalid_media", problems: result.problems }, { status: 400 });
  }

  const attached = attachGallery(ref, day, result.items);
  return stored(
    ref,
    day,
    withOwner(result.items, user),
    result.kept,
    attached.ok,
    attached.ok ? undefined : attached.error,
  );
}
