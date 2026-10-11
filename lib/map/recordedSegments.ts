import { legModeFromRecorded } from "./legMode";
import { mayBridge } from "./mapSafety";
import type { RecordedSegment } from "./tripFrame";

export type DayTrack = {
  date?: string;
  points: [number, number][];
  mode?: string;
  /** A hidden spot was cut out right before / after this piece (`readerTrack`). */
  cutBefore?: boolean;
  cutAfter?: boolean;
};

/**
 * Recorded GPS, attributed to a day number — B2537, reworked in B-2980.
 * `dayByDate` maps a date to the day number of the place it is drawn as, so
 * a stay merged over several days (`getPlaces`) draws every one of its days'
 * lines under the number the place carries. Two runs of one day are joined by
 * a short dashed "gap" bridge only when the hole is under 2 km and neither piece
 * is flagged as cut next to the other (zone, hidden spot or hidden stretch,
 * flagged at derivation and at serve time): a straight line across a cut
 * would draw what the owner hid. Files derived before the flags existed carry
 * none, so there only the 2 km rule applies.
 */
export function recordedSegmentsFor(
  trackByDay: readonly DayTrack[],
  dayByDate: ReadonlyMap<string, number>,
): RecordedSegment[] {
  const byDate = new Map<string, DayTrack[]>();
  for (const seg of trackByDay) {
    if (!seg.date || seg.points.length === 0) continue;
    const list = byDate.get(seg.date) ?? [];
    list.push(seg);
    byDate.set(seg.date, list);
  }
  const out: RecordedSegment[] = [];
  for (const [date, segs] of byDate) {
    const day = dayByDate.get(date);
    if (day === undefined) continue;
    segs.forEach((seg, i) => {
      const { points, mode } = seg;
      if (points.length >= 2) {
        out.push({ day, points: points.map(([lat, lng]) => ({ lat, lng })), mode: legModeFromRecorded(mode) ?? undefined });
      }
      const next = segs[i + 1];
      if (!next || points.length === 0 || next.points.length === 0) return;
      const a = points[points.length - 1];
      const b = next.points[0];
      const cut = seg.cutAfter || next.cutBefore;
      if (!cut && mayBridge({ lat: a[0], lng: a[1] }, { lat: b[0], lng: b[1] }, true)) {
        out.push({ day, points: [a, b].map(([lat, lng]) => ({ lat, lng })), gap: true });
      }
    });
  }
  return out;
}
