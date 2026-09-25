// GET/PUT /api/v2/{user}/gps/zones — B2203.
//
// The whole reason this exists: `content/<user>/gps/exclude.json` was
// documented as something only a shell could write, and a hosted owner
// cannot reach one. Domain logic lives in `lib/gps/api.ts` (`listZones`,
// `writeZones`) — this route parses, authenticates and echoes, the same
// division every other v2 write in this codebase keeps.
//
// `zonesGetDoc`/`zonesPutResponse` are exported for
// `app/api/web/[user]/gps/zones/route.ts` to call in process after its own
// cookie-only `isOwner` check — the same split `channels`' pair uses.
import { requireJournalOwner } from "@/lib/api/v2/auth";
import { etagFor, fail, ifMatchStale, ok, readJson } from "@/lib/api/v2/route";
import { problemsFrom } from "@/lib/api/v2/incomplete";
import { ERROR_CODES } from "@/lib/api/errorCodes";
import { gpsZonesWrite } from "@/lib/api/v2/schemas/gpsZones";
import { ZONE_LIMITS, listZones, writeZones } from "@/lib/gps/api";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

const limits = { maxZones: ZONE_LIMITS.maxZones, radiusM: { min: ZONE_LIMITS.minRadiusM, max: ZONE_LIMITS.maxRadiusM } };

// Never cached: a stale copy of somebody's home zones sitting in a shared
// cache is the exact leak this door exists to prevent, and a PUT's echo
// carries the zones right back out too.
const NO_STORE = { "Cache-Control": "no-store" };

export function zonesGetDoc(user: string): Response {
  if (!getUser(user)) return fail("unknown_user", ERROR_CODES.unknown_user, undefined, 404);
  try {
    const doc = { ...listZones(user), limits };
    return ok(doc, { etag: etagFor(doc), headers: NO_STORE });
  } catch {
    // Fails closed the same way `readExcludeZones` does: an unreadable file
    // means every zone is missing, and that is somebody's front door on a
    // public map — refuse rather than answer with less than is really
    // there. The fixed `unreadable_zones` message only, never
    // `error.message` — that can carry this server's own filesystem paths.
    return fail("unreadable_zones", ERROR_CODES.unreadable_zones, undefined, 500);
  }
}

export async function zonesPutResponse(user: string, request: Request): Promise<Response> {
  if (!getUser(user)) return fail("unknown_user", ERROR_CODES.unknown_user, undefined, 404);

  let currentDoc: { zones: ReturnType<typeof listZones>["zones"]; homeDeclined: boolean; limits: typeof limits };
  try {
    currentDoc = { ...listZones(user), limits };
  } catch {
    return fail("unreadable_zones", ERROR_CODES.unreadable_zones, undefined, 500);
  }
  // Optimistic concurrency, same shape as a day's PUT (`ifMatchStale` /
  // `stale_document`): a caller who never read the zones first, or read them
  // and lost a race, does not get to overwrite blind — a private zone is
  // exactly the kind of edit where "last write wins" can silently reopen
  // somebody's front door.
  const currentEtag = etagFor(currentDoc);
  if (!request.headers.get("if-match") || ifMatchStale(request, currentEtag)) {
    return fail("stale_document", ERROR_CODES.stale_document, currentDoc, 409);
  }

  const body = await readJson(request);
  if (!body.ok) return body.response;

  const parsed = gpsZonesWrite.safeParse(body.value);
  if (!parsed.success) {
    return fail("invalid_request", ERROR_CODES.invalid_request, problemsFrom(parsed.error), 400);
  }

  let doc: { zones: ReturnType<typeof listZones>["zones"]; homeDeclined: boolean; limits: typeof limits };
  try {
    const result = writeZones(user, parsed.data.zones, parsed.data.homeDeclined);
    doc = { ...result, limits };
  } catch {
    // The write(s) above may have landed; it is the confirming read-back
    // that failed. Answering the generic write's own error would claim
    // nothing happened, which is not knowable here — the same refusal `GET`
    // gives an unreadable file is the truthful one: re-`GET` to see what is
    // actually on disk now.
    return fail("unreadable_zones", ERROR_CODES.unreadable_zones, undefined, 500);
  }
  return ok(doc, { etag: etagFor(doc), headers: NO_STORE });
}

export async function GET(request: Request, { params }: RouteContext<"/api/v2/[user]/gps/zones">) {
  const { user } = await params;
  const auth = await requireJournalOwner(request, user);
  if (!auth.ok) return auth.response;
  return zonesGetDoc(user);
}

export async function PUT(request: Request, { params }: RouteContext<"/api/v2/[user]/gps/zones">) {
  const { user } = await params;
  const auth = await requireJournalOwner(request, user);
  if (!auth.ok) return auth.response;
  return zonesPutResponse(user, request);
}
