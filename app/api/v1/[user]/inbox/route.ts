import { authenticate, errorResponse, mayActAsOwner, outOfScope, ownsUser } from "@/lib/api/auth";
import { INBOX_KINDS, listInbox } from "@/lib/inbox";
import { receiveInboxUpload } from "@/lib/inboxUpload";

export const dynamic = "force-dynamic";

/**
 * The inbox — somewhere to put a file before it belongs to a day (B663).
 *
 * `POST` takes files with no trip and no day named, which is the whole point:
 * `POST .../trips/<trip>/media` refuses a slug that names no entry, and a
 * camera emptied on the evening it happened has no entries yet. `GET` hands
 * back everything in the bucket with what was said about each file, which is
 * the call an agent makes once before it writes anything.
 *
 * Filing one into a day is the *media* route's third door
 * (`{"day": …, "inbox": [ids]}`), not a fourth verb here: that route already
 * decodes, resizes, strips metadata and attaches to the entry, and a second
 * path into a day's gallery is a second set of rules for what a gallery item
 * may be.
 *
 * **Journal scope only.** The bucket belongs to the journal rather than to a
 * trip, so a trip-scoped token — held by somebody who came on one trip — is
 * refused rather than shown every file everybody has staged. Their door is
 * the trip's own media route, which is unchanged.
 *
 * The upload itself lives in `lib/inboxUpload.ts` since B1171, shared with
 * the room's own cookie door (`POST /api/helper/[user]/inbox`) — one set of
 * rules for what the inbox takes, behind two authentications.
 */

/** A trip-scoped token, told what it may use instead. */
function needsJournalScope(user: string): Response {
  return Response.json(
    {
      error: "out_of_scope",
      message:
        "This token is scoped to one trip, and the inbox belongs to the whole journal — " +
        `it would show you files staged for trips you are not on. Upload to ` +
        `\`POST /api/v1/${user}/trips/<trip>/media\` instead, which needs the day to exist.`,
    },
    { status: 403 },
  );
}

export async function GET(request: Request, { params }: RouteContext<"/api/v1/[user]/inbox">) {
  const auth = await authenticate(request);
  if (!auth.ok) return errorResponse(auth);

  const { user } = await params;
  if (!ownsUser(auth.session, user)) return outOfScope(auth.session, user);
  if (!mayActAsOwner(auth.session, user)) return needsJournalScope(user);

  const items = listInbox(user);
  const counts = Object.fromEntries(
    INBOX_KINDS.map((kind) => [kind, items[kind].length]),
  );
  const bytes = Object.values(items)
    .flat()
    .reduce((n, entry) => n + entry.bytes, 0);

  return Response.json({
    user,
    counts,
    bytes,
    items,
    next:
      bytes === 0
        ? "Nothing is staged. Upload files here when the days they belong to do not exist yet."
        : "Write the days these belong to, then send their ids as " +
          `\`{"day": "<slug>", "inbox": ["<id>", …]}\` to ` +
          `POST /api/v1/${user}/trips/<trip>/media. That files them into the day and takes ` +
          "them out of the inbox. Never guess which day a photograph belongs to — ask.",
  });
}

export async function POST(request: Request, { params }: RouteContext<"/api/v1/[user]/inbox">) {
  const auth = await authenticate(request);
  if (!auth.ok) return errorResponse(auth);

  const { user } = await params;
  if (!ownsUser(auth.session, user)) return outOfScope(auth.session, user);
  if (!mayActAsOwner(auth.session, user)) return needsJournalScope(user);

  return receiveInboxUpload(user, request);
}
