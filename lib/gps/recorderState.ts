import fs from "node:fs";
import path from "node:path";
import { contentRoot } from "../contentRoot";

/**
 * The phone's own latest "am I actually recording" report — B2542.
 *
 * `content/<user>/trips/<trip>/recorder-state.json`. Not a position, not
 * derived from one: just what the phone itself said the last time it
 * uploaded — whether it is armed, until when, what location permission it
 * currently holds, and its own app version. The studio cannot otherwise tell
 * "recording", "off" and "armed but silently not working" apart — the last
 * upload's own timestamp says only "something arrived once", never whether
 * the phone has since had its permission downgraded to "While Using" (no
 * background fixes at all) or simply stopped reaching the server.
 *
 * **Owner-only content, the same shape as `track-edits.json`.** Never
 * exposed to a reader, never to any bearer token but the phone's own narrow
 * `write:gps` (writing its own report) or the journal's own owner token
 * (reading it back) — `recordingState` below is the one reader, called only
 * from the owner's cookie-only studio door. Excluded from export and the
 * sync manifest for the same reason `track-edits.json` is (see
 * `lib/exportZip.ts`, `lib/sync/manifest.ts`).
 */
export type RecorderReport = {
  armed: boolean;
  /** ISO instant — when this arming will stop recording on its own (D2's
   *  cooldown, or the end of an open-ended trip's own reminder cycle),
   *  absent when the phone did not say. */
  armedUntil?: string;
  permission?: "always" | "whenInUse" | "denied" | "notDetermined";
  appVersion?: string;
  /** Set here, server-side, on write — never trusted from the phone, the
   *  same "the server's own clock, not the caller's" rule every instant in
   *  this codebase follows. What `recordingState` calls "silent" is
   *  measured from this. */
  receivedAt: string;
};

function stateFile(username: string, tripId: string): string {
  return path.join(contentRoot(), username, "trips", tripId, "recorder-state.json");
}

/** Fails closed like every other reader in `lib/gps/`: an unreadable file
 *  reads as "no report at all" rather than guessing a state from it. */
export function readRecorderState(username: string, tripId: string): RecorderReport | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(stateFile(username, tripId), "utf8"));
  } catch {
    return undefined;
  }
  if (typeof raw !== "object" || raw === null) return undefined;
  const r = raw as Partial<RecorderReport>;
  if (typeof r.armed !== "boolean" || typeof r.receivedAt !== "string") return undefined;
  return {
    armed: r.armed,
    receivedAt: r.receivedAt,
    ...(typeof r.armedUntil === "string" ? { armedUntil: r.armedUntil } : {}),
    ...(r.permission && ["always", "whenInUse", "denied", "notDetermined"].includes(r.permission)
      ? { permission: r.permission }
      : {}),
    ...(typeof r.appVersion === "string" ? { appVersion: r.appVersion } : {}),
  };
}

/** Written whole and renamed, the same atomic-write shape every other file
 *  in this module uses. `receivedAt` is always "now", on the server —
 *  never taken from the phone's own body, even if it sent one. */
export function writeRecorderState(
  username: string,
  tripId: string,
  report: Omit<RecorderReport, "receivedAt">,
): void {
  const file = stateFile(username, tripId);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const full: RecorderReport = { ...report, receivedAt: new Date().toISOString() };
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(full), "utf8");
  fs.renameSync(temporary, file);
}

/** Longer than this since the last report and "armed" no longer means
 *  "recording" — the phone has gone quiet, whatever it last said. */
const SILENT_AFTER_MS = 6 * 60 * 60 * 1000;

export type RecordingState = {
  state: "recording" | "off" | "silent";
  reason?: "permission" | "stale";
  armedUntil?: string;
  lastReport?: string;
  permission?: RecorderReport["permission"];
};

/**
 * The studio's own three-state answer — B2542. `null` when the phone has
 * never reported anything for this trip at all (nothing to say yet, not the
 * same as "off"): `undefined`/`null` is deliberately distinct from every one
 * of the three named states, so a caller cannot mistake "no report" for "off".
 */
export function recordingState(username: string, tripId: string): RecordingState | null {
  const report = readRecorderState(username, tripId);
  if (!report) return null;
  const lastReport = report.receivedAt;
  const armedUntil = report.armedUntil;
  const permission = report.permission;
  if (!report.armed) return { state: "off", lastReport, armedUntil, permission };
  if (permission !== undefined && permission !== "always") {
    return { state: "silent", reason: "permission", lastReport, armedUntil, permission };
  }
  const ageMs = Date.now() - Date.parse(lastReport);
  if (!Number.isFinite(ageMs) || ageMs > SILENT_AFTER_MS) {
    return { state: "silent", reason: "stale", lastReport, armedUntil, permission };
  }
  return { state: "recording", lastReport, armedUntil, permission };
}
