import "server-only";
import fs from "node:fs";
import path from "node:path";
import { contentRoot } from "../contentRoot";

/**
 * The rendered card SVGs on disk — B2538, the same shape `lib/media.ts`'s
 * resized-photo cache already keeps: outside anything a route resolves a
 * path into, under the content root's own `.cache/` (`content/.cache/maps/`,
 * gitignored by the same `content/.cache/` rule that already covers media).
 *
 * Keyed by `key` alone — the caller (`lib/map/cardSvg.ts`) hashes every
 * input that can change what is drawn (places, track, a region file's
 * mtime), so a hit here is always the right bytes, and a miss is simply "not
 * built yet", the same as `lib/basemap.ts`'s bundle read: absence is not a
 * fault.
 */
function cacheDir(): string {
  return path.join(contentRoot(), ".cache", "maps");
}

export function readCachedCardSvg(key: string): string | null {
  try {
    return fs.readFileSync(path.join(cacheDir(), `${key}.svg`), "utf8");
  } catch {
    return null;
  }
}

export function writeCachedCardSvg(key: string, svg: string): void {
  try {
    fs.mkdirSync(cacheDir(), { recursive: true });
    fs.writeFileSync(path.join(cacheDir(), `${key}.svg`), svg);
  } catch {
    // A cache write that fails (a read-only mount, a full disk) is not worth
    // failing the page over — the caller already has the SVG in hand and
    // just redraws it next time. Same reasoning as `lib/basemap.ts` treating
    // "cannot read" as "draw without it" rather than throwing.
  }
}

/** Test/tooling seam. */
export function clearCardCache(): void {
  try {
    fs.rmSync(cacheDir(), { recursive: true, force: true });
  } catch {
    // Never built — nothing to clear.
  }
}
