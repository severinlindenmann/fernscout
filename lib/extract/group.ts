import { clusterMedia, type Locatable } from "@/lib/ingest/cluster";
import type { PhotoRow } from "@/lib/staging/manifest";

export type DayGroup = {
  date: string;
  photoIds: string[];
  lat?: number;
  lng?: number;
  undated: boolean;
};

type LocatablePhoto = Locatable & { id: string };

/**
 * `PhotoRow.takenAt` is a wall-clock reading with no zone — the same shape
 * `wallClockMs` expects, just carried as a string instead of the EXIF
 * library's struct. Appending "Z" makes `Date.parse` read it the same way
 * `wallClockMs` builds it: as if the wall-clock reading were UTC, which is
 * wrong about the traveller's actual zone but consistent for every photo, and
 * consistency is all clustering needs.
 */
function takenAtMs(takenAt: string): number {
  return Date.parse(`${takenAt}Z`);
}

/**
 * Turns a run's flat `PhotoRow[]` into day-shaped groups.
 *
 * A photograph with no `takenAt` never reaches `clusterMedia` — there is no
 * wall-clock reading to sort it by, and every alternative (a neighbour's
 * time, the file's own mtime, today's date) is inventing a date nothing on
 * the photograph or from the person supports. So undated rows are pulled out
 * up front and returned as one `undated: true` group with an empty date,
 * leaving which day they belong to as a question for the person, asked later
 * in the flow — the same stance `analyseStaged` already takes when it reads
 * a file with no EXIF date.
 */
export function groupIntoDays(photos: PhotoRow[]): DayGroup[] {
  const dated: LocatablePhoto[] = [];
  const undatedIds: string[] = [];

  for (const photo of photos) {
    if (photo.takenAt) {
      dated.push({ id: photo.id, takenAtMs: takenAtMs(photo.takenAt), lat: photo.lat, lng: photo.lng });
    } else {
      undatedIds.push(photo.id);
    }
  }

  // `clusterMedia`'s gap/distance rules split entries *within* a day on
  // purpose (`DEFAULT_GAP_HOURS`, `DEFAULT_SPLIT_KM` — see cluster.ts): a
  // museum morning and a dinner across town come back as two clusters
  // sharing one date. A day board wants one row per calendar day, so
  // same-date clusters are coalesced here rather than by widening
  // `clusterMedia`'s options, which are right for what they do.
  const byDate = new Map<string, ReturnType<typeof clusterMedia<LocatablePhoto>>>();
  for (const cluster of clusterMedia(dated)) {
    const list = byDate.get(cluster.date);
    if (list) list.push(cluster);
    else byDate.set(cluster.date, [cluster]);
  }

  const groups: DayGroup[] = [];
  for (const clusters of byDate.values()) {
    if (clusters.length === 1) {
      const [c] = clusters;
      groups.push({ date: c.date, photoIds: c.items.map((i) => i.id), lat: c.lat, lng: c.lng, undated: false });
      continue;
    }
    // `clusterMedia` sorts its input chronologically and returns clusters in
    // that same order, so clusters sharing a date are already adjacent and
    // concatenating their items keeps the union chronological.
    const photoIds = clusters.flatMap((c) => c.items.map((i) => i.id));
    // The largest contributing cluster's own coordinate, not an average —
    // a mean of two real places is a third place nobody went.
    const largest = clusters.reduce((a, b) => (b.items.length > a.items.length ? b : a));
    groups.push({ date: largest.date, photoIds, lat: largest.lat, lng: largest.lng, undated: false });
  }

  if (undatedIds.length > 0) {
    groups.push({ date: "", photoIds: undatedIds, undated: true });
  }

  return groups;
}
