import "server-only";
import fs from "node:fs";
import { resolveMediaFile, contentTypeFor } from "./media";

/**
 * A photo named on a day (`media[].src`, always `/media/<trip>/<day>/<file>`)
 * → a data URI `ImageResponse`/ffmpeg can read, or `null` for anything that
 * does not resolve to a real image under this trip's own media directory.
 *
 * Goes through `resolveMediaFile` — the exact function
 * `app/at/[user]/media/[...path]/route.ts` resolves every served photograph
 * through — so a `src` built from day-file content can never walk outside
 * the owner's own media folder (B1892's guard, reused rather than
 * reimplemented). Never a video: "Share as a story" draws stills only.
 */
export function storyPhotoFile(username: string, src: string): string | null {
  if (!src.startsWith("/media/")) return null;
  const segments = src.slice("/media/".length).split("/");
  const file = resolveMediaFile(username, segments);
  if (!file) return null;
  const type = contentTypeFor(file);
  if (!type.startsWith("image/")) return null;
  return file;
}

export function storyPhotoDataUri(username: string, src: string): string | null {
  const file = storyPhotoFile(username, src);
  if (!file) return null;
  try {
    const bytes = fs.readFileSync(file);
    const type = contentTypeFor(file);
    return `data:${type};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}
