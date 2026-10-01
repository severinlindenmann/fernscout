import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { importPolarsteps, isPolarstepsRefusal } from "@/lib/polarsteps/api";
import { readJsonBody } from "@/lib/api/jsonBody";

export const dynamic = "force-dynamic";

/**
 * The cookie-only door onto `lib/polarsteps/api.ts` — B2662.
 *
 * `POST /api/v2/{user}/import` already has a `kind: "polarsteps"`, but it
 * is a bearer-token door (B671's whole shape), and the studio's own import
 * screen holds a browser cookie, never a token (same reason
 * `POST /api/helper/{user}/import` exists beside the gps kind's v2 door).
 * This route is that same pattern for the one new kind: no model, no
 * second parser, just `isHelperOwner` and a direct call into the real
 * domain function — `importPolarsteps` is exactly what the v2 route calls
 * too, so the two doors cannot answer differently for the same bytes.
 *
 * `{ text, dryRun }` — `text` is one trip.json, read client-side out of
 * the export ZIP (`lib/zip/readZip.ts`); `dryRun` previews without writing
 * anything, same contract as every other import door here.
 */
export async function POST(request: Request, { params }: RouteContext<"/api/helper/[user]/polarsteps">) {
  const { user } = await params;
  if (!(await isHelperOwner(user))) {
    return notYourJournal(request, user);
  }

  const jsonBody = await readJsonBody(request);
  if (!jsonBody.ok) return jsonBody.response;
  const body = jsonBody.value as { text?: unknown; dryRun?: unknown } | null;
  if (!body || typeof body.text !== "string") {
    return Response.json({ error: "no_file" }, { status: 400 });
  }

  const result = importPolarsteps(user, body.text, { dryRun: body.dryRun === true });
  if (isPolarstepsRefusal(result)) {
    return Response.json({ error: result.refusal, message: result.message, problems: result.problems }, { status: 400 });
  }
  return Response.json({ ok: true, ...result });
}
