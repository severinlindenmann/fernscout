import "server-only";
import { readStagedFile } from "@/lib/staging/store";
import { readManifest, writeManifest, type PhotoRow, type RunManifest } from "@/lib/staging/manifest";
import { storeInboxFile, moveInboxFileToDay, updateInboxMeta, type InboxMeta } from "@/lib/inbox";
import { appendWords, readDayReadiness, writeDayReadiness } from "@/lib/dayReadiness";
import { withStorageQuota } from "@/lib/storageQuota";
import { getTrip, tripRef } from "@/lib/trips";
import { createTrip } from "@/lib/tripWrite";
import { TRACKS, TRACK_ROWS } from "@/lib/tracks";

/**
 * Move one confirmed day out of staging and into the journal.
 *
 * **The quota is checked here and nowhere earlier.** Staging deliberately
 * costs a journal nothing; the moment bytes cross into `content/<user>` they
 * are the journal's. So this is the one call that can refuse — and it refuses
 * *before* moving anything, because a half-committed day is worse than a
 * refused one.
 *
 * `storeInboxFile` + `moveInboxFileToDay` put the photographs where
 * `inbox/days/<date>/` expects them, `appendWords` writes the `words.md` that
 * path already reads, and the trip this day joins is ensured (created once,
 * from the run's own real date span, never a place name nobody supplied) so
 * `assemble-day` has something to write into. Every track the person was
 * never asked about is recorded as `unrecorded` — a true statement about the
 * day ("nobody has decided yet") rather than an invented answer — so
 * `assemble-day`'s own `incomplete_day` gate has nothing left to ask before
 * it creates the entry. Creating the entry itself stays `assemble-day`'s own
 * job: it is reachable only as an HTTP handler (`isHelperOwner`, `Response`,
 * `RouteContext`), so this `lib/` file has no business calling it directly —
 * the route beside it does, after this call returns, and only once
 * `DayRow.committed` says there is something to hand off.
 *
 * A row's own `date` (set by the person, `PATCH .../extract/run`) wins over
 * whatever `takenAt` EXIF guessed; a dropped row is left exactly where it is,
 * in staging, for the sweep to clear when the run expires — deleting it here
 * would take away the person's chance to change their mind while the run is
 * still alive.
 */
export async function commitDay(
  username: string,
  runId: string,
  date: string,
): Promise<{ moved: number; entry: string | null }> {
  // A cheap, pre-lock check only — enough to bail out of a call with nothing
  // to do at all without ever taking the lock. Everything that actually
  // writes re-reads fresh, inside the lock, below: this copy may be stale
  // by the time a queued call gets its turn, and a stale read is exactly
  // what let a retried commit re-stage photographs a first call already
  // moved.
  const initial = freshState(username, runId, date);
  if (!initial || (initial.kept.length === 0 && !initial.row?.words)) {
    return { moved: 0, entry: null };
  }

  // The number the quota check judges, recomputed fresh at the moment the
  // lock is actually held — `withStorageQuota`'s own doc comment names this
  // exact shape for exactly this reason. An already-committed date costs
  // nothing more to write, so it reports zero rather than the bytes a first
  // call already spent.
  const bytesFor = (): number => {
    const state = freshState(username, runId, date);
    if (!state || state.row?.committed) return 0;
    return state.kept.reduce((sum, p) => sum + p.bytes, 0);
  };

  const move = (): number => {
    const state = freshState(username, runId, date);
    if (!state) return 0;

    // Already committed — by this call's own earlier attempt, or by
    // whichever concurrent call won the race for this lock first. A
    // double-click, a network retry, a restored tab: the person asked for
    // this day to be committed, and it is, so nothing moves a second time
    // and this reports the same count the day already holds rather than an
    // error that would invite them to press again.
    if (state.row?.committed) return state.kept.length;

    const { manifest, row, kept } = state;

    // Nothing to hand off to without a trip — created once per run and
    // reused by every later day, never a second one for the same run.
    const tripId = ensureTrip(username, manifest, date);
    if (!tripId) return 0;

    let moved = 0;
    for (const photo of kept) {
      const bytes = readStagedFile(username, runId, photo.id);
      // Gone from staging (swept, or never really there) — nothing to move,
      // and no reason to fail the whole day over one missing file.
      if (!bytes) continue;

      const meta: InboxMeta = {
        ...(photo.lat !== undefined ? { lat: photo.lat } : {}),
        ...(photo.lng !== undefined ? { lon: photo.lng } : {}),
        ...(photo.takenAt !== undefined ? { takenAt: photo.takenAt } : {}),
        // A real measurement the camera took, not a guess — same stance
        // `InboxMeta.measuredFrom` already documents for every other door.
        ...(photo.lat !== undefined || photo.takenAt !== undefined ? { measuredFrom: "exif" as const } : {}),
      };
      const { entry } = storeInboxFile(username, "media", photo.filename, bytes, meta);
      moveInboxFileToDay(username, entry.id, date);

      // Caption and visibility were set on the manifest's own row, in the
      // flow — carried across onto the inbox entry now that it has somewhere
      // to sit, never invented here. A photograph with no caption was never
      // asked for one by this flow either (that is Phase 4's own screen),
      // and `missingForDayFolder` asks about every staged photograph with
      // neither `caption` nor `descriptionAsked` set — so, same principle as
      // the track declines below, "never asked" is recorded honestly as
      // `descriptionAsked: true` rather than left as an open question
      // nothing in this run can ever go back and answer.
      const patch: InboxMeta = {};
      if (photo.caption !== undefined) patch.caption = photo.caption;
      else patch.descriptionAsked = true;
      if (photo.visibility !== undefined) patch.visibility = photo.visibility;
      updateInboxMeta(username, entry.id, patch, date);

      moved += 1;
    }

    // The day's own prose, whatever was said answering any of its questions
    // — already assembled, blank-line separated, on the manifest's own
    // `DayRow.words`. Nothing here adds to it or interprets it.
    if (row?.words) appendWords(username, date, row.words);

    // A real coordinate, when the kept photographs carry one — see
    // `medianLocation`'s own doc comment for where it comes from and why a
    // median. A day with none gets none: no guess, no neighbour's pin.
    const location = medianLocation(kept);
    if (location) {
      writeDayReadiness(username, date, { location: { ...location, source: "photo" } });
    }

    // Everything the flow never put in front of the person is a true
    // "nobody has decided yet", not an invented answer — see
    // `declineUnansweredTracks`.
    declineUnansweredTracks(username, date);

    if (row) {
      row.committed = true;
    }
    writeManifest(username, manifest);

    return moved;
  };

  // Every path through this function takes the same lock now, zero incoming
  // bytes included — `withStorageQuota` is also the per-username
  // serialisation `ensureTrip` and the committed-check above depend on, and
  // a "cheap" bypass of it was a bypass of that too: two concurrent
  // words-only commits could otherwise both read `tripId === null` and both
  // call `createTrip`, leaving a stray trip in the journal.
  // `storageRefusal`'s own doc comment already explains why zero bytes still
  // costs nothing to check: markdown writes are deliberately not gated, and
  // `bytesFor` above reports zero for exactly that case.
  const result = await withStorageQuota(username, bytesFor, move);
  if (!result.ok) return { moved: 0, entry: null };

  // The route beside this file calls `assemble-day` once `DayRow.committed`
  // is true and fills in the real slug — see this function's own doc
  // comment for why that call cannot live here.
  return { moved: result.value, entry: null };
}

type CommitState = {
  manifest: RunManifest;
  row: RunManifest["days"][number] | undefined;
  kept: PhotoRow[];
};

/** The manifest, this date's own row and its kept photographs, read fresh
 *  off disk — the one thing every callback below does before touching
 *  anything, so a stale copy captured before the lock was taken can never
 *  be what decides what gets written. `null` for a run that no longer
 *  exists. */
function freshState(username: string, runId: string, date: string): CommitState | null {
  const manifest = readManifest(username, runId);
  if (!manifest) return null;
  return {
    manifest,
    row: manifest.days.find((d) => d.date === date),
    kept: manifest.photos.filter((p) => !p.dropped && effectiveDate(p) === date),
  };
}

/** The date a kept row belongs to — the person's own edit if they made one,
 *  the camera's own reading otherwise. Never a guess past either of those. */
function effectiveDate(photo: PhotoRow): string | undefined {
  return photo.date ?? photo.takenAt?.slice(0, 10);
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

function partsOf(iso: string): { day: number; month: string; year: string } {
  const [year, month, day] = iso.split("-");
  return { day: Number(day), month: MONTHS[Number(month) - 1], year };
}

/**
 * A title that reads as a fact about the run rather than a placeholder — no
 * place name is invented, so the run's own real date span stands in until
 * the person renames it in the preview, which the design already has them
 * doing.
 */
function titleFromSpan(start: string, end: string): string {
  const a = partsOf(start);
  const b = partsOf(end);
  if (start === end) return `${a.day} ${a.month} ${a.year}`;
  if (a.year === b.year && a.month === b.month) return `${a.day}–${b.day} ${a.month} ${a.year}`;
  if (a.year === b.year) return `${a.day} ${a.month} – ${b.day} ${b.month} ${a.year}`;
  return `${a.day} ${a.month} ${a.year} – ${b.day} ${b.month} ${b.year}`;
}

/** The run's own earliest and latest day, across every kept photograph plus
 *  the date being committed (always real, so the span is never empty even
 *  on a run's very first commit). Never a guess past what the photographs
 *  or the person's own edits actually say. */
function runDateSpan(manifest: RunManifest, date: string): { start: string; end: string } {
  const dates = manifest.photos
    .filter((p) => !p.dropped)
    .map(effectiveDate)
    .filter((d): d is string => d !== undefined);
  dates.push(date);
  const sorted = [...dates].sort();
  return { start: sorted[0], end: sorted[sorted.length - 1] };
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * Mirrors `idFrom` in `app/api/helper/[user]/trip/route.ts` — same
 * discipline (a slugified title, a deterministic year suffix, a collision
 * loop through the one function that already knows what a trip id is), asked
 * for rather than a second way to name a trip. Not imported directly: that
 * one is a small private helper in a route file, and generating an id is not
 * itself "a way to create a trip" — `createTrip` below is, and it is reused
 * unchanged.
 */
function idFrom(username: string, title: string, start: string): string {
  const base = slugify(`${title}-${start.slice(0, 4)}`) || `trip-${start.slice(0, 4)}`;
  let id = base;
  for (let n = 2; getTrip(tripRef(username, id)); n += 1) id = `${base}-${n}`;
  return id;
}

/**
 * The trip this run's days join — created once, from the run's own dates,
 * the first time a day is committed with no trip chosen; reused unchanged on
 * every later commit in the same run.
 *
 * Title is the run's own date span, never a place name nobody supplied —
 * the person renames it in the preview. Visibility is `"private"`, the
 * narrowest value the type allows: an import must never create something
 * more visible than the person asked for, and nothing in this flow has asked
 * them anything about visibility yet.
 *
 * `null` on failure (an id collision `createTrip` still refused, or a
 * genuinely broken journal) — the caller's answer to that is the same as to
 * "nothing to commit": move nothing, mark nothing committed.
 */
function ensureTrip(username: string, manifest: RunManifest, date: string): string | null {
  if (manifest.tripId && getTrip(tripRef(username, manifest.tripId))) return manifest.tripId;

  const span = runDateSpan(manifest, date);
  const title = titleFromSpan(span.start, span.end);
  const created = createTrip(username, {
    id: idFrom(username, title, span.start),
    title,
    start: span.start,
    end: span.end,
    visibility: "private",
  });
  if (!created.ok) return null;

  manifest.tripId = created.id;
  return created.id;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * A coordinate for this date, from the *kept* photographs' own EXIF —
 * median of every located one's `lat`, and separately of every located
 * one's `lng`, never a mean: a mean of two real places is a third place
 * nobody went. The same statistic `lib/ingest/cluster.ts`'s own
 * `clusterMedia` already uses for a cluster's own centre — not reused
 * directly, because `clusterMedia`/`groupIntoDays` cluster by each
 * photograph's own EXIF timestamp and know nothing about a person's
 * `photo.date` override; `kept` here has already been resolved by
 * `effectiveDate`, which does, and re-clustering an already-resolved set
 * risks splitting it again on a gap its own EXIF times still show even
 * though the person put every one of these photographs on the same day.
 *
 * `undefined` when none of `kept` carries a fix — a day with no located
 * photograph gets no coordinate, exactly as before this existed.
 */
function medianLocation(kept: PhotoRow[]): { lat: number; lon: number } | undefined {
  const lats = kept.filter((p) => p.lat !== undefined).map((p) => p.lat!);
  const lngs = kept.filter((p) => p.lng !== undefined).map((p) => p.lng!);
  if (lats.length === 0 || lngs.length === 0) return undefined;
  return { lat: median(lats), lon: median(lngs) };
}

/**
 * Every `write`-time track (`lib/tracks.ts`) the flow never put in front of
 * the person, recorded as `unrecorded` — the same convention
 * `components/AgentWizard.tsx` already established for exactly this
 * situation (see `TRACK_ROWS.costs`'s own doc comment): "nobody has been
 * asked about it" is a true, honest state, distinct from `without` (a
 * confident "there is none of this"), which nothing in this flow has enough
 * to claim for any of these rows. `photos` is excluded on purpose — it is a
 * `publish`-time row, checked only when a day is actually published, and by
 * the time that happens `listDayInbox` already answers it from what really
 * got attached.
 *
 * Never overwrites a track that already carries an answer, on either list —
 * merged into whatever `day.json` already says, the same discipline
 * `assemble-day`'s own `recordAnswer` uses for the same file.
 */
function declineUnansweredTracks(username: string, date: string): void {
  const current = readDayReadiness(username, date);
  const already = new Set<string>([...current.without, ...current.unrecorded]);
  // A real coordinate, just written by `medianLocation`, answers
  // `coordinates` for real — `missingForDayFolder` reads `readiness.location`
  // directly, not this function's own lists, so declining it here as
  // `unrecorded` on top of a real answer would be a false "nobody knows"
  // sitting beside a real value.
  if (current.location !== undefined) already.add("coordinates");
  const unrecorded = [...current.unrecorded];
  for (const track of TRACKS) {
    if (TRACK_ROWS[track].when !== "write") continue;
    if (already.has(track)) continue;
    unrecorded.push(track);
  }
  if (unrecorded.length !== current.unrecorded.length) {
    writeDayReadiness(username, date, { unrecorded });
  }
}
