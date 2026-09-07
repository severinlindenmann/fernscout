import { attachGallery } from "@/lib/api/entries";
import { storeUploads } from "@/lib/api/media";
import { isHelperOwner } from "@/lib/helper/server";
import { getTrip, tripRef } from "@/lib/trips";

export const dynamic = "force-dynamic";

/**
 * One photograph, one request — B682.
 *
 * Deliberately the simplest thing that works: the file as the phone holds it,
 * straight into `storeUploads`, which is the same function `POST
 * /api/v1/.../trips/<trip>/media` calls and which owns every rule about
 * formats, sizes, per-day counts, the storage quota and keeping the original.
 * Nothing about storage changes here.
 *
 * **One file per request, and no queue.** The resumable two-phase upload — a
 * 2000px web copy first so the day is readable on a hotel connection, the
 * original following in the background, both surviving a killed tab — is
 * B683, and building half of it here would be a queue nobody could resume.
 * The wizard sends these one at a time and counts them.
 */
export async function POST(
  request: Request,
  { params }: RouteContext<"/api/helper/[user]/day/media">,
) {
  const { user } = await params;
  if (!(await isHelperOwner(user))) {
    return Response.json({ error: "not_your_journal" }, { status: 404 });
  }

  const form = await request.formData().catch(() => null);
  if (!form) return Response.json({ error: "expected_multipart" }, { status: 400 });

  const tripId = String(form.get("trip") ?? "").trim();
  const ref = tripRef(user, tripId);
  if (!getTrip(ref)) return Response.json({ error: "unknown_trip" }, { status: 404 });

  const day = String(form.get("day") ?? "").trim();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "expected_file" }, { status: 400 });
  }

  const written = await storeUploads(ref, day, [
    { filename: file.name, bytes: Buffer.from(await file.arrayBuffer()) },
  ]);
  if (!written.ok) {
    // The problems come back verbatim: they name the field, what arrived and
    // what was expected, and a person who has just been refused a photograph
    // is owed the reason rather than a shrug.
    return Response.json({ error: "invalid_media", problems: written.problems }, { status: 400 });
  }

  // A file that matched one already on the day is not an error and not a
  // second copy — `storeUploads` recognises it and says so. The wizard counts
  // what is on the day afterwards rather than what it sent, so a re-picked
  // photograph settles at the right number either way.
  const attached = attachGallery(ref, day, written.items);
  return Response.json(
    {
      ok: true,
      stored: written.items.length,
      skipped: written.skipped.length,
      attached: attached.ok,
    },
    { status: 201 },
  );
}
