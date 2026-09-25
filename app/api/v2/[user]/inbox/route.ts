// GET /api/v2/{user}/inbox — B1624, phase 2 step 4.
// docs/plans/2026-09-12-api-v2/content.md §11. Composes with journalStatus's
// own inbox counts rather than duplicating them — same numbers. Uploading
// into the inbox is no longer its own verb: it is the media door with
// trip/day declined (POST /api/v2/{user}/media).
import { inboxList } from "@/lib/api/v2/schemas";
import { fail, ok } from "@/lib/api/v2/route";
import { requireJournalOwner } from "@/lib/api/v2/auth";
import { ERROR_CODES } from "@/lib/api/errorCodes";
import { listInbox, type InboxEntry } from "@/lib/inbox";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

function itemOf(entry: InboxEntry) {
  return {
    id: entry.id,
    filename: entry.filename,
    bytes: entry.bytes,
    stagedAt: entry.uploadedAt,
    ...(entry.caption ? { caption: entry.caption } : {}),
    // Measured off the photograph itself, never guessed — B1842. `takenAt`
    // survives with no `measuredFrom` too: a person may have typed it.
    ...(entry.takenAt ? { takenAt: entry.takenAt } : {}),
    ...(entry.lat !== undefined ? { lat: entry.lat } : {}),
    ...(entry.lon !== undefined ? { lon: entry.lon } : {}),
    ...(entry.measuredFrom ? { measuredFrom: entry.measuredFrom } : {}),
  };
}

export async function GET(request: Request, { params }: RouteContext<"/api/v2/[user]/inbox">) {
  const { user } = await params;
  if (!getUser(user)) return fail("no_such_journal", ERROR_CODES.no_such_journal, undefined, 404);

  const auth = await requireJournalOwner(request, user);
  if (!auth.ok) return auth.response;

  const items = listInbox(user);
  const doc = inboxList.parse({
    counts: { media: items.media.length, files: items.files.length },
    items: { media: items.media.map(itemOf), files: items.files.map(itemOf) },
  });
  return ok(doc);
}
