import type { GalleryItem } from "./types";
import { posterSrc } from "../components/mediaLoader";
import { POSTER_WIDTH, VIEWER_SIZES, isResizable, viewerSrcSet } from "./mediaSizes";

/**
 * B-2980 — what the full-screen viewer warms before a swipe, and the one rule
 * for playback. Pure, so both can be tested without a browser.
 */

/** What to fetch ahead: a poster is one URL; a photograph is the viewer's own srcset, sizes and fallback. */
export type WarmFrame = { src: string; srcSet?: string; sizes?: string };

function frame(item: GalleryItem | undefined): WarmFrame | null {
  if (!item) return null;
  if (item.type === "video") {
    const src = posterSrc(item.poster, POSTER_WIDTH.FULL);
    return src ? { src } : null;
  }
  return isResizable(item.src) ? { src: item.src, srcSet: viewerSrcSet(item.src), sizes: VIEWER_SIZES } : { src: item.src };
}

/** Frames worth fetching ahead while `index` is open: the next, then the previous (wrapping like the viewer). */
export function viewerWarmFrames(items: readonly GalleryItem[], index: number | null, saveData = false): WarmFrame[] {
  if (saveData || index === null || items.length < 2) return [];
  const n = items.length;
  return [items[(index + 1) % n], items[(index - 1 + n) % n]].map(frame).filter((f): f is WarmFrame => f !== null);
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
