/**
 * Widths the media route will resize to.
 *
 * Client-safe: the loader in `components/mediaLoader.ts` imports this too, and
 * both ends have to agree or every request misses the cache.
 *
 * An allow-list rather than any number the caller asks for. A resize is the
 * most expensive thing this server does, and `?w=` straight off the query
 * string is an invitation to ask for a thousand distinct widths of the same
 * photograph and fill the disk with the answers.
 */
export const MEDIA_WIDTHS = [160, 320, 480, 640, 828, 1080, 1200, 1600, 2000] as const;

/**
 * The same list, split the way `next.config.ts` has to hand it to `next/image`.
 *
 * `<Image>` builds its `srcset` from `deviceSizes` and `imageSizes` and then
 * asks the loader for each width, and the loader can only answer with one of
 * `MEDIA_WIDTHS`. With Next's defaults (640, 750, 828 … 3840 and 32 … 384)
 * that meant a `srcset` whose `750w` and `828w` both pointed at `?w=828`, and
 * whose `1920w`, `2048w` and `3840w` were all the same 2000px file — three
 * candidates claiming to be sharper than they were, and a browser on a wide
 * retina screen believing it had been handed a 3840px picture. Deriving the
 * config from this list is what keeps every candidate honest: one `srcset`
 * entry per width the route actually makes.
 *
 * Next wants every `imageSizes` entry below the smallest `deviceSizes` one,
 * and 640 is where its own default device list starts, so that is the split.
 *
 * **160 exists for the thumbnails and nothing else.** The slideshow's strip of
 * days is drawn at 44px and the map's popup at 56px; the smallest width on
 * offer used to be 320, which at three device pixels per CSS pixel is still
 * two and a half times what either needs.
 */
export const NEXT_DEVICE_SIZES = MEDIA_WIDTHS.filter((w) => w >= 640);
export const NEXT_IMAGE_SIZES = MEDIA_WIDTHS.filter((w) => w < 640);

/**
 * The widths a trip's photo grids ask for, which are the ones worth making
 * the moment a photograph lands rather than on the first page view.
 *
 * Worked from the `sizes` the two grids declare (`GalleryGrid`, `Gallery`):
 * 320 is a quarter-width tile on a laptop at 1x, 480 a day-page tile at 1x
 * and a phone tile at 2x, and 640 a phone tile at 3x and a laptop tile at 2x.
 * The open photograph is left to be made on demand — one is opened at a time,
 * and guessing its width would mean guessing the reader's screen.
 */
export const WARM_WIDTHS = [320, 480, 640] as const;

/**
 * The width a clip's still frame is asked for — one width, because `poster`
 * is a single URL and has no `srcset`. `GRID` for the tiles (a phone tile at
 * 3x, a laptop tile at 2x) and `FULL` for the viewer and the slideshow, where
 * it stands in for the whole frame until the first video frame paints.
 */
export const POSTER_WIDTH = { GRID: 640, FULL: 1200 } as const;

/** The smallest allowed width that still covers what was asked for. */
export function nearestWidth(requested: number): number {
  return MEDIA_WIDTHS.find((w) => w >= requested) ?? MEDIA_WIDTHS[MEDIA_WIDTHS.length - 1];
}

/** Reads `?w=` off a media URL, or null for "serve the file as it is". */
export function parseWidth(value: string | null): number | null {
  if (!value) return null;
  const asked = Number(value);
  if (!Number.isFinite(asked) || asked <= 0) return null;
  return nearestWidth(Math.round(asked));
}
