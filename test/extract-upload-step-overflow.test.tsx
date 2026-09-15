// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import UploadStep from "@/components/extract/UploadStep";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";

/**
 * B1799 — the upload list pushed a phone viewport wider than 390px because
 * `truncate` sat on a flex child with no `min-w-0`: a flex child's default
 * `min-width` is `auto`, so the span refused to shrink below the intrinsic
 * width of its content (a long UUID filename) and the row, then the `<ul>`,
 * then the page grew to fit it.
 *
 * A layout regression like this cannot be caught by a jsdom width — jsdom
 * does not lay anything out — so this only proves the class that makes the
 * span shrinkable is present, which is what `truncate` needs beside it to do
 * anything at all. The real check is a browser at 390px with files staged
 * (`test-in-a-browser`, done for this ticket outside the suite); this is the
 * cheap regression guard so the class cannot quietly come back off.
 */

let root: Root | undefined;
let container: HTMLDivElement | undefined;

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

describe("the staged file row can shrink", () => {
  test("the filename span carries min-w-0 beside its truncate class", () => {
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

    const row = container.querySelector("li[data-state]")!;
    const name = row.querySelector("span.truncate")!;
    // The bug: `truncate` alone does nothing inside a flex row. `min-w-0` is
    // the standard counterpart that lets the span actually shrink.
    expect(name.className).toContain("min-w-0");
    expect(name.className).toContain("truncate");
    expect(name.textContent).toBe("43b6b3ee-0e4f-4428-b518-428c79ad7c03.jpg");

    // The status word beside it must not be squeezed off either.
    const status = row.children[1] as HTMLElement;
    expect(status.className).toContain("shrink-0");
  });
});
