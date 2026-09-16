import "server-only";
import fs from "node:fs";
import path from "node:path";
import { runDir, stagingRoot } from "./paths";
import type { SpeechLanguage } from "@/lib/helper/speech";

export type PhotoRow = {
  id: string;
  filename: string;
  bytes: number;
  kind: "image" | "video";
  /** Read from the file. Absent means absent — never a fallback, never a guess. */
  takenAt?: string;      // "2019-07-02T10:07:05", wall clock, no zone
  offset?: string;       // "+07:00"
  lat?: number;
  lng?: number;
  make?: string;
  model?: string;
  /** Set by the person, in the flow. */
  date?: string;         // "2019-07-02" — which day this belongs to
  caption?: string;
  visibility?: "guest" | "private";
  dropped?: boolean;
};

/** The one shape a date may take anywhere in a run — `yyyy-mm-dd`, with a
 *  real month and a plausible day. Not a calendar (30 February is not the
 *  point): it is the check that stands between a caller's string and a value
 *  that becomes a folder name under `inbox/days/<date>/`, a `DayRow.date`,
 *  and a weekday a screen formats. Lives beside the rows it guards so the
 *  extract routes share one copy rather than three that can drift.
 *
 *  The undated group's own `""` is deliberately NOT matched here — a route
 *  that accepts it says so itself (`POST .../extract/day`), and nothing that
 *  formats a weekday ever should. */
export const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export type DayRow = {
  date: string;
  words?: string;
  /** Free text from the person's own answer to a "where were you" question —
   *  a place name, or a sentence, whatever they typed or said. Not a
   *  coordinate, and not `DayReadiness.location`'s structured
   *  `{lat, lon, source}` from lib/dayReadiness.ts — a different field, on a
   *  different type, for a different stage of the pipeline. */
  location?: string;
  /** Answered question ids, so the flow never asks the same thing twice. */
  answered: string[];
  committed?: boolean;
  /** The real entry `assemble-day` created for this date, once it has — set
   *  by `POST .../extract/commit` right after a successful hand-off, never
   *  by `commitDay` itself. What a retried commit (a double-click, a
   *  network retry, a restored tab) answers with instead of calling
   *  `assemble-day` a second time: that call's own create path notices a
   *  slug collision, never a date collision, so a second call with an empty
   *  day folder (the first call's own success already deleted it) would
   *  either refuse or, worse, mint a second entry for the same date. */
  entrySlug?: string;
};

export type RunManifest = {
  version: 1;
  runId: string;
  owner: string;
  createdAt: string;
  expiresAt: string;
  /** null means "a new trip, named at the end". */
  tripId: string | null;
  mode: "voice" | "type";
  /**
   * Which language a voice answer is transcribed in — B1803 Task 4.1/4.2.
   * Asked once, on Step 02's mode screen, alongside `mode`, and never asked
   * again: `RecordButton`'s own per-recording select is skipped whenever a
   * caller hands it this value as its `language` prop. Absent for a `"type"`
   * run, which never records anything and so was never asked.
   */
  language?: SpeechLanguage;
  state: "uploading" | "analysed" | "telling" | "committed";
  photos: PhotoRow[];
  days: DayRow[];
  /** Set once the one free sample description has been taken. */
  sampleTakenFor?: string;
  /** When the "24 hours left" notice went out. Its presence is what stops a
   *  second one, and writing it also pins `expiresAt` to 24h later. */
  warnedAt?: string;
  /** When continuing the run bought it another 48 hours. Once only — its
   *  presence is the whole of that rule. */
  extendedAt?: string;
  /** Set once the last notice has gone out, so an extended run cannot be told
   *  twice. Written by the expiry sweep; nothing else touches it. */
  finalNoticeAt?: string;
  /**
   * "How many of you went?" and their names (S8a, B1803 Task 3.6) — set once,
   * for the whole run, by `PATCH .../extract/party`.
   *
   * Deliberately **not** `trip.json`'s `people:` block
   * (`lib/api/tripParty.ts`): that list grants write access to the trip and
   * requires an email per person, because it is who may write to the whole
   * trip. This is the opposite kind of fact — purely descriptive, nobody's
   * address required, and never shown to anyone the owner has not
   * separately let in (`extract.whoCame.reassure`) — so it lives here, on
   * the run's own manifest, and nowhere a reader could ever see it.
   */
  partySize?: number;
  /** `partyNames[0]` is the owner's own slot ("You" on the screen); later
   *  entries are however many of `partySize` the owner chose to name. A
   *  shorter array than `partySize` is not an error — it is exactly as many
   *  names as were given, the rest counted but not named.
   *
   *  An entry may be `""`: the slots are positional, so a person who named
   *  their companion and left their own name blank stores `["", "Nora"]`
   *  rather than `["Nora"]`, which on the next load would put Nora in the
   *  owner's own field. Every reader already drops blanks
   *  (`PreviewScreen`). Trailing blanks are not stored at all. */
  partyNames?: string[];
};

function manifestPath(username: string, runId: string): string {
  return path.join(runDir(username, runId), "run.json");
}

/**
 * A run that is missing, unreadable or malformed reads as `null`.
 *
 * The same stance `readDayReadiness` takes for `day.json`: this file is on
 * disk, a person may have been editing around it, and an exception here would
 * take out a page rather than one run. The caller's answer to `null` is always
 * "start again", which is the correct answer to all three causes.
 */
export function readManifest(username: string, runId: string): RunManifest | null {
  try {
    const raw = JSON.parse(fs.readFileSync(manifestPath(username, runId), "utf8")) as RunManifest;
    return raw && raw.version === 1 && Array.isArray(raw.photos) && Array.isArray(raw.days) ? raw : null;
  } catch {
    return null;
  }
}

/** Written through a temp file and renamed: a phone that drops mid-write must
 *  not leave half a manifest, which would read as a run with no photographs in
 *  it and lose the lot. */
export function writeManifest(username: string, m: RunManifest): void {
  const dir = runDir(username, m.runId);
  fs.mkdirSync(dir, { recursive: true });
  const target = manifestPath(username, m.runId);
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(m, null, 2));
  fs.renameSync(tmp, target);
}

export function listRuns(username: string): RunManifest[] {
  const dir = path.join(stagingRoot(), username);
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .map((runId) => readManifest(username, runId))
    .filter((m): m is RunManifest => m !== null)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
