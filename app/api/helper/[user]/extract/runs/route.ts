import "server-only";
import { isEnabled } from "@/lib/capabilities";
import { groupIntoDays } from "@/lib/extract/group";
import { isHelperOwner, notYourJournal } from "@/lib/helper/server";
import { listRuns, type RunManifest } from "@/lib/staging/manifest";

export const dynamic = "force-dynamic";

/** One run as this route hands it back — the manifest, unmodified, plus how
 *  many of its days still have open questions.
 *
 * **`daysLeftToTell` is computed here, not on the resume screen.**
 * `groupIntoDays` pulls in `lib/ingest/cluster.ts` for its distance check,
 * which reaches `lib/ingest/geo.ts` and `node:fs` — nothing marks that chain
 * `server-only`, but a client component that imports it anyway drags
 * `node:fs` into the browser bundle and Turbopack refuses the build outright
 * rather than shipping it. This route already has everything the count
 * needs, so it is one more field on the response instead. */
export type RunSummary = RunManifest & { daysLeftToTell: number };

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
 * **Read-only.** An earlier version of this route called `extendOnTouch` on
 * every run it listed, on the reasoning that landing on "here's where you
 * left off" is itself coming back to an import. It is not: opening a *list*
 * is not continuing a *run* — the owner's own rule ("continuing the run
 * after the warning extends it, once") is about a specific run somebody
 * chose to act on, and extending every abandoned run in the list the moment
 * somebody merely glances at it spends each one's single extension without
 * a choice, and holds their photographs on the server two days longer than
 * the rule intends. This route now only reads: `listRuns` already does the
 * listing and the sort, and there is nothing else for it to do.
 *
 * The actual extension still happens exactly once, the moment a run is
 * actually resumed — `GET .../extract/run`'s own `extendOnTouch` call,
 * unchanged, fires the instant `DayBoard` loads the picked run. Nothing new
 * was added there; this route simply stopped duplicating it.
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

  const runs: RunSummary[] = listRuns(user).map((run) => ({ ...run, daysLeftToTell: daysLeftToTell(run) }));
  return Response.json({ runs });
}
