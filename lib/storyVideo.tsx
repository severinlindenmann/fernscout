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
  hash.update("v1\n");
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

export function readCachedStoryVideo(key: string): Buffer | null {
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

/** A transparent 1080×1920 PNG with only the bottom caption panel drawn —
 * the same text `PhotoCard` in the picture route draws, so the video's
 * panel and the "photo" look agree. Overlaid over the whole clip: per-
 * segment captions are not built (see the route's doc comment on this
 * deviation). */
async function renderPanelPng(facts: StoryFacts): Promise<Buffer> {
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
        {facts.link && (
          <div style={{ display: "flex", marginTop: 20, fontSize: 20, color: "#aeb7c5", fontFamily: "monospace" }}>
            {facts.link.replace(/^https?:\/\//, "")}
          </div>
        )}
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
  photoFiles: string[];
  facts: StoryFacts;
  ownerIpForRateLimit: string;
}): Promise<Buffer | null> {
  const cached = readCachedStoryVideo(args.key);
  if (cached) return cached;

  const inFlight = renders.get(args.key);
  if (inFlight) return inFlight;

  const limited = rateLimitFor("story-video", args.ownerIpForRateLimit, { max: 10, windowMs: 10 * 60 * 1000 });
  if (!limited.ok) return null;

  const job = (async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "story-video-"));
    try {
      const bytes = await buildClip(args.photoFiles.slice(0, 3), args.facts, tmpDir);
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

async function buildClip(photoFiles: string[], facts: StoryFacts, tmpDir: string): Promise<Buffer | null> {
  if (photoFiles.length === 0) return null;
  const panelPath = path.join(tmpDir, "panel.png");
  fs.writeFileSync(panelPath, await renderPanelPng(facts));

  const n = photoFiles.length;
  const overlap = n > 1 ? CROSSFADE_SECONDS : 0;
  const segment = (TOTAL_SECONDS + overlap * (n - 1)) / n;

  const args: string[] = ["-v", "error", "-y"];
  for (const file of photoFiles) {
    args.push("-loop", "1", "-t", segment.toFixed(2), "-i", file);
  }
  args.push("-loop", "1", "-t", TOTAL_SECONDS.toFixed(2), "-i", panelPath);

  const scaled = photoFiles.map(
    (_, i) =>
      `[${i}:v]scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase,` +
      `crop=${WIDTH}:${HEIGHT},setsar=1,fps=25,trim=0:${segment.toFixed(2)},setpts=PTS-STARTPTS[v${i}]`,
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

  const filter = [...scaled, ...transitions, `[${videoLabel}][${n}:v]overlay=0:0:format=auto[outv]`].join(";");

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
