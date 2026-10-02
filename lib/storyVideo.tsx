import "server-only";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ImageResponse } from "next/og";
import { contentRoot } from "./contentRoot";
import { runProcess } from "./ingest/run.ts";
import { videoToolsAvailable } from "./ingest/video.ts";
import { rateLimitFor } from "./rateLimit";
import type { StoryFacts } from "./storyCard";
import { StoryMark } from "@/components/StoryMark";

export { videoToolsAvailable };

const WIDTH = 1080;
const HEIGHT = 1920;
/** Roughly the brief's "~8 s", however many photos (1–3) go in. */
const TOTAL_SECONDS = 8;
const CROSSFADE_SECONDS = 0.4;
const FPS = 25;
/** How far each photo pushes in over its segment. */
const ZOOM = 0.08;
const RENDER_TIMEOUT_MS = 60_000;

function cacheDir(): string {
  return path.join(contentRoot(), ".cache", "story-video");
}

/** Keyed by everything that can change the output — B2665. A day's own
 * content, the files behind each photo (mtime), and a version number bumped
 * whenever this module's own rendering changes, so an old cached clip from
 * before a bug fix is never served. */
export function storyVideoCacheKey(parts: {
  dayJson: string;
  photoFiles: string[];
}): string {
  const hash = crypto.createHash("sha256");
  hash.update("v4\n");
  hash.update(parts.dayJson);
  for (const file of parts.photoFiles) {
    try {
      const stat = fs.statSync(file);
      hash.update(`${file}:${stat.mtimeMs}:${stat.size}\n`);
    } catch {
      hash.update(`${file}:missing\n`);
    }
  }
  return hash.digest("hex").slice(0, 32);
}

function readCachedStoryVideo(key: string): Buffer | null {
  try {
    return fs.readFileSync(path.join(cacheDir(), `${key}.mp4`));
  } catch {
    return null;
  }
}

function writeCachedStoryVideo(key: string, bytes: Buffer): void {
  try {
    fs.mkdirSync(cacheDir(), { recursive: true });
    const tmp = path.join(cacheDir(), `${key}.mp4.${process.pid}.partial`);
    fs.writeFileSync(tmp, bytes);
    fs.renameSync(tmp, path.join(cacheDir(), `${key}.mp4`));
  } catch {
    // A cache write that fails costs the next request a re-render, not this
    // one its answer — same reasoning as lib/map/cardCache.ts.
  }
}

/** One render per key in flight at a time, across concurrent requests —
 * ponytail: an in-process map, shared only within one Node worker; a second
 * server process can still render the same key twice. Upgrade to a
 * filesystem lock if this instance ever runs more than one worker. */
const renders = new Map<string, Promise<Buffer | null>>();

/** One photograph of the clip and the line its panel shows while it is up. */
export type StorySegment = { file: string; caption?: string };

/** What the panel's last line says during segment `i` of `n` — the photo's
 * own caption, except that the last photo gives the line to the link when
 * there is one (the owner's draft, 2026-10-02). Empty when neither exists. */
export function segmentLine(segments: readonly StorySegment[], i: number, link: string | undefined): string | undefined {
  if (i === segments.length - 1 && link) return link.replace(/^https?:\/\//, "");
  return segments[i]?.caption || undefined;
}

/** When segment `i` takes over the panel: halfway through the crossfade
 * into its photo, so the line changes with the picture. */
export function segmentStarts(n: number, segment: number, overlap: number): number[] {
  return Array.from({ length: n }, (_, i) => (i === 0 ? 0 : i * (segment - overlap) + overlap / 2));
}

/** A transparent 1080×1920 PNG with only the bottom panel drawn — the same
 * text `PhotoCard` in the picture route draws, so the video's panel and the
 * "photo" look agree. One per segment; only the last line differs, and it
 * keeps its height when empty so the panel never jumps. */
async function renderPanelPng(facts: StoryFacts, line: string | undefined): Promise<Buffer> {
  const element = (
    <div style={{ display: "flex", width: "100%", height: "100%", flexDirection: "column" }}>
      <div style={{ display: "flex", flex: 1 }} />
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          background: "#0f1520",
          padding: "40px 56px 56px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <StoryMark size={30} />
          {facts.dayLabel && (
            <div style={{ display: "flex", fontSize: 22, fontWeight: 700, letterSpacing: 2, color: "#ffd23f", textTransform: "uppercase" }}>
              {facts.dayLabel} · {facts.dateLabel}
            </div>
          )}
        </div>
        <div style={{ display: "flex", marginTop: 12, fontSize: 48, fontWeight: 700, color: "#fffaf0", lineHeight: 1.1 }}>
          {facts.title}
        </div>
        {(facts.place || facts.tempLine) && (
          <div style={{ display: "flex", marginTop: 12, fontSize: 24, color: "#d8dee8" }}>
            {[facts.place, facts.tempLine].filter(Boolean).join(" · ")}
          </div>
        )}
        <div
          style={{
            display: "flex",
            marginTop: 20,
            paddingTop: 16,
            height: 80,
            borderTop: "2px solid #253145",
            fontSize: 24,
            lineHeight: 1.35,
            color: "#aeb7c5",
            fontStyle: line && facts.link && line === facts.link.replace(/^https?:\/\//, "") ? "normal" : "italic",
          }}
        >
          {line ?? ""}
        </div>
      </div>
    </div>
  );
  const response = new ImageResponse(element, { width: WIDTH, height: HEIGHT });
  return Buffer.from(await response.arrayBuffer());
}

/**
 * Renders the clip and caches it, sharing one in-flight render per key.
 * `null` means ffmpeg failed or timed out — the caller falls back to
 * 500/404, never a half-written file.
 */
export async function renderStoryVideo(args: {
  key: string;
  segments: StorySegment[];
  facts: StoryFacts;
  rateLimitKey: string;
}): Promise<Buffer | "rate_limited" | null> {
  const cached = readCachedStoryVideo(args.key);
  if (cached) return cached;

  const inFlight = renders.get(args.key);
  if (inFlight) return inFlight;

  const limited = rateLimitFor("story-video", args.rateLimitKey, { max: 10, windowMs: 10 * 60 * 1000 });
  if (!limited.ok) return "rate_limited";

  const job = (async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "story-video-"));
    try {
      const bytes = await buildClip(args.segments.slice(0, 3), args.facts, tmpDir);
      if (bytes) writeCachedStoryVideo(args.key, bytes);
      return bytes;
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  })();
  renders.set(args.key, job);
  try {
    return await job;
  } finally {
    renders.delete(args.key);
  }
}

async function buildClip(segments: StorySegment[], facts: StoryFacts, tmpDir: string): Promise<Buffer | null> {
  if (segments.length === 0) return null;
  const photoFiles = segments.map((s) => s.file);
  const panelPaths: string[] = [];
  for (let i = 0; i < segments.length; i++) {
    const panelPath = path.join(tmpDir, `panel-${i}.png`);
    fs.writeFileSync(panelPath, await renderPanelPng(facts, segmentLine(segments, i, facts.link)));
    panelPaths.push(panelPath);
  }

  const n = photoFiles.length;
  const overlap = n > 1 ? CROSSFADE_SECONDS : 0;
  const segment = (TOTAL_SECONDS + overlap * (n - 1)) / n;

  const args: string[] = ["-v", "error", "-y"];
  // A still, read once: `zoompan` below turns its one frame into the whole
  // segment (a looped input would hand it a frame per output frame).
  // Local files only: ffmpeg picks a demuxer from the contents, and a
  // playlist dressed as a .jpg must not be able to open anything else.
  for (const file of photoFiles) {
    args.push("-protocol_whitelist", "file", "-i", file);
  }
  for (const panelPath of panelPaths) {
    args.push("-protocol_whitelist", "file", "-loop", "1", "-t", TOTAL_SECONDS.toFixed(2), "-i", panelPath);
  }

  // The slow push-in from the draft: 1.00 → 1.08 over each segment, centred.
  const frames = Math.round(segment * FPS);
  const scaled = photoFiles.map(
    (_, i) =>
      // Cropped at twice the size first: `zoompan` rounds its window to whole
      // pixels, and at 1080 wide a slow push-in visibly shakes.
      `[${i}:v]scale=${WIDTH * 2}:${HEIGHT * 2}:force_original_aspect_ratio=increase,crop=${WIDTH * 2}:${HEIGHT * 2},setsar=1,` +
      `zoompan=z='1+${ZOOM}*on/${frames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frames}:s=${WIDTH}x${HEIGHT}:fps=${FPS},` +
      `setpts=PTS-STARTPTS[v${i}]`,
  );

  const transitions: string[] = [];
  let lastLabel = "v0";
  let runningDuration = segment;
  for (let i = 1; i < n; i++) {
    const outLabel = i === n - 1 ? "merged" : `x${i}`;
    const offset = runningDuration - overlap;
    transitions.push(
      `[${lastLabel}][v${i}]xfade=transition=fade:duration=${overlap.toFixed(2)}:offset=${offset.toFixed(2)}[${outLabel}]`,
    );
    lastLabel = outLabel;
    runningDuration = offset + segment;
  }
  const videoLabel = n === 1 ? "v0" : lastLabel;

  // Each segment's panel is laid over only while that segment holds the
  // panel — `enable` switches them, so the caption changes with its photo.
  const starts = segmentStarts(n, segment, overlap);
  const overlays: string[] = [];
  let base = videoLabel;
  for (let i = 0; i < n; i++) {
    const until = i === n - 1 ? TOTAL_SECONDS + 1 : starts[i + 1];
    const out = i === n - 1 ? "outv" : `o${i}`;
    overlays.push(
      `[${base}][${n + i}:v]overlay=0:0:format=auto:enable='between(t,${starts[i].toFixed(2)},${until.toFixed(2)})'[${out}]`,
    );
    base = out;
  }

  const filter = [...scaled, ...transitions, ...overlays].join(";");

  const output = path.join(tmpDir, "story.mp4");
  args.push(
    "-filter_complex",
    filter,
    "-map",
    "[outv]",
    "-t",
    TOTAL_SECONDS.toFixed(2),
    "-c:v",
    "libx264",
    "-profile:v",
    "high",
    "-preset",
    "veryfast",
    "-crf",
    "24",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    "-an",
    "-map_metadata",
    "-1",
    output,
  );

  const run = await runProcess("ffmpeg", args, { stderr: "pipe", timeout: RENDER_TIMEOUT_MS });
  if (run.status !== 0 || !fs.existsSync(output)) return null;
  return fs.readFileSync(output);
}
