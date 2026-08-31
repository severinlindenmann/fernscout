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
export const MEDIA_WIDTHS = [320, 480, 640, 828, 1080, 1200, 1600, 2000] as const;

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
