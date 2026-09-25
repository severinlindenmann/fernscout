import fs from "node:fs";
import { isEnabled } from "@/lib/capabilities";
import { deriveTripTrack, discardImportedHistory, importGps, isRefusal } from "@/lib/gps/api";
import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { findInboxFile } from "@/lib/inbox";
import { getTrip, getTrips, tripRef } from "@/lib/trips";
import { withStorageQuota } from "@/lib/storageQuota";
import { readJsonBody } from "@/lib/api/jsonBody";

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
 *
 * **B1937 adds three request shapes on top of the original one**, for the
 * studio's own five-step flow (`components/studio/location/LocationFlow.tsx`):
 *
 * - `{ inbox, dryRun: true }` — the peek step. Parses and reports, writes
 *   nothing, and includes `extent` (a bounding box, never a route) plus
 *   `coverage` for every trip the journal has.
 * - `{ inbox, commit: true, trips: string[], discard?: boolean }` — the
 *   decide step's own button. Writes the history, draws a track for each
 *   named trip, and — only then — discards the raw history if asked.
 * - The original bare `{ inbox }` and `{ trip }` shapes are unchanged, for
 *   `components/AgentInbox.tsx` and the pre-B1937 `NonPhotoImport.tsx`.
 */

type Body = {
  inbox?: unknown;
  trip?: unknown;
  dryRun?: unknown;
  commit?: unknown;
  trips?: unknown;
  discard?: unknown;
};

export async function POST(request: Request, { params }: RouteContext<"/api/helper/[user]/import">) {
  const { user } = await params;
  if (!(await isHelperOwner(user))) {
    return notYourJournal(request, user);
  }

  const jsonBody = await readJsonBody(request);
  if (!jsonBody.ok) return jsonBody.response;
  const body = (jsonBody.value) as Body | null;
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
  const dryRun = body.dryRun === true;
  const trips = getTrips(user).map((t) => ({ id: t.id, start: t.start, end: t.end }));

  // A read that will not write pays no storage rent, and needs no lock.
  let result: ReturnType<typeof importGps>;
  if (dryRun) {
    result = importGps(user, text, found.entry.filename, { dryRun, trips });
  } else {
    // Check-then-write, one step per journal — B1570, the same lock
    // `app/api/v1/[user]/import/route.ts` uses (B1556): two imports racing
    // past the ceiling would otherwise both pass the check before either
    // had written a fix to disk.
    const guarded = await withStorageQuota(user, Buffer.byteLength(text), () =>
      importGps(user, text, found.entry.filename, { dryRun, trips }),
    );
    if (!guarded.ok) {
      return Response.json({ error: "storage_full", message: guarded.problem }, { status: 400 });
    }
    result = guarded.value;
  }
  if (isRefusal(result)) {
    return Response.json(
      {
        error: result.refusal,
        message: result.message,
        problems: result.problems,
        // The peek's honest-failure screens name the file by what it actually
        // was, never the API's own technical message — B1937.
        filename: found.entry.filename,
      },
      { status: 400 },
    );
  }

  if (dryRun) {
    return Response.json({
      ok: true,
      format: result.format,
      read: result.read,
      from: result.from,
      to: result.to,
      extent: result.extent,
      coverage: result.coverage ?? [],
      helper: isEnabled("helper", user),
    });
  }

  // The decide step's own button: write, then draw a track for every trip
  // named, then — only now that a track exists — discard the raw history if
  // that was the choice (D7).
  if (body.commit === true) {
    const wantedTrips = Array.isArray(body.trips) ? body.trips.filter((t): t is string => typeof t === "string") : [];
    const drawn: { tripId: string; segments: number; points: number }[] = [];
    for (const tripId of wantedTrips) {
      const trip = getTrip(tripRef(user, tripId));
      if (!trip) continue;
      const track = deriveTripTrack(user, { id: trip.id, start: trip.start, end: trip.end });
      drawn.push({ tripId, segments: track.segments, points: track.points });
    }
    let discarded = false;
    if (body.discard === true && result.from && result.to) {
      discardImportedHistory(user, { from: Date.parse(result.from), to: Date.parse(result.to) });
      discarded = true;
    }
    return Response.json({
      ok: true,
      read: result.read,
      drawn,
      discarded,
      helper: isEnabled("helper", user),
    });
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
