// @vitest-environment jsdom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";
import PhotoTile from "@/components/extract/PhotoTile";
import PhotoViewer from "@/components/extract/PhotoViewer";

/**
 * B1803 Task 1.2 — the tile's badge mapping, its video placeholder, and the
 * object-URL lifecycle for a local, not-yet-uploaded `File`.
 *
 * jsdom carries no `URL.createObjectURL`/`revokeObjectURL` at all (verified
 * against the jsdom this repo pins), so both are stubbed here rather than
 * left to throw — the stub is what makes the revoke-on-unmount assertion
 * possible in the first place.
 */

let root: Root | undefined;
let container: HTMLDivElement | undefined;
let created: string[] = [];
let revoked: string[] = [];

function render(node: React.ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
        {node}
      </LocaleProvider>,
    );
  });
}

beforeEach(() => {
  created = [];
  revoked = [];
  let n = 0;
  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: vi.fn((f: File) => {
      const url = `blob:mock-${n++}-${f.name}`;
      created.push(url);
      return url;
    }),
    revokeObjectURL: vi.fn((url: string) => {
      revoked.push(url);
    }),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

function file(name: string): File {
  return new File(["x"], name, { type: "image/jpeg" });
}

describe("PhotoTile badges", () => {
  test("done draws the checkmark glyph with the shared 'done' accessible name", () => {
    render(<PhotoTile size="grid" kind="image" src="/thumb.jpg" alt="a photo" badge={{ tone: "done" }} />);
    const badge = container!.querySelector("span[aria-label]")!;
    expect(badge.getAttribute("aria-label")).toBe("done");
    expect(badge.textContent).toBe("✓");
  });

  test("failed draws the exclamation glyph with the shared 'failed' accessible name", () => {
    render(<PhotoTile size="grid" kind="image" src="/thumb.jpg" alt="a photo" badge={{ tone: "failed" }} />);
    const badge = container!.querySelector("span[aria-label]")!;
    expect(badge.getAttribute("aria-label")).toBe("failed");
    expect(badge.textContent).toBe("!");
  });

  test("queued prints the translated word itself, not a glyph", () => {
    render(<PhotoTile size="grid" kind="image" src="/thumb.jpg" alt="a photo" badge={{ tone: "queued" }} />);
    const badge = container!.querySelector("span")!;
    expect(badge.textContent).toBe("queued");
  });

  test("progress prints the percentage handed to it, not a fixed label", () => {
    render(
      <PhotoTile size="grid" kind="image" src="/thumb.jpg" alt="a photo" badge={{ tone: "progress", percent: 62 }} />,
    );
    const badge = container!.querySelector("span")!;
    expect(badge.textContent).toBe("62%");
  });

  test("no badge renders no badge element", () => {
    render(<PhotoTile size="grid" kind="image" src="/thumb.jpg" alt="a photo" />);
    expect(container!.querySelector("span[aria-label], span.absolute")).toBeNull();
  });
});

describe("PhotoTile and a video", () => {
  test("a staged video displays its looping preview with a video label", () => {
    render(<PhotoTile size="grid" kind="video" src="/studio/thumb/clip.mov" alt="a clip" />);
    expect(container!.querySelector("img")?.getAttribute("src")).toBe("/studio/thumb/clip.mov");
    expect(container!.querySelector("video")).toBeNull();
    expect(container!.textContent).toContain("Video");
  });

  test("a local video uses a muted inline preview", () => {
    render(<PhotoTile size="grid" kind="video" file={new File(["x"], "clip.mov", { type: "video/quicktime" })} alt="a clip" />);
    expect(container!.querySelector("img")).toBeNull();
    expect(container!.querySelector("video")?.getAttribute("src")).toBe(created[0]);
    expect(container!.querySelector("video")?.muted).toBe(true);
  });

  test("a failed video preview shows a placeholder without retrying", () => {
    render(<PhotoTile size="grid" kind="video" src="/studio/thumb/clip.mov" alt="a clip" />);
    act(() => container!.querySelector("img")!.dispatchEvent(new Event("error")));
    expect(container!.querySelector("img, video")).toBeNull();
    expect(container!.textContent).toContain("Video");
  });

  test("the enlarged viewer loops the staged preview as an image, not an unplayable WebP video", () => {
    render(<PhotoViewer items={[{ id: "clip", kind: "video", src: "/studio/thumb/clip.mov" }]} index={0} onClose={() => {}} onPrev={() => {}} onNext={() => {}} />);
    expect(document.querySelector("[role=dialog] img")?.getAttribute("src")).toBe("/studio/thumb/clip.mov");
    expect(document.querySelector("[role=dialog] video")).toBeNull();
  });

  test("an image whose src later 404s falls back to the placeholder once, with no retry", () => {
    render(<PhotoTile size="grid" kind="image" src="/thumb.jpg" alt="a photo" />);
    const img = container!.querySelector("img")!;
    const initialSrc = img.getAttribute("src");
    act(() => {
      img.dispatchEvent(new Event("error"));
    });
    // The placeholder is up and the <img> is gone — nothing left to retry.
    expect(container!.querySelector("img")).toBeNull();
    expect(initialSrc).toBe("/thumb.jpg");
  });
});

describe("PhotoTile and a local File", () => {
  test("passing `file` creates exactly one object URL and draws it", () => {
    render(<PhotoTile size="grid" kind="image" file={file("a.jpg")} alt="a local photo" />);
    expect(created.length).toBe(1);
    const img = container!.querySelector("img")!;
    expect(img.getAttribute("src")).toBe(created[0]);
  });

  test("unmounting revokes the object URL it created", () => {
    render(<PhotoTile size="grid" kind="image" file={file("a.jpg")} alt="a local photo" />);
    const url = created[0];
    act(() => root?.unmount());
    root = undefined;
    expect(revoked).toContain(url);
  });

  test("swapping the file revokes the old URL and creates a new one", () => {
    const first = file("first.jpg");
    render(<PhotoTile size="grid" kind="image" file={first} alt="a local photo" />);
    const firstUrl = created[0];

    const second = file("second.jpg");
    act(() => {
      root!.render(
        <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
          <PhotoTile size="grid" kind="image" file={second} alt="a local photo" />
        </LocaleProvider>,
      );
    });

    expect(revoked).toContain(firstUrl);
    expect(created.length).toBe(2);
    const img = container!.querySelector("img")!;
    expect(img.getAttribute("src")).toBe(created[1]);
  });

  test("`file` takes priority over `src` when both are given", () => {
    render(<PhotoTile size="grid" kind="image" src="/never.jpg" file={file("a.jpg")} alt="a local photo" />);
    const img = container!.querySelector("img")!;
    expect(img.getAttribute("src")).not.toBe("/never.jpg");
    expect(img.getAttribute("src")).toBe(created[0]);
  });
  test("`file` takes priority over `src` when both are given", () => {
    render(<PhotoTile size="grid" kind="image" src="/never.jpg" file={file("a.jpg")} alt="a local photo" />);
    const img = container!.querySelector("img")!;
    expect(img.getAttribute("src")).not.toBe("/never.jpg");
    expect(img.getAttribute("src")).toBe(created[0]);
  });

  // B1883 — under `next dev`, Strict Mode's mount → cleanup → remount left
  // every local preview pointing at a URL it had already revoked. This is
  // the regression check: mount the same tile under `<StrictMode>`, which
  // makes react-dom run exactly that double-invoke sequence, and assert the
  // `<img>` ends up on a URL that was never revoked.
  test("under Strict Mode's double-invoked effects, the painted url is never one that got revoked", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => {
      root!.render(
        <StrictMode>
          <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
            <PhotoTile size="grid" kind="image" file={file("a.jpg")} alt="a local photo" />
          </LocaleProvider>
        </StrictMode>,
      );
    });
    const img = container!.querySelector("img")!;
    const paintedSrc = img.getAttribute("src");
    expect(paintedSrc).toBeTruthy();
    expect(revoked).not.toContain(paintedSrc);
  });
});

/**
 * B1874 — a HEIC has no local preview in any browser but Safari, so the tile
 * falls through to the staged one the server made rather than giving up on
 * the first source.
 */
describe("PhotoTile and a file the browser cannot decode", () => {
  function rerender(node: React.ReactElement) {
    act(() => {
      root!.render(
        <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
          {node}
        </LocaleProvider>,
      );
    });
  }

  test("a failed local preview falls through to the staged one", () => {
    const heic = file("IMG_0001.heic");
    render(<PhotoTile size="grid" kind="image" file={heic} src="/thumb/staged.webp" alt="a photo" />);
    expect(container!.querySelector("img")!.getAttribute("src")).toBe(created[0]);
    act(() => container!.querySelector("img")!.dispatchEvent(new Event("error")));
    expect(container!.querySelector("img")!.getAttribute("src")).toBe("/thumb/staged.webp");
  });

  test("a local file with no staged preview yet pulses rather than looking broken", () => {
    const heic = file("IMG_0001.heic");
    render(<PhotoTile size="grid" kind="image" file={heic} alt="a photo" />);
    act(() => container!.querySelector("img")!.dispatchEvent(new Event("error")));
    expect(container!.querySelector("img")).toBeNull();
    expect(container!.querySelector(".animate-pulse")).not.toBeNull();

    // The upload answers with an id: the tile tries the staged preview.
    rerender(<PhotoTile size="grid" kind="image" file={heic} src="/thumb/staged.webp" alt="a photo" />);
    expect(container!.querySelector("img")!.getAttribute("src")).toBe("/thumb/staged.webp");
  });

  test("both sources failing is the placeholder, and nothing is asked for twice", () => {
    const heic = file("IMG_0001.heic");
    render(<PhotoTile size="grid" kind="image" file={heic} src="/thumb/staged.webp" alt="a photo" />);
    const asked: string[] = [];
    for (let i = 0; i < 4; i++) {
      const img = container!.querySelector("img");
      if (!img) break;
      asked.push(img.getAttribute("src")!);
      act(() => img.dispatchEvent(new Event("error")));
    }
    expect(asked).toEqual([created[0], "/thumb/staged.webp"]);
    expect(container!.querySelector("img, video")).toBeNull();
    expect(container!.querySelector(".animate-pulse")).toBeNull();
    expect(container!.textContent).not.toContain("Video");
  });

  test("a tile waiting for a preview shows its kind icon, not an empty box", () => {
    // B1941: the owner read six blank rectangles as broken. They were
    // previews mid-generation.
    render(<PhotoTile size="grid" kind="image" file={file("IMG_0001.heic")} alt="a photo" />);
    act(() => container!.querySelector("img")!.dispatchEvent(new Event("error")));
    const pending = container!.querySelector(".animate-pulse")!;
    expect(pending).not.toBeNull();
    expect(pending.querySelector("svg")).not.toBeNull();
  });

  test("a clip waiting for its preview shows the video icon", () => {
    render(<PhotoTile size="grid" kind="video" file={file("clip.mov")} alt="a clip" />);
    act(() => container!.querySelector("video")!.dispatchEvent(new Event("error")));
    expect(container!.querySelector(".animate-pulse svg")).not.toBeNull();
  });

  test("a staged preview still loading pulses behind it", () => {
    render(<PhotoTile size="grid" kind="image" src="/thumb/staged.webp" alt="a photo" />);
    expect(container!.querySelector(".animate-pulse")).not.toBeNull();
    act(() => container!.querySelector("img")!.dispatchEvent(new Event("load")));
    expect(container!.querySelector(".animate-pulse")).toBeNull();
  });

  test("a failed upload stops the tile waiting and says there is no preview", () => {
    const heic = file("IMG_0001.heic");
    render(
      <PhotoTile size="grid" kind="image" file={heic} alt="a photo" badge={{ tone: "failed" }} />,
    );
    act(() => container!.querySelector("img")!.dispatchEvent(new Event("error")));
    // Not the pulse: nothing is coming, and a tile that goes on looking busy
    // behind a "these did not make it" panel is the bug B1922 fixed.
    expect(container!.querySelector(".animate-pulse")).toBeNull();
    expect(container!.textContent).toContain("No preview");
  });

  test("a tile still uploading keeps pulsing rather than claiming a dead end", () => {
    const heic = file("IMG_0001.heic");
    render(
      <PhotoTile size="grid" kind="image" file={heic} alt="a photo" badge={{ tone: "queued" }} />,
    );
    act(() => container!.querySelector("img")!.dispatchEvent(new Event("error")));
    expect(container!.querySelector(".animate-pulse")).not.toBeNull();
    expect(container!.textContent).not.toContain("No preview");
  });

  test("a clip falls through from its own video element to the staged animation", () => {
    const clip = file("clip.mov");
    render(<PhotoTile size="grid" kind="video" file={clip} src="/thumb/clip.webp" alt="a clip" />);
    expect(container!.querySelector("video")!.getAttribute("src")).toBe(created[0]);
    act(() => container!.querySelector("video")!.dispatchEvent(new Event("error")));
    expect(container!.querySelector("video")).toBeNull();
    expect(container!.querySelector("img")!.getAttribute("src")).toBe("/thumb/clip.webp");
  });
});
