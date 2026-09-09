import "server-only";
import sharp from "sharp";
import type { Photobook } from "./plan.ts";
import { requiredPixels, type BookSpec } from "./spec.ts";

/**
 * Photographs at the size they are actually printed, and not one pixel more —
 * B1172.
 *
 * A JPEG used to go into the book byte-for-byte, which is what
 * `lib/postcard/pdf.ts` does and is right for a postcard: one photograph, one
 * card, and the bytes the sensor wrote. A photobook is sixty of them, and the
 * arithmetic is unforgiving — a 5712 × 4284 frame placed 120 mm wide carries
 * six times the data a press can use. The Algarve book came to **356 MB** and
 * Gelato's prepress rendered the cover and gave up on the interior.
 *
 * So each photograph is re-encoded to its own placed size at `PRINT_DPI`
 * before it is embedded. It is still a JPEG and still embeds as a DCTDecode
 * stream; only the bytes change.
 *
 * ## Two things that would be wrong to do
 *
 * **Never upscale.** A photograph smaller than the space it is given keeps its
 * own pixels — enlarging it invents detail and grows the file to say nothing.
 * The planner already warns about those (`low-resolution`), and that warning
 * must keep meaning what it says.
 *
 * **Orientation is baked, not carried.** `readJpeg` reads the EXIF tag and
 * `ORIENTATIONS` in `lib/postcard/pdf.ts` turns the picture inside its
 * rectangle. `sharp.rotate()` applies the tag to the pixels and writes no
 * metadata, so a re-encoded photograph arrives as orientation 1 and that
 * transform is the identity — rotated once, by whichever of the two did it. An
 * image left alone keeps its tag and is turned the old way. Both paths are
 * consistent; what would not be is baking the rotation *and* keeping the tag,
 * which turns every sideways photograph twice.
 */
const PRINT_DPI = 300;

/**
 * Quality and chroma, chosen for paper rather than for a screen.
 *
 * 4:4:4 keeps the colour channels at full resolution: chroma subsampling is
 * invisible on a phone and shows on a printed edge between two saturated
 * colours. At this quality the saving is still an order of magnitude.
 */
const JPEG_QUALITY = 88;

/**
 * The largest each photograph is drawn at, anywhere in the book, in mm.
 *
 * `PhotoPlacement.draw` is the rectangle the whole image is drawn into —
 * larger than the slot when it is cover-cropped — so it is the extent of the
 * picture and the right thing to size against. One photograph can appear more
 * than once at different sizes; the largest wins, because a second copy at a
 * second size would be a second megabyte for nothing.
 */
function drawnSizes(book: Photobook, spec: BookSpec): Map<string, number> {
  const widest = new Map<string, number>();
  const note = (file: string, mm: number) =>
    widest.set(file, Math.max(widest.get(file) ?? 0, mm));

  for (const volume of book.volumes) {
    for (const page of volume.pages) {
      if (page.kind === "photos") {
        for (const p of page.placements) {
          note(p.photo.file, Math.max(p.draw.width, p.draw.height));
        }
      }
      if (page.kind === "day" && page.photo) {
        const d = page.photo.draw;
        note(page.photo.photo.file, Math.max(d.width, d.height));
      }
    }
    // The cover photograph fills the front panel, and `renderCover` owns that
    // geometry. Sized here against the trimmed page plus its bleed rather than
    // by reaching into it: an over-estimate costs a few hundred kilobytes on
    // one image, and an under-estimate is a soft cover.
    if (volume.cover.frontPhoto) {
      note(volume.cover.frontPhoto.file, spec.size.trimWidthMm + spec.bleedMm * 2);
    }
  }
  return widest;
}

/**
 * Every photograph the book uses, re-encoded for print.
 *
 * Returns the bytes to embed, keyed by the same file reference the planner
 * uses. A file that fails to load or convert is absent from the map, and the
 * caller falls back to reading it from disk — the renderer already has a
 * `missing` path for a photograph it cannot read, and this must not become a
 * second way for a book to lose one.
 */
export async function printReadyImages(
  book: Photobook,
  spec: BookSpec,
  load: (file: string) => Uint8Array,
): Promise<Map<string, Uint8Array>> {
  const out = new Map<string, Uint8Array>();
  for (const [file, widthMm] of drawnSizes(book, spec)) {
    const target = requiredPixels(widthMm, PRINT_DPI);
    let source: Uint8Array;
    try {
      source = load(file);
    } catch {
      continue; // `loadAll` will try again and record it as missing.
    }
    try {
      const converted = await sharp(Buffer.from(source))
        // Apply the EXIF orientation to the pixels, and write no metadata —
        // see the note above about turning a photograph twice.
        .rotate()
        // `inside` bounds the longest edge; `withoutEnlargement` is what makes
        // "never upscale" true rather than intended.
        .resize({ width: target, height: target, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: JPEG_QUALITY, chromaSubsampling: "4:4:4", progressive: false })
        .toBuffer();
      // Only if it actually helped. A small photograph re-encoded can come out
      // larger than it went in, and then the original is the better answer.
      out.set(file, converted.length < source.length ? new Uint8Array(converted) : source);
    } catch {
      out.set(file, source);
    }
  }
  return out;
}
