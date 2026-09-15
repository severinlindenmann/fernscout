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

  const groups: DayGroup[] = clusterMedia(dated).map((cluster) => ({
    date: cluster.date,
    photoIds: cluster.items.map((item) => item.id),
    lat: cluster.lat,
    lng: cluster.lng,
    undated: false,
  }));

  if (undatedIds.length > 0) {
    groups.push({ date: "", photoIds: undatedIds, undated: true });
  }

  return groups;
}
