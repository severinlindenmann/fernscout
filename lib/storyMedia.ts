import "server-only";
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

/**
 * A photo named on a day, smart-cropped (sharp's attention strategy — the
 * same guess a thumbnail would make) to the box it will actually fill on a
 * story card, at twice the box's own size so a 1x render still reads sharp.
 * B2665 round 2: before this, the full photo was handed to `objectFit:
 * cover` and whichever edge the browser happened to keep was whatever edge
 * it was — attention-cropping first means the subject itself survives.
 */
export async function storyPhotoCroppedDataUri(
  username: string,
  src: string,
  box: { width: number; height: number },
): Promise<string | null> {
  const file = storyPhotoFile(username, src);
  if (!file) return null;
  try {
    const sharp = (await import("sharp")).default;
    const bytes = await sharp(file, { failOn: "error" })
      .rotate()
      .resize(box.width * 2, box.height * 2, { fit: "cover", position: sharp.strategy.attention })
      .jpeg({ quality: 82 })
      .toBuffer();
    return `data:image/jpeg;base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}
