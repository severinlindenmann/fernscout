import { authenticate, errorResponse, mayWriteTrip, ownsUser } from "@/lib/api/auth";
import { attachGallery, isPublished } from "@/lib/api/entries";
import { storeUploads, type KeptOriginal, type UploadCandidate } from "@/lib/api/media";
import { getTrip, tripRef } from "@/lib/trips";
import { fetchImage } from "@/lib/api/fetchMedia";
import { getUser } from "@/lib/users";
import { IMAGE_MAX_BYTES, MAX_ITEMS_PER_DAY } from "@/lib/validate/media";
import type { GalleryItem } from "@/lib/types";

export const dynamic = "force-dynamic";

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
 * The two ways a `day` can be wrong, answered before anything is read.
 *
 * `day` was always required — `storeUploads` refuses a slug that names no
 * entry — but it used only to decide a folder name. Now that it decides which
 * file gets edited, saying so up front is worth the six lines: a request with
 * no day is one that would write photographs attached to nothing.
 */
function dayProblem(ref: string, day: string): Response | null {
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
  // Refused before the bytes are read, not after. Adding photographs to a day
  // people have already read changes what they read, and that is a person's
  // decision — the same line the delete route draws.
  if (isPublished(ref, day)) {
    return Response.json(
      {
        error: "day_published",
        message:
          `"${day}" is published, so this would change a day people have already read. ` +
          "Ask the person to add these themselves, or write a new day for them.",
      },
      { status: 409 },
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
  day: string,
  items: GalleryItem[],
  kept: KeptOriginal[],
  attached: boolean,
  error?: string,
) {
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
      note: attached
        ? `Added to "${day}". Nothing to paste — read the day back to see it. ` +
          `\`kept\` is what was stored untouched for print; \`items\` is the resized copy the ` +
          `site serves.`
        : `${error} The originals in \`kept\` are stored either way.`,
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
    return Response.json({ error: "out_of_scope" }, { status: 403 });
  }

  const ref = tripRef(user, trip);
  const found = getTrip(ref);
  // Same answer whether the trip is missing or simply not this token's — see
  // the days route.
  if (!found || !mayWriteTrip(auth.session, found)) {
    return Response.json({ error: "unknown_trip" }, { status: 404 });
  }

  // Two ways in. JSON carries a list of URLs for this server to fetch;
  // multipart carries the bytes. The first is the convenient one and the one
  // that has to be careful — see lib/api/fetchMedia.ts.
  if ((request.headers.get("content-type") ?? "").includes("application/json")) {
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const day = typeof body?.day === "string" ? body.day.trim() : "";
    const wrongDay = dayProblem(ref, day);
    if (wrongDay) return wrongDay;

    const urls = Array.isArray(body?.urls) ? body.urls.filter((u): u is string => typeof u === "string") : [];
    if (urls.length === 0) {
      return Response.json(
        { error: "expected_urls", hint: 'Send {"day": "...", "urls": ["https://…"]}, or multipart bytes.' },
        { status: 400 },
      );
    }

    const limits = getUser(user)!.media;
    const fetched: UploadCandidate[] = [];
    const failures: { url: string; reason: string }[] = [];
    for (const url of urls.slice(0, limits.itemsPerDay)) {
      const got = await fetchImage(url, limits.imageBytes);
      if (got.ok) fetched.push(got.media);
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
    return stored(day, written.items, written.kept, attached.ok, attached.ok ? undefined : attached.error);
  }

  const form = await request.formData().catch(() => null);
  if (!form) {
    return Response.json(
      {
        error: "expected_multipart",
        hint:
          "Content-Type: multipart/form-data with files under `files`, or " +
          'application/json with {"day": "...", "urls": ["https://…"]}.',
      },
      { status: 400 },
    );
  }

  const day = String(form.get("day") ?? "").trim();
  const wrongDay = dayProblem(ref, day);
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

  const uploads: UploadCandidate[] = [];
  for (const file of files) {
    uploads.push({ filename: file.name, bytes: Buffer.from(await file.arrayBuffer()) });
  }

  const result = await storeUploads(ref, day, uploads);
  if (!result.ok) {
    return Response.json({ error: "invalid_media", problems: result.problems }, { status: 400 });
  }

  const attached = attachGallery(ref, day, result.items);
  return stored(day, result.items, result.kept, attached.ok, attached.ok ? undefined : attached.error);
}
