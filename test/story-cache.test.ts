import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cachedDay,
  clearStoryCache,
  neighbourIndexes,
  photoUrlsToWarm,
  prefetchAround,
  savesData,
  windowFor,
  type StoryFetch,
} from "@/lib/map/storyCache";
import type { StoryDay } from "@/lib/prose";
import type { GalleryItem } from "@/lib/types";

const day = (date: string) => ({ date }) as unknown as StoryDay;
const dates = ["2026-08-01", "2026-08-02", "2026-08-03", "2026-08-04", "2026-08-05"];
const server: StoryFetch = vi.fn(async (url) => {
  const from = Number(new URL(url, "http://x").searchParams.get("from"));
  return { from, days: dates.slice(from, from + 3).map(day) };
});

describe("story cache (B-2980)", () => {
  beforeEach(() => {
    clearStoryCache();
    vi.mocked(server).mockClear();
  });

  it("chooses the selected day, then next, then previous, inside the trip", () => {
    expect(neighbourIndexes(0, 5)).toEqual([0, 1]);
    expect(neighbourIndexes(2, 5)).toEqual([2, 3, 1]);
    expect(neighbourIndexes(4, 5)).toEqual([4, 3]);
    expect(windowFor(0)).toEqual({ from: 0, to: 3 });
    expect(windowFor(3)).toEqual({ from: 2, to: 5 });
  });

  it("keeps each day of a fetched window and does not fetch twice", async () => {
    prefetchAround("/u/story.json", "u/t", "en", 2, 5, server);
    await vi.waitFor(() => expect(cachedDay("/u/story.json", "u/t", "en", 3)).toBeDefined());
    expect(cachedDay("/u/story.json", "u/t", "en", 2, "2026-08-03")?.date).toBe("2026-08-03");
    expect(cachedDay("/u/story.json", "u/t", "en", 2, "2026-01-01")).toBeUndefined();
    const calls = vi.mocked(server).mock.calls.length;
    prefetchAround("/u/story.json", "u/t", "en", 2, 5, server);
    expect(vi.mocked(server).mock.calls.length).toBe(calls);
  });

  it("is keyed by language, and swallows a failed fetch", async () => {
    prefetchAround("/u/story.json", "u/t", "en", 0, 5, server);
    await vi.waitFor(() => expect(cachedDay("/u/story.json", "u/t", "en", 0)).toBeDefined());
    expect(cachedDay("/u/story.json", "u/t", "de", 0)).toBeUndefined();
    const failing: StoryFetch = async () => {
      throw new Error("offline");
    };
    expect(() => prefetchAround("/u/story.json", "u/t", "fr", 0, 5, failing)).not.toThrow();
  });

  it("honours saveData and warms only the first three derivatives", () => {
    expect(savesData({ connection: { saveData: true } })).toBe(true);
    expect(savesData({ connection: {} })).toBe(false);
    expect(savesData(undefined)).toBe(false);
    const g = [
      { type: "image", src: "/m/a.jpg" },
      { type: "video", src: "/m/b.mp4", poster: "/m/b.jpg" },
      { type: "video", src: "/m/c.mp4" },
      { type: "image", src: "/m/d.jpg" },
    ] as unknown as GalleryItem[];
    expect(photoUrlsToWarm(g)).toEqual(["/m/a.jpg?w=640", "/m/b.jpg?w=640"]);
  });
});
