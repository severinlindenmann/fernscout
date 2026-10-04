// Client-side helpers for "figures from a group photo" (B-2847). The owner
// taps people in a photo; each tap is cropped in the browser and only the
// crop is ever sent. No dependency: a canvas does the cropping, and the
// original File never leaves the page.

export type Marker = { n: number; x: number; y: number };
export type CropBox = { sx: number; sy: number; size: number };

/** At most this many people per photo: one describe request each. */
export const MAX_MARKERS = 8;

/**
 * A generous square around a tap (fractions 0..1 of the photo): wide enough
 * to take in a head and shoulders of one person, about a third of the photo's
 * width, never larger than the photo and kept inside it.
 */
export function cropBox(marker: Pick<Marker, "x" | "y">, width: number, height: number): CropBox {
  const size = Math.round(Math.min(width, height, width * 0.34));
  const sx = Math.min(Math.max(0, Math.round(marker.x * width - size / 2)), width - size);
  const sy = Math.min(Math.max(0, Math.round(marker.y * height - size / 2)), height - size);
  return { sx, sy, size };
}

export type OpenedPhoto = {
  url: string;
  width: number;
  height: number;
  /** One cropped region as a JPEG blob (max 768 px a side). */
  crop: (box: CropBox) => Promise<Blob>;
  close: () => void;
};

/** Decode a chosen file in the browser. The bytes stay local. */
export async function openPhoto(file: File): Promise<OpenedPhoto> {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch {
    URL.revokeObjectURL(url);
    throw new Error("unreadable");
  }
  return {
    url,
    width: img.naturalWidth,
    height: img.naturalHeight,
    crop: (box) =>
      new Promise((resolve, reject) => {
        const out = Math.min(box.size, 768);
        const canvas = document.createElement("canvas");
        canvas.width = out;
        canvas.height = out;
        canvas.getContext("2d")?.drawImage(img, box.sx, box.sy, box.size, box.size, 0, 0, out, out);
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("crop"))), "image/jpeg", 0.85);
      }),
    close: () => URL.revokeObjectURL(url),
  };
}
