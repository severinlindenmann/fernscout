import "server-only";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { decodeSource, IMAGE_EXTENSIONS, makeDerivative } from "@/lib/ingest/image";
import { VIDEO_EXTENSIONS } from "@/lib/ingest/video";
import { mediaEtag, resizedCopy } from "@/lib/media";

const execute = promisify(execFile);
const pending = new Map<string, Promise<Buffer | null>>();

/** How much of a clip a tile loops, and how smoothly. Two seconds at 8fps is
 *  about 40 KB per tile — enough to see the motion, cheap enough for a grid. */
const PREVIEW_SECONDS = 2;
const PREVIEW_FPS = 8;

/** Owner-only staged media, including formats a browser cannot decode.
 * `file` must come from stagedFileLocation after the caller's access checks.
 * Previews live beside files, so removing/sweeping the run removes them too.
 * The original must still exist before even a cached preview can be read. */
export async function extractThumbnail(file: string, width: number): Promise<Buffer | null> {
  const extension = path.extname(file).toLowerCase();
  if (!IMAGE_EXTENSIONS.has(extension) && !VIDEO_EXTENSIONS.has(extension) && extension !== ".gif") {
    return null;
  }
  const identity = mediaEtag(file, width);
  if (!identity) return null;
  const cached = path.join(path.dirname(file), "..", "previews", `${identity.slice(1, -1)}.webp`);
  try {
    return await fs.readFile(cached);
  } catch { /* First request for this representation. */ }
  const existing = pending.get(cached);
  if (existing) return existing;
  const generation = generate(file, width, extension, cached);
  pending.set(cached, generation);
  try {
    return await generation;
  } finally {
    pending.delete(cached);
  }
}

async function generate(file: string, width: number, extension: string, cached: string): Promise<Buffer | null> {
  const partial = `${cached}.${randomUUID()}.partial`;
  try {
    let bytes: Buffer | null;
    if (VIDEO_EXTENSIONS.has(extension)) {
      // A looping animated WebP, not a still: a tile shows what moves in the
      // clip, and an <img> plays it with no player and no second route.
      // ffmpeg writes the file itself rather than a pipe — the animated WebP
      // muxer seeks back to finish its header, which a pipe cannot do.
      // No network protocols, shell interpolation or unbounded process/output.
      // ponytail: the first two seconds at 8fps; add a seek into the middle
      // if the opening frames turn out to be the dull part of most clips.
      await fs.mkdir(path.dirname(cached), { recursive: true });
      await execute("ffmpeg", [
        "-v", "error", "-nostdin", "-protocol_whitelist", "file,pipe",
        // Force a container demuxer: a renamed playlist must not read other
        // local files even though the input itself necessarily uses file:.
        //
        // The three arms cover `VIDEO_EXTENSIONS` as it stands, and the
        // default arm is mov-family rather than "whatever ffmpeg guesses" —
        // guessing is the hole this closes. Widening that set widens this by
        // itself: an ISO-BMFF cousin (.3gp, say) lands on the mov demuxer and
        // works, and anything else lands on it and fails, which `generate`
        // turns into the same quiet placeholder a missing codec gets. A wrong
        // preview is never the outcome; a missing one can be, so add an arm
        // here in the same change that adds the extension there.
        "-f", extension === ".avi" ? "avi" : [".webm", ".mkv"].includes(extension) ? "matroska" : "mov",
        "-threads", "1", "-i", file, "-map", "0:v:0", "-t", String(PREVIEW_SECONDS), "-an",
        "-filter_threads", "1", "-vf", `fps=${PREVIEW_FPS},scale=${width}:${width}:force_original_aspect_ratio=decrease`,
        "-map_metadata", "-1", "-loop", "0", "-q:v", "50", "-c:v", "libwebp", "-f", "webp", "-y", partial,
      ], { encoding: "buffer", timeout: 30_000, maxBuffer: 1024 * 1024 });
      bytes = await fs.readFile(partial);
      if (bytes.byteLength === 0) return null;
    } else {
      bytes = await resizedCopy(file, width);
      if (!bytes) {
        const source = await decodeSource(file);
        try {
          bytes = (await makeDerivative(source, { maxEdge: width, format: "webp", quality: 78 })).bytes;
        } finally {
          source.dispose();
        }
      }
      if (!bytes) return null;
      try {
        await fs.mkdir(path.dirname(cached), { recursive: true });
        await fs.writeFile(partial, bytes);
      } catch {
        // A read-only/full cache must not hide a successfully decoded preview.
        return bytes;
      }
    }
    // Same reason: failing to keep the preview is not failing to make one.
    await fs.rename(partial, cached).catch(() => {});
    return bytes;
  } catch {
    // Missing codecs and corrupt uploads keep the existing placeholder.
    return null;
  } finally {
    await fs.rm(partial, { force: true }).catch(() => {});
  }
}
