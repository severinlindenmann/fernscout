import "server-only";
import sharp from "sharp";
import { reversePlace } from "@/lib/addressLookup";
import { isEnabled } from "@/lib/capabilities";
import {
  INBOX_KINDS,
  kindForExtension,
  storeInboxFile,
  type InboxKind,
  type InboxMeta,
} from "@/lib/inbox";
import { photoMetaFromExif } from "@/lib/ingest/exif";
import { reverseGeocode } from "@/lib/ingest/geo";
import { MAX_DECODE_PIXELS } from "@/lib/ingest/image";
import { withStorageQuota } from "@/lib/storageQuota";
import { getUser } from "@/lib/users";
import {
  MAX_ITEMS_PER_DAY,
  REQUEST_MAX_BYTES,
  pixelCountProblem,
  validateMediaItem,
  type Problem,
} from "@/lib/validate/media";

/**
 * One implementation of "take a multipart upload into the inbox" — B1171.
 *
 * It grew up inside `POST /api/v1/[user]/inbox` and moved here the day the
 * room needed the same door behind a cookie: the helper's files pane uploads
 * to the inbox now (`POST /api/helper/[user]/inbox`), and two copies of the
 * validation — kinds, per-file ceilings, the storage quota — would disagree
 * within a month. Both routes authenticate their own way and then hand the
 * request here.
 */

/**
 * The metadata one file carries, from a form field or a JSON object.
 *
 * Every field is optional and every one of them is **what somebody said**. The
 * server writes nothing here of its own: a description invented for a
 * photograph is exactly the kind of fiction nobody catches later, and an empty
 * field beats a plausible one (AGENTS.md).
 */
function metaFrom(raw: unknown): InboxMeta {
  if (!raw || typeof raw !== "object") return {};
  const src = raw as Record<string, unknown>;
  const text = (key: string) =>
    typeof src[key] === "string" && src[key].trim() !== "" ? src[key].trim() : undefined;
  const number = (key: string) =>
    typeof src[key] === "number" && Number.isFinite(src[key]) ? src[key] : undefined;
  const meta: InboxMeta = {
    description: text("description"),
    caption: text("caption"),
    takenAt: text("takenAt"),
    lat: number("lat"),
    lon: number("lon"),
    tags: Array.isArray(src.tags)
      ? src.tags.filter((t): t is string => typeof t === "string")
      : undefined,
  };
  // Absent rather than `undefined`, so a sidecar on disk carries only the
  // fields somebody actually filled in.
  return Object.fromEntries(Object.entries(meta).filter(([, v]) => v !== undefined));
}

/** The kind the caller asked for, the kind the extension implies, or null. */
function kindFor(asked: unknown, filename: string): InboxKind | null {
  if (typeof asked === "string" && (INBOX_KINDS as readonly string[]).includes(asked)) {
    return asked as InboxKind;
  }
  return kindForExtension(filename);
}

/**
 * Validate and store one multipart upload into `<user>`'s inbox.
 *
 * The caller has already decided this request may act as the journal's
 * owner; everything after that decision lives here, refusals included.
 */
export async function receiveInboxUpload(user: string, request: Request): Promise<Response> {
  const journal = getUser(user);
  if (!journal) return Response.json({ error: "unknown_user" }, { status: 404 });

  // Read before the body is touched — `formData()` would already have
  // truncated it. Same reasoning, and the same limit, as the media route.
  const declared = Number(request.headers.get("content-length") ?? "");
  if (Number.isFinite(declared) && declared > REQUEST_MAX_BYTES) {
    return Response.json(
      {
        error: "body_too_large",
        message:
          `The whole request may be ${(REQUEST_MAX_BYTES / 1024 / 1024).toFixed(0)} MB. Send ` +
          "fewer files per call — the inbox appends, so several calls fill it up.",
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
          "Content-Type: multipart/form-data, files under `files`. Say what each one is with " +
          "`meta` — one JSON object per file, in the same order — with any of " +
          "`description`, `caption`, `lat`, `lon`, `takenAt`, `tags`. All optional, and all " +
          "of them what you were told rather than what you concluded.",
      },
      { status: 400 },
    );
  }

  const files = form.getAll("files").filter((f): f is File => f instanceof File);
  if (files.length === 0) {
    return Response.json(
      { error: "invalid_media", problems: [{ field: "files", got: "nothing", expected: "at least one file" }] },
      { status: 400 },
    );
  }
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

  // Positional, like the media route's `captions` and `visibility`, and for
  // the same reason: a caller sending both is sending them in one call and
  // should not have to learn two conventions for "the n-th file".
  const metas = form.getAll("meta").map((raw) => {
    try {
      return metaFrom(JSON.parse(String(raw)));
    } catch {
      return {};
    }
  });
  const askedKinds = form.getAll("kind").map(String);

  const limits = journal.media;
  const staged: { filename: string; bytes: Buffer; kind: InboxKind; meta: InboxMeta }[] = [];
  const problems: { field: string; got: string; expected: string }[] = [];

  for (const [at, file] of files.entries()) {
    const kind = kindFor(askedKinds[at], file.name);
    if (!kind) {
      problems.push({
        field: file.name,
        got: "a kind of file this journal does not take",
        expected: `an image, a video, or one of csv, pdf, json, txt, gpx, md`,
      });
      continue;
    }
    // The per-file ceiling the journal already has. A video is allowed to be
    // the larger of the two; everything else is measured against the image
    // limit, which is the one a stray 400 MB file would sail past otherwise.
    const cap = kind === "media" && file.type.startsWith("video/") ? limits.videoBytes : limits.imageBytes;
    if (file.size > cap) {
      problems.push({
        field: `${file.name}.size`,
        got: `${(file.size / 1024 / 1024).toFixed(1)} MB`,
        expected: `at most ${(cap / 1024 / 1024).toFixed(0)} MB`,
      });
      continue;
    }
    staged.push({
      filename: file.name,
      bytes: Buffer.from(await file.arrayBuffer()),
      kind,
      meta: metas[at] ?? {},
    });
  }

  // All or nothing, like every other batch here: a half-staged upload is the
  // state that is annoying to sort out by hand, and the caller can see which
  // file was the problem and send the lot again.
  if (problems.length > 0) {
    return Response.json({ error: "invalid_media", problems }, { status: 400 });
  }

  // A camera measured this; a reverse-geocode looked that up — neither is a
  // guess, so both are fair game, and only ever a fallback for what nobody
  // already said (AGENTS.md: never overwrite what somebody said).
  const edgeProblems: Problem[] = [];
  // B2189: several photos from the same walk round to the same key, so one
  // upload of a day's worth of pictures does one lookup per place rather
  // than one per photo. ponytail: a flat per-request Map, cleared with the
  // function — fine at inbox-upload volumes; a journal wide cache would only
  // earn its keep if this lookup ever left the process.
  const offlinePlaceCache = new Map<
    string,
    { location: string; country: string; countryCode: string } | null
  >();
  function offlinePlaceFor(lat: number, lon: number) {
    const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
    if (!offlinePlaceCache.has(key)) {
      // Never throws elsewhere in this codebase (`reverseGeocode`'s own
      // contract), except when the packed index itself is missing from the
      // box (`geodataAvailable()` false) — same graceful "no location filled
      // in" as every other reader of this module.
      let place = null;
      try {
        const found = reverseGeocode(lat, lon);
        if (found) place = { location: found.name, country: found.country, countryCode: found.countryCode };
      } catch {
        place = null;
      }
      offlinePlaceCache.set(key, place);
    }
    return offlinePlaceCache.get(key) ?? null;
  }
  for (const file of staged) {
    if (file.kind === "media") {
      if (file.meta.lat === undefined && file.meta.lon === undefined && file.meta.takenAt === undefined) {
        const exif = photoMetaFromExif(file.bytes);
        if (exif) {
          file.meta = { ...file.meta, ...exif, measuredFrom: "exif" };
        }
      }
      // A header read, not a decode — B1995. `sharp.metadata()` answers off
      // the container even for a HEIC no decoder on this box could open a
      // pixel of, so the tile has a width × height without ever probing on a
      // page load. A video, or anything sharp's header reader does not
      // recognise, just leaves `dimensions` absent.
      //
      // `limitInputPixels` makes sharp refuse (rather than decode) a header
      // that declares more than `MAX_DECODE_PIXELS` — a pixel bomb the
      // commit-time check in `lib/api/staged.ts` would otherwise be the
      // first thing to catch, well after the file was already staged.
      // B2179: caught here, at the door, with the file named, the same
      // pattern as `lib/api/media.ts` and `lib/api/v2/media.ts`.
      let declared: { width?: number; height?: number } | undefined;
      let declaredTooManyPixels = false;
      try {
        declared = await sharp(file.bytes, { limitInputPixels: MAX_DECODE_PIXELS }).metadata();
      } catch (err) {
        if (/exceeds pixel limit/i.test((err as Error).message ?? "")) declaredTooManyPixels = true;
      }
      if (declared?.width && declared?.height) {
        file.meta = { ...file.meta, dimensions: { width: declared.width, height: declared.height } };
      }
      if (declaredTooManyPixels) {
        // The limited read above refused to say what this file declares —
        // that is exactly the point of `limitInputPixels`, but it leaves
        // nothing to check `imageEdge` against. Re-reading the header with
        // no limit is still a header read, never a decode: sharp's own
        // (much larger) default ceiling is what bounds this second call,
        // so a genuinely hostile header still answers "more than", not an
        // invented width — B2179 round 2, `pixelCountProblem` says why a
        // fabricated edge (this code's first shape) was wrong.
        const real = await sharp(file.bytes).metadata().catch(() => undefined);
        edgeProblems.push(
          pixelCountProblem(
            file.filename,
            real?.width && real?.height ? { width: real.width, height: real.height } : undefined,
          ),
        );
      } else if (declared?.width && declared?.height) {
        edgeProblems.push(
          ...validateMediaItem(
            { name: file.filename, kind: "image", longestEdge: Math.max(declared.width, declared.height) },
            limits,
          ),
        );
      }
      // A photograph's own EXIF fix names a place too (B2189) — offline, so
      // the coordinates the camera measured never reach a third party: the
      // packed place index (`lib/ingest/geo.ts`) is the same lookup
      // `placeForDay` uses for a day's GPS history. Journal locale is not
      // applied here — the index carries one name per place (from GeoNames),
      // not per-locale variants, unlike the `location`-kind path below,
      // which asks a live provider that does localise. Gated on
      // `addressLookup` because that is this journal's existing "name my
      // places for me" toggle, even though this branch makes no request of
      // its own. Never overwrites a place somebody already said.
      if (
        isEnabled("addressLookup", user) &&
        file.meta.location === undefined &&
        file.meta.lat !== undefined &&
        file.meta.lon !== undefined
      ) {
        const place = offlinePlaceFor(file.meta.lat, file.meta.lon);
        if (place) {
          file.meta = { ...file.meta, ...place, locationSource: "offline" };
        }
      }
    }
    if (file.kind === "location" && isEnabled("addressLookup", user) && file.meta.lat !== undefined && file.meta.lon !== undefined) {
      const place = await reversePlace(file.meta.lat, file.meta.lon, journal.defaultLocale).catch(() => null);
      if (place) {
        file.meta = {
          ...file.meta,
          location: place.location,
          country: place.country,
          countryCode: place.countryCode,
          locationSource: "addressLookup",
        };
      }
    }
  }
  if (edgeProblems.length > 0) {
    return Response.json({ error: "invalid_media", problems: edgeProblems }, { status: 400 });
  }

  // B661's ceiling, from this door too. The inbox is inside the journal
  // folder, so it must not be the way round the limit. Checked and written
  // under the same per-username lock as every other upload door (B1556), so
  // two requests that each individually fit cannot both pass the check before
  // either has written a byte.
  const guard = await withStorageQuota(
    user,
    staged.reduce((n, f) => n + f.bytes.byteLength, 0),
    () => staged.map((file) => storeInboxFile(user, file.kind, file.filename, file.bytes, file.meta)),
  );
  if (!guard.ok) {
    return Response.json(
      {
        error: "invalid_media",
        problems: [{ field: "files", got: "no room left in this journal", expected: guard.problem }],
      },
      { status: 400 },
    );
  }
  const items = guard.value;

  return Response.json(
    {
      ok: true,
      items: items.map(({ entry, existed }) => ({ ...entry, duplicate: existed || undefined })),
      message:
        "Staged, and belonging to no day yet. Send the ids to " +
        `POST /api/v2/${user}/media with an \`inbox\` intent when you know which day each ` +
        "one belongs to — ask the person; never decide that from the picture.",
    },
    { status: 201 },
  );
}
