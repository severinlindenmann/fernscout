import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { receiveInboxUpload } from "@/lib/inboxUpload";

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
