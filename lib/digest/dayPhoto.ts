import "server-only";
import { resolveMediaFile } from "../media";
import type { Entry, Trip } from "../types";
import type { WhatsappPhoto } from "../whatsapp/types";

/**
 * The day's first photograph, re-encoded as a JPEG small enough for WhatsApp.
 *
 * **Why this is not `resizedCopy`.** That function is the site's, and it
 * emits WebP — the right answer for a browser and one WhatsApp rejects
 * outright: a template's image header accepts JPEG and PNG and nothing else.
 * Handing it a WebP produces an upload Meta refuses, so the announcement
 * arrives with no picture or not at all, depending on whether the template's
 * header is required. Sharing the cache was tempting and would have been a
 * bug with a plausible-looking call site.
 *
 * 1280px because the header is displayed a few centimetres wide on a phone
 * and the ceiling is 5 MB; quality 80 puts an ordinary photograph an order of
 * magnitude under it. `withoutEnlargement` so a small original is sent as it
 * is rather than upscaled into blur.
 *
 * Best-effort throughout, exactly like `photoAttachment` in the mail path: a
 * missing file, a video, an unreadable JPEG all mean no photograph rather
 * than a failed announcement.
 */
const HEADER_WIDTH = 1280;
const HEADER_QUALITY = 80;
/** WhatsApp's own ceiling for an image. A file over it is refused on upload. */
const MAX_BYTES = 5 * 1024 * 1024;

export async function headerPhoto(trip: Trip, entry: Entry): Promise<WhatsappPhoto | null> {
  // The first *image*: a video cannot be a template header, and a gallery
  // that opens with a clip should still send its first photograph.
  const image = entry.gallery.find((item) => item.type === "image");
  if (!image) return null;

  // `entry.gallery[*].src` is owner-prefixed by `lib/entries.ts` —
  // `/{username}/media/{tripId}/{path}` — the shape the media route resolves.
  const prefix = `/${trip.username}/media/`;
  if (!image.src.startsWith(prefix)) return null;
  const segments = image.src.slice(prefix.length).split("/").filter(Boolean);
  const file = resolveMediaFile(trip.username, segments);
  if (!file) return null;

  try {
    const sharp = (await import("sharp")).default;
    const data = await sharp(file, { failOn: "error" })
      // Honour the EXIF orientation, or a portrait photograph arrives on its
      // side — the header is the first thing anybody sees.
      .rotate()
      .resize(HEADER_WIDTH, undefined, { withoutEnlargement: true })
      .jpeg({ quality: HEADER_QUALITY })
      .toBuffer();

    // Refuse rather than upload something Meta will reject: the caller reads
    // null as "no photograph", which is a state it already handles.
    if (data.length > MAX_BYTES) return null;

    return { data, contentType: "image/jpeg", filename: "day.jpg" };
  } catch {
    return null;
  }
}
