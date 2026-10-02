// GET /api/helper/{user}/tags?trip=&q= — B2675, "tags used before".
//
// The journal's own earlier day tags, most used first, with no AI call at
// all: `tagsUsedBefore` (`lib/studio/tagsUsedBefore.ts`) scans the entries
// already on disk. Cookie only, owner only — the same shape every other
// `app/api/helper/` route takes (see `../day/route.ts`'s own comment): a
// browser page, not a second bearer-accepting surface `/openapi.json` would
// then be lying about.
import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { tagsUsedBefore } from "@/lib/studio/tagsUsedBefore";

export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: RouteContext<"/api/helper/[user]/tags">) {
  const { user } = await params;
  if (!(await isHelperOwner(user))) return notYourJournal(request, user);

  const url = new URL(request.url);
  const trip = url.searchParams.get("trip")?.trim() || undefined;
  const q = url.searchParams.get("q")?.trim() || undefined;

  return Response.json({ ok: true, tags: tagsUsedBefore(user, { trip, q }) });
}
