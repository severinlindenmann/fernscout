// GET/POST /api/web/{user}/story-link — the "Ask to read along" link
// (B2665 round 2). The owner's own door, from a browser; an Authorization
// header is refused outright, the same as every sibling route under
// `/api/web/<user>/readers/*` — there is no agent bearer equivalent for a
// door that lets somebody in.
import { readJsonBody } from "@/lib/api/jsonBody";
import { requestLocale } from "@/lib/locales";
import { parseLocale } from "@/lib/contacts/locale";
import { ownerOnly, PRIVATE } from "@/lib/readers/ownerDoor";
import { ensureStoryLink, pauseStoryLink, resumeStoryLink, storyLinkState } from "@/lib/contacts/storyLink";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: RouteContext<"/api/web/[user]/story-link">) {
  const { user } = await params;
  const denied = await ownerOnly(request, user);
  if (denied) return denied;
  return Response.json(await storyLinkState(user), { headers: PRIVATE });
}

/**
 * `{ action: "start" | "pause" | "resume" }` — every call an explicit owner
 * press. `start` creates the link once and is idempotent afterwards; it
 * never un-pauses a paused link. `resume` is the one action that does, and
 * only when the owner presses it themselves.
 */
export async function POST(request: Request, { params }: RouteContext<"/api/web/[user]/story-link">) {
  const { user } = await params;
  const denied = await ownerOnly(request, user);
  if (denied) return denied;
  const jsonBody = await readJsonBody(request);
  if (!jsonBody.ok) return jsonBody.response;
  const body = (jsonBody.value ?? {}) as Record<string, unknown>;

  switch (body.action) {
    case "start": {
      const locale = parseLocale(await requestLocale()) ?? parseLocale(getUser(user)?.defaultLocale) ?? "en";
      return Response.json(await ensureStoryLink(user, locale), { headers: PRIVATE });
    }
    case "pause": {
      await pauseStoryLink(user);
      return Response.json(await storyLinkState(user), { headers: PRIVATE });
    }
    case "resume": {
      return Response.json(await resumeStoryLink(user), { headers: PRIVATE });
    }
    default:
      return Response.json({ error: "invalid_request" }, { status: 400, headers: PRIVATE });
  }
}
