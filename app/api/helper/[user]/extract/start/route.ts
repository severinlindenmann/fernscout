import "server-only";
import { isEnabled } from "@/lib/capabilities";
import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { writeManifest } from "@/lib/staging/manifest";
import { newRunId } from "@/lib/staging/paths";
import { RUN_TTL_MS, sweepStaging } from "@/lib/staging/sweep";

export const dynamic = "force-dynamic";

/**
 * Open an import run — B1751.
 *
 * Cookie only, bearer refused: `isHelperOwner` is the gate every other route
 * under `app/api/helper/` uses, and this one stages hundreds of megabytes on
 * somebody's behalf.
 *
 * The sweep runs here rather than on a schedule. A run nobody returns to is
 * cleared by the next person who starts one, and on a one-owner instance that
 * is the same person — which is the whole of what this needs.
 */
export async function POST(
  request: Request,
  { params }: RouteContext<"/api/helper/[user]/extract/start">,
) {
  const { user } = await params;
  if (!isEnabled("extract", user)) {
    return Response.json({ error: "extract_disabled" }, { status: 404 });
  }
  if (!(await isHelperOwner(user))) {
    return notYourJournal(request, user);
  }

  const now = new Date();
  sweepStaging(now);

  const body = (await request.json().catch(() => ({}))) as { tripId?: string; mode?: string };
  const runId = newRunId(now);
  const expiresAt = new Date(now.getTime() + RUN_TTL_MS).toISOString();
  writeManifest(user, {
    version: 1,
    runId,
    owner: user,
    createdAt: now.toISOString(),
    expiresAt,
    tripId: typeof body.tripId === "string" && body.tripId !== "" ? body.tripId : null,
    mode: body.mode === "voice" ? "voice" : "type",
    state: "uploading",
    photos: [],
    days: [],
  });
  return Response.json({ runId, expiresAt });
}
