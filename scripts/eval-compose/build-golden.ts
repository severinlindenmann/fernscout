import "server-only";
import { AS_AUTHOR, getDays } from "../../lib/entries";
import { buildDayContext } from "../../lib/helper/dayContext";
import { getTrips, tripRef } from "../../lib/trips";
import type { Candidate } from "./select-cases";
import { selectVariety } from "./select-cases";
import type { EvalCase } from "./types";

/**
 * The real half of the golden set — B2692. Reads a journal read-only
 * (`CONTENT_DIR`/`EVAL_CONTENT_DIR`, never written to) and picks up to
 * `max` days with words, spread across trips and across short/long via
 * `selectVariety`. The owner's *published* text is read back too, so a
 * person reading `cases.jsonl` can see it beside what `composeDay` made —
 * never fed to the model itself.
 */
export function buildGoldenCases(user: string, max: number): EvalCase[] {
  const candidates: (Candidate & { tripId: string; date: string; slug: string; published: string })[] = [];
  for (const trip of getTrips(user)) {
    const ref = tripRef(user, trip.id);
    for (const day of getDays(ref, AS_AUTHOR)) {
      for (const entry of day.entries) {
        const words = entry.content.split(/\s+/).filter(Boolean).length;
        if (words === 0) continue;
        candidates.push({ id: `golden-${trip.id}-${entry.date}-${entry.slug}`, tripId: trip.id, words, date: entry.date, slug: entry.slug, published: entry.content });
      }
    }
  }

  const chosen = selectVariety(candidates, max);
  const byId = new Map(candidates.map((c) => [c.id, c]));

  const cases: EvalCase[] = [];
  for (const picked of chosen) {
    const c = byId.get(picked.id)!;
    const pack = buildDayContext(user, c.tripId, c.slug);
    if (!pack) continue; // the entry vanished between listing and reading — skip, never invent a pack for it.
    cases.push({ id: c.id, source: "golden", label: `${c.tripId} ${c.date} (${c.words}w)`, pack, published: c.published });
  }
  return cases;
}
