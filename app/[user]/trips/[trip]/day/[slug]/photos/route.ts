import { attachGallery, detachGallery } from "@/lib/api/entries";
import { kindOf, storeUploads, type UploadCandidate } from "@/lib/api/media";
import { isOwner } from "@/lib/contacts/session";
import { AS_AUTHOR, getEntryBySlug } from "@/lib/entries";
import { getTrip, tripRef } from "@/lib/trips";
import { IMAGE_MAX_BYTES, VIDEO_MAX_BYTES } from "@/lib/validate/media";

export const dynamic = "force-dynamic";

/**
 * The photographs of a day, from the day — B980, round 2.
 *
 * The sibling of `edit/` beside it, and the same door for the same reason:
 * `/api/v1/<user>/trips/<trip>/media` has put pictures on a day since the
 * beginning and taken them off since B605, and a browser can call neither,
 * because `/api/v1` reads a bearer token and a person holds a cookie.
 *
 * **Everything about a file is still `storeUploads`' decision** — the format,
 * the size, the journal's own narrower limits, the storage quota, the
 * derivative that is actually served. Nothing about media is re-implemented
 * here; this route decides only *who is asking*, and the answer it accepts is
 * the owner, from a browser, with no `Authorization` header.
 *
 * Captions and `visibility` are deliberately not here: they are fields of the
 * day, and the day's own `edit/` route writes them through `editEntry` with
 * everything else. A photograph arrives from this route uncaptioned and
 * unlabelled, and the panel's next save says what it is and who may see it.
 */
const NOT_FOR_AGENTS = {
  error: "not_for_agents",
  message:
    "This is the owner's own door, from a browser. An agent uses " +
    "/api/v1/<user>/trips/<trip>/media.",
};

type Gate =
  { ok: true; ref: string; slug: string } | { ok: false; response: Response };

async function guard(
  request: Request,
  params: Promise<{ user: string; trip: string; slug: string }>,
): Promise<Gate> {
  if (request.headers.get("authorization")) {
    return {
      ok: false,
      response: Response.json(NOT_FOR_AGENTS, { status: 403 }),
    };
  }
  const { user, trip, slug } = await params;
  if (!(await isOwner(user))) {
    return {
      ok: false,
      response: Response.json({ error: "forbidden" }, { status: 403 }),
    };
  }
  const ref = tripRef(user, trip);
  if (!getTrip(ref)) {
    return {
      ok: false,
      response: Response.json({ error: "unknown_trip" }, { status: 404 }),
    };
  }
  if (!getEntryBySlug(ref, slug, AS_AUTHOR)) {
    return {
      ok: false,
      response: Response.json({ error: "unknown_day" }, { status: 404 }),
    };
  }
  return { ok: true, ref, slug };
}

export async function POST(
  request: Request,
  { params }: RouteContext<"/[user]/trips/[trip]/day/[slug]/photos">,
) {
  const gate = await guard(request, params);
  if (!gate.ok) return gate.response;

  const form = await request.formData().catch(() => null);
  const files = (form?.getAll("files") ?? []).filter(
    (f): f is File => f instanceof File,
  );
  if (files.length === 0)
    return Response.json({ error: "expected_files" }, { status: 400 });

  // Refused before the bytes are read, off the same two caps the media route
  // checks first — a 500 MB clip should not be buffered only to be told no.
  const oversize = files.find(
    (f) =>
      f.size > (kindOf(f.name) === "video" ? VIDEO_MAX_BYTES : IMAGE_MAX_BYTES),
  );
  if (oversize)
    return Response.json(
      { error: "too_large", name: oversize.name },
      { status: 400 },
    );

  const uploads: UploadCandidate[] = [];
  for (const file of files) {
    uploads.push({
      filename: file.name,
      bytes: Buffer.from(await file.arrayBuffer()),
    });
  }

  const stored = await storeUploads(gate.ref, gate.slug, uploads);
  if (!stored.ok) {
    return Response.json(
      { error: "invalid_media", problems: stored.problems },
      { status: 400 },
    );
  }
  const attached = attachGallery(gate.ref, gate.slug, stored.items);
  if (!attached.ok)
    return Response.json({ error: attached.error }, { status: 400 });

  return Response.json({ ok: true, added: stored.items.length });
}

export async function DELETE(
  request: Request,
  { params }: RouteContext<"/[user]/trips/[trip]/day/[slug]/photos">,
) {
  const gate = await guard(request, params);
  if (!gate.ok) return gate.response;

  const body = (await request.json().catch(() => null)) as {
    src?: unknown;
  } | null;
  const src = Array.isArray(body?.src)
    ? body.src.filter((s): s is string => typeof s === "string")
    : [];
  if (src.length === 0)
    return Response.json({ error: "expected_src" }, { status: 400 });

  const result = detachGallery(gate.ref, gate.slug, src);
  if (!result.ok) {
    if (result.error === "unknown_day") {
      return Response.json({ error: result.error }, { status: 404 });
    }
    return Response.json({ error: result.error, problems: result.problems }, { status: 400 });
  }
  return Response.json({
    ok: true,
    removed: result.removed.map((item) => item.src),
  });
}
