import { describe, expect, it, vi } from "vitest";
import { nextVideoSrc, pauseOthers, viewerWarmFrames } from "@/lib/mediaPreload";
import { VIEWER_SIZES, viewerSrcSet } from "@/lib/mediaSizes";
import type { GalleryItem } from "@/lib/types";

const items = [
  { type: "image", src: "/m/a.jpg" },
  { type: "video", src: "/m/b.mp4", poster: "/m/b.jpg" },
  { type: "image", src: "/m/c.jpg" },
] as unknown as GalleryItem[];

describe("viewer preload (B-2980)", () => {
  it("warms the next and previous with the viewer's own srcset and sizes, a video as its poster", () => {
    const img = (src: string) => ({ src, srcSet: viewerSrcSet(src), sizes: VIEWER_SIZES });
    expect(viewerWarmFrames(items, 0)).toEqual([{ src: "/m/b.jpg?w=1200" }, img("/m/c.jpg")]);
    expect(viewerWarmFrames(items, 1)).toEqual([img("/m/c.jpg"), img("/m/a.jpg")]);
    expect(viewerSrcSet("/m/a.jpg")).toContain("/m/a.jpg?w=1200 1200w");
  });
  it("leaves absolute and svg sources as they are", () => {
    const odd = [{ type: "image", src: "/m/a.jpg" }, { type: "image", src: "https://x/y.jpg" }, { type: "image", src: "/m/z.svg" }] as unknown as GalleryItem[];
    expect(viewerWarmFrames(odd, 0)).toEqual([{ src: "https://x/y.jpg" }, { src: "/m/z.svg" }]);
  });
  it("does nothing for one photo, a closed viewer or saveData", () => {
    expect(viewerWarmFrames(items.slice(0, 1), 0)).toEqual([]);
    expect(viewerWarmFrames(items, null)).toEqual([]);
    expect(viewerWarmFrames(items, 0, true)).toEqual([]);
    expect(nextVideoSrc(items, 0, true)).toBeNull();
  });
  it("names the next clip only when the next item is one", () => {
    expect(nextVideoSrc(items, 0)).toBe("/m/b.mp4");
    expect(nextVideoSrc(items, 1)).toBeNull();
  });
  it("pauses every other clip", () => {
    const a = { pause: vi.fn() };
    const b = { pause: vi.fn() };
    pauseOthers(a, [a, b]);
    expect(a.pause).not.toHaveBeenCalled();
    expect(b.pause).toHaveBeenCalledOnce();
  });
});
