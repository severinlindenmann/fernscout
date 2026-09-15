// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";
import PhotoTile from "@/components/extract/PhotoTile";

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

  test("icloud prints the translated word itself", () => {
    render(<PhotoTile size="grid" kind="image" src="/thumb.jpg" alt="a photo" badge={{ tone: "icloud" }} />);
    const badge = container!.querySelector("span")!;
    expect(badge.textContent).toBe("iCloud");
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
  test("a video never renders an <img>, even when a src is given", () => {
    render(<PhotoTile size="grid" kind="video" src="/thumb.mov" alt="a clip" />);
    expect(container!.querySelector("img")).toBeNull();
    expect(container!.textContent).toContain("Video");
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
});
