import "server-only";
import fs from "node:fs";
import path from "node:path";
import { runDir, stagingRoot } from "./paths";

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

export type DayRow = {
  date: string;
  words?: string;
  location?: string;
  /** Answered question ids, so the flow never asks the same thing twice. */
  answered: string[];
  committed?: boolean;
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
