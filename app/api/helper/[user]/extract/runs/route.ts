import "server-only";
import { isEnabled } from "@/lib/capabilities";
import { groupIntoDays } from "@/lib/extract/group";
import { extendOnTouch } from "@/lib/staging/expiry";
import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { listRuns, writeManifest, type RunManifest } from "@/lib/staging/manifest";

export const dynamic = "force-dynamic";

/** One run as this route hands it back — the manifest, whether this very
 *  request is what just extended it (which `resumeExpiryState`,
 *  `lib/staging/expiry.ts`, needs to tell "you were just extended" from
 *  "you were extended a while ago" — both leave the same fields set on
 *  `run` itself), and how many of its days still have open questions.
 *
 * **`daysLeftToTell` is computed here, not on the resume screen.**
 * `groupIntoDays` pulls in `lib/ingest/cluster.ts` for its distance check,
 * which reaches `lib/ingest/geo.ts` and `node:fs` — nothing marks that chain
 * `server-only`, but a client component that imports it anyway drags
 * `node:fs` into the browser bundle and Turbopack refuses the build outright
 * rather than shipping it. This route already has everything the count
 * needs, so it is one more field on the response instead. */
export type RunSummary = RunManifest & { justExtended: boolean; daysLeftToTell: number };

function daysLeftToTell(run: RunManifest): number {
  const live = run.photos.filter((p) => !p.dropped);
  const groups = groupIntoDays(live);
  const committed = new Set(run.days.filter((d) => d.committed).map((d) => d.date));
  return groups.filter((g) => !g.undated && !committed.has(g.date)).length;
}

/**
 * List this owner's own live import runs, newest first — B1751 Task 4.3,
 * the resume screen's data.
 *
 * `listRuns` already does the listing and the sort; this route is the gate
 * plus one thing `listRuns` itself cannot do: touch. Landing on the screen
 * that shows "here's where you left off" is itself coming back to an import
 * — the same authenticated touch every other route under
 * `app/api/helper/[user]/extract/` already carries via `extendOnTouch`, and
 * the one that lets the resume screen say, truthfully and in the past
 * tense, that arriving *is* the extension rather than a button still to
 * press.
 */
export async function GET(
  request: Request,
  { params }: RouteContext<"/api/helper/[user]/extract/runs">,
) {
  const { user } = await params;
  if (!isEnabled("extract", user)) {
    return Response.json({ error: "extract_disabled" }, { status: 404 });
  }
  if (!(await isHelperOwner(user))) {
    return notYourJournal(request, user);
  }

  const now = new Date();
  const runs: RunSummary[] = listRuns(user).map((run) => {
    const extended = extendOnTouch(run, now);
    const current = extended ?? run;
    if (extended) writeManifest(user, extended);
    return { ...current, justExtended: Boolean(extended), daysLeftToTell: daysLeftToTell(current) };
  });

  return Response.json({ runs });
}
