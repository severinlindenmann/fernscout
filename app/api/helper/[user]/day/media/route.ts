import { attachGallery, detachGallery } from "@/lib/api/entries";
import { attachOriginal, storeUploads } from "@/lib/api/media";
import { loadUserConfig } from "@/lib/config";
import { dayForWizard, isHelperOwner, notYourJournal, previewOf } from "@/lib/helper/server";
import { kindForExtension, storeInboxFile } from "@/lib/inbox";
import { storageFor } from "@/lib/storageQuota";
import { getTrip, tripRef } from "@/lib/trips";

export const dynamic = "force-dynamic";

/**
 * Two phases, a bucket for everything else, and the number to ask before
 * starting — B683.
 *
 * B682 sent one file per request, whole, in order, and that is exactly the
 * shape that fails on hotel wifi: forty 50 MB HEICs go up at the speed of the
 * worst minute of the connection and the day is unreadable until the last one
 * lands. The transfer is what changed here; nothing about storage did.
 *
 * ## `phase=web`
 *
 * A 2000px copy the browser made — the width `lib/mediaSizes.ts` already
 * targets — straight into `storeUploads`, which is the same function the
 * documented `POST /api/v1/.../media` calls and which owns every rule about
 * formats, counts, duplicates, the quota and keeping an original. A day is
 * complete and readable within seconds of the first few landing.
 *
 * The response carries each item's `src`, which the web copy's caller needs
 * and B682's did not: it is what the second phase attaches to.
 *
 * ## `phase=original`
 *
 * The untouched file, against the item the first phase created, through
 * `attachOriginal`. It climbs in the background while the person writes their
 * words, and `originals/` ends up holding what the photobook prints from.
 *
 * ## Anything that is not media
 *
 * Goes to the inbox (`lib/inbox.ts`) rather than being refused. Somebody who
 * picks a bank statement or a Timeline export out of their photo roll has
 * handed over something useful; it is hash-named, reachable by no URL, and
 * attached to no day until something is built that reads it.
 *
 * ## `GET`
 *
 * How much room is left, asked **once before the queue starts** rather than
 * per file. Meeting a wall at photograph thirty-nine is the failure this
 * whole ticket is about.
 */
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/helper/[user]/day/media">,
) {
  const { user } = await params;
  if (!(await isHelperOwner(user))) {
    return notYourJournal(request, user);
  }
  const usage = await storageFor(user);
  const limits = loadUserConfig(user).media;
  return Response.json({
    remainingBytes: usage.remainingBytes,
    usedBytes: usage.usedBytes,
    limitBytes: usage.limitBytes,
    imageBytes: limits.imageBytes,
    videoBytes: limits.videoBytes,
    itemsPerDay: limits.itemsPerDay,
  });
}

/**
 * Take one photograph off a day — B851.
 *
 * `DELETE /api/v1/<user>/trips/<trip>/media` has done this since B605 and
 * nothing in a browser called it, so a picture, once uploaded, could not be
 * removed by the person whose journal it was. B816's day takedown was the only
 * remedy on the screen and it is the wrong size: a friend asking to come out
 * of one photograph got the whole day taken off the site.
 *
 * `detachGallery` is the same function that route calls, so every rule about
 * what a removal *is* — the derivative and the kept original deleted, the
 * `gallery:` block spliced, a `src` the day does not carry refused — lives in
 * one place. What differs, as everywhere under `/api/helper`, is only the
 * credential: cookie, owner, never a bearer token.
 *
 * **It does not come back**, and the screen says so before the button rather
 * than after it. Hiding is the other request and it is a `PATCH` with
 * `photoVisibility` on `../route.ts`; the two are deliberately separate
 * controls, because "take my face off the internet" and "delete my friend's
 * only photograph of the harbour" are not the same sentence.
 */
export async function DELETE(
  request: Request,
  { params }: RouteContext<"/api/helper/[user]/day/media">,
) {
  const { user } = await params;
  if (!(await isHelperOwner(user))) {
    return notYourJournal(request, user);
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return Response.json({ error: "invalid_json" }, { status: 400 });

  const tripId = String(body.trip ?? "").trim();
  const ref = tripRef(user, tripId);
  if (!getTrip(ref)) return Response.json({ error: "unknown_trip" }, { status: 404 });

  const day = String(body.day ?? "").trim();
  const src = Array.isArray(body.src)
    ? body.src.filter((one): one is string => typeof one === "string")
    : [];
  if (src.length === 0) return Response.json({ error: "expected_src" }, { status: 400 });

  const removed = detachGallery(ref, day, src);
  if (!removed.ok) {
    return Response.json(
      { error: removed.error, ...(removed.error === "unknown_media" ? { problems: removed.problems } : {}) },
      { status: removed.error === "unknown_day" ? 404 : 400 },
    );
  }

  // The day as it is now, the same answer every other write here gives, so
  // the wizard re-reads disk rather than patching its own idea of the gallery.
  const draft = dayForWizard(user, tripId, day);
  return Response.json({
    ok: true,
    removed: removed.removed.map((item) => item.src),
    draft,
    preview: previewOf(user, tripId, day),
  });
}

export async function POST(
  request: Request,
  { params }: RouteContext<"/api/helper/[user]/day/media">,
) {
  const { user } = await params;
  if (!(await isHelperOwner(user))) {
    return notYourJournal(request, user);
  }

  const form = await request.formData().catch(() => null);
  if (!form) return Response.json({ error: "expected_multipart" }, { status: 400 });

  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "expected_file" }, { status: 400 });
  }
  const bytes = Buffer.from(await file.arrayBuffer());

  // Not a photograph and not a clip: it goes in the bucket, whatever step of
  // the wizard it was dropped on, and no trip or day is needed for that.
  const kind = kindForExtension(file.name);
  if (kind === null) {
    return Response.json(
      {
        error: "unknown_file_type",
        problems: [{ field: "file", got: file.name, expected: "a photograph, a clip, or a csv, pdf, json, txt, gpx or md file" }],
      },
      { status: 400 },
    );
  }
  if (kind === "files") {
    const stored = storeInboxFile(user, "files", file.name, bytes, {});
    return Response.json(
      { ok: true, inbox: stored.entry.id, existed: stored.existed },
      { status: 201 },
    );
  }

  const tripId = String(form.get("trip") ?? "").trim();
  const ref = tripRef(user, tripId);
  if (!getTrip(ref)) return Response.json({ error: "unknown_trip" }, { status: 404 });

  if (String(form.get("phase") ?? "web") === "original") {
    const src = String(form.get("src") ?? "");
    const attached = await attachOriginal(ref, src, file.name, bytes);
    if (!attached.ok) {
      return Response.json({ error: "invalid_media", problems: attached.problems }, { status: 400 });
    }
    return Response.json({ ok: true, original: attached.stored }, { status: 201 });
  }

  const day = String(form.get("day") ?? "").trim();
  const written = await storeUploads(ref, day, [{ filename: file.name, bytes }]);
  if (!written.ok) {
    // The problems come back verbatim: they name the field, what arrived and
    // what was expected, and a person who has just been refused a photograph
    // is owed the reason rather than a shrug.
    return Response.json({ error: "invalid_media", problems: written.problems }, { status: 400 });
  }

  // A file that matched one already on the day is not an error and not a
  // second copy — `storeUploads` recognises it and says so. Its `src` comes
  // back all the same, so the queue can hang the original phase on the
  // photograph that is actually there rather than sending the big file for
  // nothing.
  const attached = attachGallery(ref, day, written.items);
  return Response.json(
    {
      ok: true,
      stored: written.items.length,
      skipped: written.skipped.length,
      attached: attached.ok,
      src: written.items[0]?.src ?? written.skipped[0]?.matched ?? null,
      duplicate: written.items.length === 0 && written.skipped.length > 0,
    },
    { status: 201 },
  );
}
