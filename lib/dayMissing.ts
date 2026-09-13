import "server-only";
import { listDayInbox } from "./inbox";
import { readDayReadiness, readWords } from "./dayReadiness";
import { CARD_PREFILL_TRACKS, TRACKS, missingFrom, type DayFacts, type Track, type Tracks } from "./tracks";
import { isEnabled } from "./capabilities";

export type DayFolderMissing =
  | { field: Track; why: string; send: string; decline: string; unknown: string }
  | { field: "weather"; why: string }
  | { field: "caption"; why: string; photoId: string; filename: string };

/**
 * What a date folder still owes before `assemble_day` may propose creating
 * the real entry — Phase 3's whole reason to exist.
 *
 * Reuses `lib/tracks.ts`'s own `missingFrom` for the three registered rows
 * (`costs`, `coordinates`, `photos` — though `photos` is a `publish` row and
 * is asked `"write"` here, matching `start_day`'s own choice to only ask
 * `write`-time rows before an entry exists), and adds two more the registry
 * does not carry: `weather` (asked only once a coordinate exists — day.json's
 * `location` — and the capability is on) and one `caption` question per
 * photograph still missing one.
 */
export function missingForDayFolder(username: string, date: string, tripTracks: Tracks): DayFolderMissing[] {
  const readiness = readDayReadiness(username, date);
  const staged = listDayInbox(username, date);
  const words = readWords(username, date);

  const facts: DayFacts = {
    costs: false, // a date folder never carries costs directly in this phase
    coordinates: readiness.location !== undefined,
    photos: staged.media.length > 0,
    // The four rows B1650 added are never this card's to pre-fill (see the
    // note on `CARD_PREFILL_TRACKS` in lib/tracks.ts) — restricting `tracks`
    // below to that constant is what keeps them off this survey regardless
    // of what these three placeholder values say.
    time: false,
    transportMode: false,
    tags: false,
    visibility: false,
    without: readiness.without,
    unrecorded: readiness.unrecorded,
  };
  // Only the rows this card may pre-fill a default for — B1650's own rows
  // are asked for real once the create attempt itself refuses, never
  // pre-filled here. See the note on `CARD_PREFILL_TRACKS`.
  const cardTracks = Object.fromEntries(
    TRACKS.map((row) => [row, tripTracks[row] && CARD_PREFILL_TRACKS.includes(row)]),
  ) as Tracks;
  const registered = missingFrom(facts, cardTracks, "write");

  const out: DayFolderMissing[] = [...registered];

  const hasCoordinate = readiness.location !== undefined;
  if (hasCoordinate && !readiness.weatherAsked && isEnabled("weather", username)) {
    out.push({
      field: "weather",
      why: "This day has a place to look weather up for, and nobody has said whether to.",
    });
  }

  for (const photo of staged.media) {
    if (photo.caption || photo.descriptionAsked) continue;
    out.push({
      field: "caption",
      why: `${photo.filename} has no caption yet.`,
      photoId: photo.id,
      filename: photo.filename,
    });
  }

  // `words` is read but deliberately not turned into a `Missing` entry here:
  // whether prose is owed is Task 2's own "ready to propose" gate, not a
  // per-field question — an empty date folder with only a location pin and
  // no words at all is still allowed to ask "anything to say about this
  // day?" as part of the same batch, which Task 2 composes.
  void words;

  return out;
}
