import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { receiveInboxUpload } from "@/lib/inboxUpload";
import { listInbox, type InboxEntry } from "@/lib/inbox";

export const dynamic = "force-dynamic";

/**
 * The room's own door into the inbox — B1171.
 *
 * The files pane used to upload photographs straight onto whatever day the
 * preview happened to be about — on a fresh visit, a months-old draft nobody
 * chose — and nothing a person uploaded ever reached "What is waiting". Now
 * the pane's picker lands everything here, in the inbox, where a file that
 * belongs to no day yet is designed to wait (B663); saying "put these on
 * Friday" in the conversation is what files it onto a day.
 *
 * Cookie-only and owner-only, like every `/api/helper/**` route; the
 * validation and storage are `lib/inboxUpload.ts`, shared verbatim with
 * `POST /api/v1/[user]/inbox` so the two doors cannot drift.
 */
export async function POST(
  request: Request,
  { params }: RouteContext<"/api/helper/[user]/inbox">,
) {
  const { user } = await params;
  if (!(await isHelperOwner(user))) {
    return notYourJournal(request, user);
  }
  return receiveInboxUpload(user, request);
}

function mediaItem(entry: InboxEntry) {
  return {
    id: entry.id,
    filename: entry.filename,
    bytes: entry.bytes,
    uploadedAt: entry.uploadedAt,
    ...(entry.lat !== undefined ? { lat: entry.lat } : {}),
    ...(entry.lon !== undefined ? { lon: entry.lon } : {}),
    ...(entry.takenAt ? { takenAt: entry.takenAt } : {}),
    ...(entry.caption ? { caption: entry.caption } : {}),
    ...(entry.location ? { location: entry.location } : {}),
    ...(entry.country ? { country: entry.country } : {}),
  };
}

/**
 * The cookie-side listing `GET /api/v2/[user]/inbox` has always had for an
 * agent's bearer token, and the browser never did — B1830's own gap, named
 * in the brief's "Reuses" table. "What is already staged" (A3, spec §5) is
 * this, narrowed to `media`: a day's own three doors have no use for a
 * waiting bank statement or GPS export, and a person choosing photographs
 * has no reason to see either.
 *
 * **`?kind=files` — B1937.** The location flow's "deliver it" step watches
 * for a Timeline export forwarded over WhatsApp, which lands in the `files`
 * bucket (`lib/inbox.ts:kindForExtension`), not `media`. A plain filename
 * and a timestamp are all a poll needs to notice a new arrival; it still
 * says nothing about what is inside the file.
 */
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/helper/[user]/inbox">,
) {
  const { user } = await params;
  if (!(await isHelperOwner(user))) {
    return notYourJournal(request, user);
  }
  const kind = new URL(request.url).searchParams.get("kind");
  if (kind === "files") {
    const items = listInbox(user).files.map((entry) => ({
      id: entry.id,
      filename: entry.filename,
      uploadedAt: entry.uploadedAt,
    }));
    return Response.json({ ok: true, files: items });
  }
  const items = listInbox(user).media.map(mediaItem);
  return Response.json({ ok: true, media: items });
}
