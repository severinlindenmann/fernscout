import "server-only";
import { contactsReady } from "@/lib/api/v2/social";
import { FOREIGN_ORIGIN_REFUSAL, foreignOrigin } from "@/lib/auth/originCheck";
import { isOwner } from "@/lib/contacts/session";

const NOT_FOR_AGENTS = {
  error: "not_for_agents",
  message:
    "Adding a person and telling them is the owner's own door, from a browser — Studio › " +
    "Readers. It never reads an Authorization header (B2291 D1).",
};

/**
 * The owner's cookie, and nothing else — B2292. A request carrying
 * `Authorization` is refused outright rather than falling through to a weaker
 * check; `isOwner` is asked without the request, so a bearer token cannot
 * answer it.
 */
export async function ownerOnly(request: Request, user: string): Promise<Response | null> {
  if (request.headers.get("authorization")) return Response.json(NOT_FOR_AGENTS, { status: 403 });
  // Both doors write grants or spend credits: a present, mismatched Origin is
  // refused (B1559), on top of the cookie's own sameSite.
  if (foreignOrigin(request)) return Response.json(FOREIGN_ORIGIN_REFUSAL, { status: 403 });
  const ready = await contactsReady(user);
  if (!ready.ok) return ready.response;
  if (!(await isOwner(user))) return Response.json({ error: "forbidden" }, { status: 403 });
  return null;
}

export const PRIVATE = { "Cache-Control": "private, no-store" } as const;
