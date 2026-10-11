import { describe, expect, it, vi } from "vitest";
import { nextVideoSrc, pauseOthers, viewerWarmUrls } from "@/lib/mediaPreload";
import type { GalleryItem } from "@/lib/types";

const items = [
  { type: "image", src: "/m/a.jpg" },
  { type: "video", src: "/m/b.mp4", poster: "/m/b.jpg" },
  { type: "image", src: "/m/c.jpg" },
] as unknown as GalleryItem[];

describe("viewer preload (B-2980)", () => {
  it("warms the next and previous frame, a video as its poster", () => {
    expect(viewerWarmUrls(items, 0)).toEqual(["/m/b.jpg?w=1200", "/m/c.jpg?w=1080"]);
    expect(viewerWarmUrls(items, 1)).toEqual(["/m/c.jpg?w=1080", "/m/a.jpg?w=1080"]);
  });
  it("does nothing for one photo, a closed viewer or saveData", () => {
    expect(viewerWarmUrls(items.slice(0, 1), 0)).toEqual([]);
    expect(viewerWarmUrls(items, null)).toEqual([]);
    expect(viewerWarmUrls(items, 0, true)).toEqual([]);
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
