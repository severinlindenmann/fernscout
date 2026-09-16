import "server-only";
import { isEnabled } from "@/lib/capabilities";
import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { extendOnTouch } from "@/lib/staging/expiry";
import { readManifest, writeManifest } from "@/lib/staging/manifest";

export const dynamic = "force-dynamic";

const MAX_PARTY = 20;
const MAX_NAME_LENGTH = 100;

/**
 * "How many of you went?" and their names — S8a, B1803 Task 3.6.
 *
 * Deliberately not `lib/api/tripParty.ts`'s `PATCH .../trip/people` — that
 * list grants write access to the whole trip and refuses an entry with no
 * email (`peopleBlock`). This is the opposite kind of fact: purely
 * descriptive, nobody's address required, and it never leaves this run's
 * own manifest for `trip.json` or anywhere a reader could see it — see the
 * reassurance on the screen itself ("never shown to anyone you haven't let
 * in") and `RunManifest.partySize`'s own doc comment.
 */
export async function PATCH(
  request: Request,
  { params }: RouteContext<"/api/helper/[user]/extract/party">,
) {
  const { user } = await params;
  if (!isEnabled("extract", user)) {
    return Response.json({ error: "extract_disabled" }, { status: 404 });
  }
  if (!(await isHelperOwner(user))) {
    return notYourJournal(request, user);
  }

  const body = (await request.json().catch(() => null)) as {
    run?: string;
    size?: number;
    names?: unknown;
  } | null;
  if (!body || typeof body.run !== "string") {
    return Response.json({ error: "invalid_body" }, { status: 400 });
  }
  if (typeof body.size !== "number" || !Number.isInteger(body.size) || body.size < 1 || body.size > MAX_PARTY) {
    return Response.json({ error: "invalid_size" }, { status: 400 });
  }
  if (body.names !== undefined && !Array.isArray(body.names)) {
    return Response.json({ error: "invalid_names" }, { status: 400 });
  }
  const names = (Array.isArray(body.names) ? body.names : [])
    .filter((n): n is string => typeof n === "string")
    .map((n) => n.trim().slice(0, MAX_NAME_LENGTH))
    .slice(0, MAX_PARTY);

  const manifest = readManifest(user, body.run);
  if (!manifest) return Response.json({ error: "no_such_run" }, { status: 404 });

  const extended = extendOnTouch(manifest, new Date());
  const current = extended ?? manifest;
  current.partySize = body.size;
  current.partyNames = names;
  writeManifest(user, current);

  return Response.json({ ok: true, partySize: current.partySize, partyNames: current.partyNames });
}
