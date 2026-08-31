/**
 * Short clips, and only short clips.
 *
 * A travel blog gets one thing from video that photographs cannot give it:
 * ten seconds of a night market with the sound on. It gets nothing at all
 * from the four-minute 4K clip nobody watches past second six, which costs
 * 200 MB of a small VPS's disk and the reader's mobile data. So there is a
 * hard length cap, and anything over it is refused with the number in the
 * message rather than silently truncated.
 *
 * Everything here needs ffmpeg, which is the one dependency ingest cannot
 * vendor. When it is missing the clips are reported and skipped — the photos
 * in the same folder still import, because losing an evening's write-up
 * because of a codec is exactly the failure this package exists to prevent.
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { ExifDateTime } from "./exif.ts";

/** Longer than this and it is a film, not a clip. */
export const MAX_SECONDS = 30;

/** Clips are capped well below the photo size: motion hides detail, and this
 * is the difference between a 4 MB file and a 40 MB one. */
export const MAX_EDGE = 1280;

export const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".m4v", ".webm", ".avi", ".mkv"]);

export type VideoProbe = {
  durationSeconds: number;
  width: number;
  height: number;
  /** When it was filmed, as a wall-clock reading. See `readCreationTime`. */
  takenAt?: ExifDateTime;
};

/**
 * The time a clip was filmed, taken from container metadata.
 *
 * Apple writes `com.apple.quicktime.creationdate` with the local time and its
 * offset, which is precisely what a travel blog wants — it is the reading on
 * the clock in the room. The generic `creation_time` is UTC, so for a camera
 * that writes only that, a clip can land in the entry either side of midnight
 * by the size of the timezone offset. That is a one-line fix in the markdown,
 * and better than the alternative of pretending to know the traveller's zone.
 */
export function readCreationTime(tags: Record<string, string> | undefined): ExifDateTime | undefined {
  if (!tags) return undefined;
  const raw = tags["com.apple.quicktime.creationdate"] ?? tags.creation_time;
  if (!raw) return undefined;
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/.exec(raw);
  if (!m) return undefined;
  const [, year, month, day, hour, minute, second] = m.map(Number);
  return { year, month, day, hour, minute, second };
}

function has(command: string): boolean {
  // Bounded, like every other spawn here. `-version` on a working binary is
  // instant; the only ways it is not are a binary that hangs on start and a
  // machine under enough load that spawning itself is slow, and neither is
  // worth holding a request open indefinitely for.
  return !spawnSync(command, ["-version"], { stdio: "ignore", timeout: 5_000 }).error;
}

let toolsChecked = false;
let tools = { ffmpeg: false, ffprobe: false };

/** Whether video can be handled at all, checked once per run. */
export function videoToolsAvailable(): boolean {
  if (!toolsChecked) {
    toolsChecked = true;
    tools = { ffmpeg: has("ffmpeg"), ffprobe: has("ffprobe") };
  }
  return tools.ffmpeg && tools.ffprobe;
}

export const FFMPEG_MISSING_MESSAGE =
  "ffmpeg and ffprobe are not on PATH, so video clips were skipped.\n" +
  "  Install them (macOS: brew install ffmpeg · Debian: apt install ffmpeg) and\n" +
  "  re-run ingest on the same folder — the photos already imported are kept.";

export function probeVideo(file: string): VideoProbe | null {
  const out = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "format=duration:format_tags:stream=width,height",
      "-of",
      "json",
      file,
    ],
    // Standard input closed, not merely unused.
    //
    // Handed a file that is not really a video, ffprobe falls back to waiting
    // on stdin — and waits, at nought per cent of a CPU, for twenty seconds.
    // On the upload endpoint that is twenty seconds of a held request for every
    // malformed file somebody sends, which is a denial of service written in a
    // default. Closing the pipe makes it fail at once.
    //
    // Not `-nostdin`: that is an *ffmpeg* option. ffprobe has no such flag, and
    // reads the argument after it as its value — so passing it here silently
    // swallowed `-v` and made every probe fail, including on good files.
    //
    // `timeout` is the backstop for the case this reasoning misses. A probe
    // that has not answered in ten seconds is not going to.
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 10_000 },
  );
  if (out.status !== 0) return null;
  try {
    const json = JSON.parse(out.stdout) as {
      format?: { duration?: string; tags?: Record<string, string> };
      streams?: { width?: number; height?: number }[];
    };
    const stream = json.streams?.[0];
    return {
      durationSeconds: Number(json.format?.duration ?? 0),
      width: stream?.width ?? 0,
      height: stream?.height ?? 0,
      takenAt: readCreationTime(json.format?.tags),
    };
  } catch {
    return null;
  }
}

export type TranscodeResult = {
  width: number;
  height: number;
  /** A JPEG grabbed a beat into the clip, used as the `poster`. */
  poster: Buffer;
};

export class ClipTooLongError extends Error {
  constructor(file: string, seconds: number, cap: number) {
    super(
      `${path.basename(file)} is ${seconds.toFixed(0)}s; the cap is ${cap}s.\n` +
        `  Trim it first, or raise the cap with --max-video-seconds <n> if you\n` +
        `  really mean to publish a long clip.`,
    );
    this.name = "ClipTooLongError";
  }
}

/**
 * Transcodes to h264/AAC in an MP4 and grabs a poster frame.
 *
 * h264 rather than a newer codec because this has to play in a WhatsApp
 * in-app browser on a five-year-old Android, and `faststart` because without
 * it the player downloads the whole file before showing frame one.
 *
 * `-map_metadata -1` is the same privacy rule as photographs: phones write
 * GPS into MOV metadata too, and the served file must not carry it.
 */
export function transcodeVideo(
  input: string,
  output: string,
  options: { maxSeconds?: number; maxEdge?: number; crf?: number } = {},
): TranscodeResult {
  const maxSeconds = options.maxSeconds ?? MAX_SECONDS;
  const maxEdge = options.maxEdge ?? MAX_EDGE;

  const probe = probeVideo(input);
  if (!probe) throw new Error(`ffprobe could not read ${path.basename(input)}.`);
  if (probe.durationSeconds > maxSeconds + 0.5) {
    throw new ClipTooLongError(input, probe.durationSeconds, maxSeconds);
  }

  // Even dimensions, because h264 requires them; `force_original_aspect_ratio`
  // keeps the frame from being stretched when only one edge is over the cap.
  const scale =
    `scale=w=min(iw\\,${maxEdge}):h=min(ih\\,${maxEdge}):` +
    `force_original_aspect_ratio=decrease:force_divisible_by=2`;

  fs.mkdirSync(path.dirname(output), { recursive: true });
  const run = spawnSync(
    "ffmpeg",
    [
      "-v", "error",
      "-y",
      "-i", input,
      "-t", String(maxSeconds),
      "-vf", scale,
      "-c:v", "libx264",
      "-profile:v", "high",
      "-preset", "veryfast",
      "-crf", String(options.crf ?? 24),
      "-pix_fmt", "yuv420p",
      "-movflags", "+faststart",
      "-map_metadata", "-1",
      "-c:a", "aac",
      "-b:a", "128k",
      "-ac", "2",
      output,
    ],
    { stdio: ["ignore", "ignore", "pipe"], encoding: "utf8" },
  );
  if (run.status !== 0) {
    throw new Error(`ffmpeg failed on ${path.basename(input)}:\n${run.stderr?.trim()}`);
  }

  const transcoded = probeVideo(output) ?? probe;

  // One second in, or the very first frame for a clip shorter than that —
  // frame zero of a phone video is very often a blurred half-exposure.
  const posterAt = Math.min(1, Math.max(0, probe.durationSeconds - 0.1));
  const poster = spawnSync(
    "ffmpeg",
    [
      "-v", "error",
      "-ss", posterAt.toFixed(2),
      "-i", output,
      "-frames:v", "1",
      "-f", "mjpeg",
      "-q:v", "4",
      "-map_metadata", "-1",
      "pipe:1",
    ],
    // stdin closed for the same reason as the probe above.
    { maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"], timeout: 120_000 },
  );
  if (poster.status !== 0 || poster.stdout.length === 0) {
    throw new Error(`ffmpeg could not extract a poster frame from ${path.basename(input)}.`);
  }

  return { width: transcoded.width, height: transcoded.height, poster: poster.stdout };
}
