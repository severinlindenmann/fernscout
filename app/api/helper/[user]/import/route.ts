import fs from "node:fs";
import { isEnabled } from "@/lib/capabilities";
import { deriveTripTrack, importGps, isRefusal } from "@/lib/gps/api";
import { isHelperOwner } from "@/lib/helper/server";
import { findInboxFile } from "@/lib/inbox";
import { getTrip, tripRef } from "@/lib/trips";
import { storageRefusal } from "@/lib/storageQuota";

export const dynamic = "force-dynamic";

/**
 * A location history, read from the inbox — B689.
 *
 * **No model, not one call, not ever.** `importers/gps/` already knows Google
 * Timeline, Google Takeout, GPX and JSON Lines by heart, and a file it
 * recognises is read by code the way a photograph's EXIF is: the plan's
 * Regelwerk (§2) puts a model only where nothing cheaper can answer, and here
 * something cheaper already does. This route is a cookie-only door onto
 * `lib/gps/api.ts` and nothing else.
 *
 * **Nothing here hands back a position.** `importGps` writes and counts;
 * `deriveTripTrack` reads the store and answers with how many segments it
 * wrote. Neither returns a coordinate, and `test/gps-store.test.ts` asserts
 * that no route reaches past this module into the store itself.
 *
 * Free, unmetered, and available with the `helper` capability off — there is
 * no provider behind it to pay. What it needs is an owner's cookie, which is
 * the whole gate: an imported history is the journal's, never one trip's.
 */

type Body = { inbox?: unknown; trip?: unknown };

export async function POST(request: Request, { params }: RouteContext<"/api/helper/[user]/import">) {
  const { user } = await params;
  if (!(await isHelperOwner(user))) {
    return Response.json({ error: "not_your_journal" }, { status: 404 });
  }

  const body = (await request.json().catch(() => null)) as Body | null;
  if (!body) return Response.json({ error: "invalid_json" }, { status: 400 });

  // The second half of the loop, and a separate press: importing is the owner
  // handing over their history, drawing is them saying this trip's map may
  // show where they went. Same shape as `POST …/trips/<trip>/track`.
  if (typeof body.trip === "string" && body.inbox === undefined) {
    const trip = getTrip(tripRef(user, body.trip));
    if (!trip) return Response.json({ error: "unknown_trip" }, { status: 404 });
    const drawn = deriveTripTrack(user, { id: trip.id, start: trip.start, end: trip.end });
    return Response.json({ ok: true, track: drawn });
  }

  if (typeof body.inbox !== "string") {
    return Response.json({ error: "no_file" }, { status: 400 });
  }
  const found = findInboxFile(user, body.inbox);
  if (!found) return Response.json({ error: "unknown_inbox_file" }, { status: 404 });

  const text = fs.readFileSync(found.file, "utf8");
  const refusal = await storageRefusal(user, Buffer.byteLength(text));
  if (refusal) return Response.json({ error: "storage_full", message: refusal }, { status: 400 });

  const result = importGps(user, text, found.entry.filename);
  if (isRefusal(result)) {
    return Response.json(
      { error: result.refusal, message: result.message, problems: result.problems },
      { status: 400 },
    );
  }
  return Response.json({
    ok: true,
    format: result.format,
    read: result.read,
    // Dates, which is what the screen needs to say which trips this covers.
    // Never a position: see the note above.
    from: result.from,
    to: result.to,
    held: result.stored?.after ?? 0,
    // Said here so the answer does not depend on the capability being on.
    helper: isEnabled("helper", user),
  });
}
