// GET /api/web/{user}/postcards/texts?trip= — the owner's own postcard
// sheet, from a cookie — B1674 (the PostcardSheet half). Same shape as
// `.../postcards/recipients` beside it.
//
// `isOwner` on the cookie only, then `postcardTextsDoc`, the exact function
// `GET /api/v2/{user}/postcards/texts` calls after its own bearer check, in
// process. No bearer token is minted, held, or sent anywhere for this call.
//
// Replaces `components/PostcardSheet.tsx`'s fetch of the deleted
// `/api/v1/{user}/postcards/texts`.
import { postcardTextsDoc } from "@/app/api/v2/[user]/postcards/texts/route";
import { postcardsReady } from "@/lib/api/v2/postcards";
import { isOwner } from "@/lib/contacts/session";

export const dynamic = "force-dynamic";

const NOT_FOR_AGENTS = {
  error: "not_for_agents",
  message:
    "This is the owner's own door, from a browser. An agent reads prefill text with " +
    "GET /api/v2/{user}/postcards/texts.",
};

export async function GET(
  request: Request,
  { params }: RouteContext<"/api/web/[user]/postcards/texts">,
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
  return postcardTextsDoc(user, request);
}
