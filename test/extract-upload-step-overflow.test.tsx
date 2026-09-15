// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import UploadStep from "@/components/extract/UploadStep";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";

/**
 * B1799 found that the staged-file *list* pushed a phone viewport wider
 * than 390px because a filename `<span className="truncate">` sat on a flex
 * child with no `min-w-0` — a flex child's default `min-width` is `auto`, so
 * it refused to shrink below the intrinsic width of a long UUID filename.
 *
 * B1803 Task 1.3 replaced that list with the design's photograph grid — "the
 * design's grid is the screen; the list goes" — so the specific span this
 * test used to check no longer exists in the visible tree at all: a grid
 * tile is a fixed-size square with a badge, never a filename rendered as
 * flowing text, so the overflow mechanism B1799 fixed cannot recur here.
 * This is now a regression guard for *that*: a long filename must still
 * produce exactly one fixed-size tile per file, with the filename reachable
 * only as an accessible name (`alt`/`aria-label`), never as visible text
 * that could overflow again.
 */

let root: Root | undefined;
let container: HTMLDivElement | undefined;

beforeEach(() => {
  vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn(() => "blob:mock"), revokeObjectURL: vi.fn() });
});

afterEach(() => {
  vi.unstubAllGlobals();
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

function longFile(name: string): File {
  return new File(["x"], name, { type: "image/jpeg" });
}

describe("the staged file grid never re-grows a truncate-less filename row", () => {
  test("a long filename becomes one fixed-size tile, not a flowing text row", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    act(() => {
      root!.render(
        <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
          <UploadStep username="agent" runId="run-1" onDone={() => {}} />
        </LocaleProvider>,
      );
    });

    const input = container.querySelector<HTMLInputElement>("#extract-upload-input")!;
    const files = [longFile("43b6b3ee-0e4f-4428-b518-428c79ad7c03.jpg")];
    Object.defineProperty(input, "files", { value: files, configurable: true });
    act(() => {
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });

    // The filename never appears as flowing visible text — only as an
    // accessible name on the tile button.
    expect(container.querySelector("span.truncate")).toBeNull();
    const tile = container.querySelector('button[aria-label="43b6b3ee-0e4f-4428-b518-428c79ad7c03.jpg"]');
    expect(tile).not.toBeNull();
  });
});
