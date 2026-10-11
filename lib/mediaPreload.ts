import type { GalleryItem } from "./types";
import { mediaLoader, posterSrc } from "../components/mediaLoader";
import { POSTER_WIDTH } from "./mediaSizes";

/**
 * B-2980 — what the full-screen viewer warms before a swipe, and the one rule
 * for playback. Pure, so both can be tested without a browser.
 */

/** Width the viewer asks for on a phone: the same derivative family the grid and `FullPhoto` use. */
const VIEWER_WIDTH = 1080;

/** The image (or a video's poster) at `index`, as a derivative URL; null when there is nothing to draw. */
function frameUrl(item: GalleryItem | undefined): string | null {
  if (!item) return null;
  if (item.type === "video") return posterSrc(item.poster, POSTER_WIDTH.FULL) ?? null;
  return mediaLoader({ src: item.src, width: VIEWER_WIDTH });
}

/** URLs worth fetching ahead while `index` is open: the next, then the previous (wrapping like the viewer). */
export function viewerWarmUrls(items: readonly GalleryItem[], index: number | null, saveData = false): string[] {
  if (saveData || index === null || items.length < 2) return [];
  const n = items.length;
  return [items[(index + 1) % n], items[(index - 1 + n) % n]]
    .map(frameUrl)
    .filter((u): u is string => u !== null);
}

/** The next clip's source, whose metadata (duration, first frame) is worth having — not its bytes. */
export function nextVideoSrc(items: readonly GalleryItem[], index: number | null, saveData = false): string | null {
  if (saveData || index === null || items.length < 2) return null;
  const next = items[(index + 1) % items.length];
  return next.type === "video" ? next.src : null;
}

/** Only one clip plays at a time: every other one is paused. */
export function pauseOthers<T extends { pause: () => void }>(playing: T, all: Iterable<T>): void {
  for (const v of all) if (v !== playing) v.pause();
}
