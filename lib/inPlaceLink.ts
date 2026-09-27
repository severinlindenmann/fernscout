import type { MouseEvent } from "react";

/**
 * A real link that the story follows in place — B2477.
 *
 * The day list and the pager were buttons, so a crawler found no link to any
 * day and a reader could not open one in a new tab. They are anchors now,
 * each with the day's own permalink, and a plain click still moves the story
 * without a page load. A modified click (new tab, new window, download) is
 * left to the browser. Anchors that use this carry `data-in-place`, which is
 * how `NavProgress` knows not to start its bar for them.
 */
export function followInPlace(e: MouseEvent, go: () => void): void {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  go();
}
