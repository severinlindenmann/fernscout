// GET /api/web/{user}/postcards/recipients — the owner's own postcard sheet,
// from a cookie — B1674 (the PostcardSheet half; the v1 door it used to call
// is gone, and this is the missing cookie-side proxy B1595 built the pattern
// for).
//
// v2's postcards door is bearer-only (`requireJournalOwner`, which reads
// `Authorization` and nothing else), and a browser must never hold a bearer
// token (decision 24). This is the cookie-side door: `isOwner` on the cookie
// only — any `Authorization` header is refused outright rather than falling
// through to a weaker check — and then `postcardRecipientsDoc`, the exact
// function `GET /api/v2/{user}/postcards/recipients` calls after its own
// bearer check, in process. No bearer token is minted, held, or sent
// anywhere for this call.
//
// Replaces `components/PostcardSheet.tsx`'s fetch of the deleted
// `/api/v1/{user}/postcards/recipients`.
import { postcardRecipientsDoc } from "@/app/api/v2/[user]/postcards/recipients/route";
import { postcardsReady } from "@/lib/api/v2/postcards";
import { isOwner } from "@/lib/contacts/session";

export const dynamic = "force-dynamic";

const NOT_FOR_AGENTS = {
  error: "not_for_agents",
  message:
    "This is the owner's own door, from a browser. An agent reads candidates with " +
    "GET /api/v2/{user}/postcards/recipients.",
};

export async function GET(
  request: Request,
  { params }: RouteContext<"/api/web/[user]/postcards/recipients">,
) {
  if (request.headers.get("authorization")) {
    return Response.json(NOT_FOR_AGENTS, { status: 403 });
  }
  const { user } = await params;
  const ready = postcardsReady(user);
  if (!ready.ok) return ready.response;
  if (!(await isOwner(user))) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  return postcardRecipientsDoc(user);
}
