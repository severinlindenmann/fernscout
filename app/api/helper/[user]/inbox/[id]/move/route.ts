import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { DAY_RE, findInboxFile, moveInboxFileFromDay, moveInboxFileToDay } from "@/lib/inbox";
import { readJsonBody } from "@/lib/api/jsonBody";

export const dynamic = "force-dynamic";

/**
 * File a waiting item onto a day, or take it back off one — B1990, body and
 * rollback hardened by B1993.
 *
 * `lib/inbox.ts`'s `moveInboxFileToDay`/`moveInboxFileFromDay` have existed
 * since Phase 2 with no route of their own; the studio inbox page is the
 * first owner-facing screen that needs to call them. Owner cookie only, same
 * as every route under `app/api/helper/` (AGENTS.md: agent bearer tokens
 * reach `/api/**`, never a rendered owner page — and the converse holds too,
 * a cookie-only family never reads `Authorization`).
 *
 * **Body:** `{ "day": "YYYY-MM-DD" | null }` — the destination. `null` means
 * "back to waiting". A body that is not a plain object (`true`, an array, a
 * bare string) or is missing the `day` key is `400 invalid_json` — B1993:
 * `"day" in body` throws on a non-object, which used to surface as a 500.
 * **`?day=`** names the *source* day when the file is presently filed under
 * one; absent means it is sitting in the flat bucket. Both a body date and a
 * query date are checked against the same strict `DAY_RE` the delete and
 * thumbnail routes use before either is trusted — `moveInboxFileToDay`/
 * `moveInboxFileFromDay` do no validation of their own and join their `date`
 * argument straight into a directory name.
 *
 * Four shapes fall out of "source day present or not" × "destination day
 * present or not":
 *  - no source, a destination → `moveInboxFileToDay` (waiting → a day)
 *  - a source, no destination → `moveInboxFileFromDay` (a day → waiting)
 *  - a source, a destination → the two calls composed (a day → a different
 *    day); there is no single "move between two day folders" function in
 *    `lib/inbox.ts`, so this is that move written as its own two steps
 *    rather than a third primitive with one caller. If the second step fails
 *    after the first already ran, the file is moved back onto `source`
 *    (B1993) rather than left stranded in the flat bucket, and the answer is
 *    `409 move_failed` rather than the misleading 404 this used to give.
 *  - neither → nothing to do; answered as the file's current state
 *    (`200 { ok: true, id, day: null }`, found via `findInboxFile` since no
 *    source means the flat bucket is where it must be) rather than refused —
 *    asking to move something to where it already is is not a caller error.
 *    This is the exact live shape from the ticket: a sheet defaulting to
 *    "back to waiting" for a file that has no source day sends `{day:null}`
 *    with no `?day=` and must not 404. An id naming nothing at all is still
 *    `404 unknown_inbox_file`.
 *
 * The id is resolved by every one of those functions through
 * `path.basename`, the same traversal guard `findInboxFile`'s own doc
 * comment explains — never joined into a path directly here.
 */
export async function POST(
  request: Request,
  { params }: RouteContext<"/api/helper/[user]/inbox/[id]/move">,
) {
  const { user, id } = await params;
  if (!(await isHelperOwner(user))) {
    return notYourJournal(request, user);
  }

  const jsonBody = await readJsonBody(request);
  if (!jsonBody.ok) return jsonBody.response;
  const parsed = jsonBody.value;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed) || !("day" in parsed)) {
    return Response.json({ error: "invalid_json" }, { status: 400 });
  }
  const body = parsed as Record<string, unknown>;
  const destination = body.day;
  if (destination !== null && (typeof destination !== "string" || !DAY_RE.test(destination))) {
    return Response.json({ error: "invalid_day" }, { status: 400 });
  }

  const source = new URL(request.url).searchParams.get("day");
  if (source !== null && !DAY_RE.test(source)) {
    return Response.json({ error: "invalid_day" }, { status: 400 });
  }

  if (source && destination) {
    const removed = moveInboxFileFromDay(user, source, id);
    if (!removed) {
      return Response.json({ error: "unknown_inbox_file" }, { status: 404 });
    }
    // The second step failed after the first already ran: the bytes and
    // sidecar are presently sitting in the flat bucket, not where the
    // caller (or the file's own owner) expects them. Put them back on
    // `source` rather than leaving a "waiting" file that was never supposed
    // to be there — a thrown fs error (a full disk, a permission problem)
    // and a bare `null` return (the file vanished between the two steps)
    // both count as "failed" here.
    try {
      const added = moveInboxFileToDay(user, id, destination);
      if (!added) throw new Error("unknown_inbox_file");
      return Response.json({ ok: true, id: added.entry.id, day: destination });
    } catch {
      try {
        moveInboxFileToDay(user, id, source);
      } catch {
        // Best effort — the file is still findable via `moveInboxFileFromDay`
        // idempotence is not guaranteed here, but there is nothing better to
        // do than report the failure and leave it wherever it landed.
      }
      return Response.json({ error: "move_failed" }, { status: 409 });
    }
  }

  if (source && !destination) {
    const moved = moveInboxFileFromDay(user, source, id);
    if (!moved) {
      return Response.json({ error: "unknown_inbox_file" }, { status: 404 });
    }
    return Response.json({ ok: true, id: moved.entry.id, day: null });
  }

  if (!source && destination) {
    const moved = moveInboxFileToDay(user, id, destination);
    if (!moved) {
      return Response.json({ error: "unknown_inbox_file" }, { status: 404 });
    }
    return Response.json({ ok: true, id: moved.entry.id, day: destination });
  }

  // Neither a source nor a destination: nothing to do. Report the file's
  // current state rather than refusing — see the doc comment above.
  const found = findInboxFile(user, id);
  if (!found) {
    return Response.json({ error: "unknown_inbox_file" }, { status: 404 });
  }
  return Response.json({ ok: true, id: found.entry.id, day: null });
}
