"use client";

import { useEffect } from "react";
import { useTrip } from "@/components/TripProvider";
import { useI18n } from "@/components/LocaleProvider";
import { nextVideoSrc, viewerWarmFrames, type WarmFrame } from "@/lib/mediaPreload";
import { photoUrlsToWarm, prefetchAround, savesData, type StoryFetch } from "@/lib/map/storyCache";
import type { GalleryItem } from "@/lib/types";

const fetchWindow: StoryFetch = (url) => fetch(url).then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))));

const saveData = () => (typeof navigator === "undefined" ? false : savesData(navigator as Navigator & { connection?: { saveData?: boolean } }));

function warmImages(urls: string[]): void {
  for (const u of urls) new Image().src = u;
}

/** Same attribute order as the viewer's picture: sizes and srcset before src, so the browser picks the width the viewer will. */
function warmFrames(frames: WarmFrame[]): void {
  for (const f of frames) {
    const img = new Image();
    if (f.sizes) img.sizes = f.sizes;
    if (f.srcSet) img.srcset = f.srcSet;
    img.src = f.src;
    img.decode?.().catch(() => {});
  }
}

/**
 * Once a day is selected: its story window and its neighbours' are fetched in
 * idle time, and the first photographs of it and of the next day are decoded
 * ahead. Nothing at all under saveData. `galleryOf` gives a day index's photographs.
 */
export function usePrefetchDays(index: number, count: number, galleryOf: (i: number) => readonly GalleryItem[]): void {
  const trip = useTrip();
  const { locale } = useI18n();
  const ref = trip?.trip.ref;
  const base = trip?.userHref("/story.json");
  useEffect(() => {
    if (index < 0 || !ref || !base || saveData()) return;
    const idle = window.requestIdleCallback ?? ((cb: () => void) => window.setTimeout(cb, 200));
    const cancel = window.cancelIdleCallback ?? window.clearTimeout;
    const h = idle(() => {
      prefetchAround(base, ref, locale, index, count, fetchWindow);
      warmImages([...photoUrlsToWarm(galleryOf(index)), ...photoUrlsToWarm(galleryOf(index + 1))]);
    });
    return () => cancel(h as number);
    // galleryOf is rebuilt every render; its inputs are the index and the days.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, count, ref, base, locale]);
}

/** In the full-screen viewer: the next and previous frame (and the next clip's metadata) ahead of a swipe. */
export function useViewerPreload(items: readonly GalleryItem[], index: number | null): void {
  useEffect(() => {
    const sd = saveData();
    warmFrames(viewerWarmFrames(items, index, sd));
    const src = nextVideoSrc(items, index, sd);
    if (!src) return;
    const v = document.createElement("video");
    v.preload = "metadata";
    v.src = src;
    return () => {
      v.removeAttribute("src");
      v.load();
    };
  }, [items, index]);
}
