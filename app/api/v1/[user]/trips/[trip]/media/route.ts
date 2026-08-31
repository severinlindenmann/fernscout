import { authenticate, errorResponse, mayWriteTrip, ownsUser } from "@/lib/api/auth";
import { storeUploads, type UploadCandidate } from "@/lib/api/media";
import { getTrip, tripRef } from "@/lib/trips";
import { fetchImage } from "@/lib/api/fetchMedia";
import { getUser } from "@/lib/users";
import { IMAGE_MAX_BYTES, MAX_ITEMS_PER_DAY } from "@/lib/validate/media";

export const dynamic = "force-dynamic";

/**
 * `POST /api/v1/<user>/trips/<trip>/media` — put photographs on a day.
 *
 * Until this existed the only way media reached a journal was `npm run
 * ingest`, reading a folder on the same machine — so an agent working over
 * the network could write the words and nothing else.
 *
 * Answers with the gallery block for the files it wrote, in the exact shape
 * the entry's frontmatter wants, so the agent pastes rather than composes.
 * The original of every file is kept; see lib/api/media.ts for why.
 */
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

    const stored = await storeUploads(ref, day, fetched);
    if (!stored.ok) {
      return Response.json({ error: "invalid_media", problems: stored.problems }, { status: 400 });
    }
    return Response.json(
      { ok: true, day, items: stored.items, fetched: fetched.length },
      { status: 201 },
    );
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

  return Response.json(
    {
      ok: true,
      day,
      items: result.items,
      note:
        "Paste `items` into the entry's `gallery:` block. The originals are kept — " +
        "the site serves a resized copy, the photobook prints from what you sent.",
    },
    { status: 201 },
  );
}
