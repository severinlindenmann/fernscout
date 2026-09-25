// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, test, vi } from "vitest";
import Gallery from "@/components/Gallery";
import LocaleProvider from "@/components/LocaleProvider";
import { dictionaryFor } from "@/lib/locales";
import type { GalleryItem } from "@/lib/types";

/**
 * B862 — removing a photograph used to be one step behind where an owner
 * notices they want to: the picture is on screen, full size, in the
 * lightbox — and the only way to act on that was closing the viewer,
 * scrolling to "Correct this day", and finding the same photograph again
 * among its thumbnails. `Gallery`'s `onRemove` puts a control beside the
 * photograph itself, reachable only when the caller passes one — which
 * `StoryPager` does only for the owner (`trip.canPublish`).
 *
 * Same jsdom + `createRoot` harness as `test/tel-field-combobox.test.tsx`,
 * for the same reason: one interactive component, not a new dependency.
 */

vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => {
    // eslint-disable-next-line @next/next/no-img-element
    return <img alt={(props.alt as string) ?? ""} src={props.src as string} />;
  },
}));

let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

const items: GalleryItem[] = [
  { src: "/alex/media/alps-2024/day-one/01.jpg", type: "image" },
  { src: "/alex/media/alps-2024/day-one/02.jpg", type: "image" },
];

function render(onRemove?: (src: string) => void) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
        <Gallery items={items} onRemove={onRemove} />
      </LocaleProvider>,
    );
  });
}

function openFirst() {
  const tile = container!.querySelectorAll("button")[0] as HTMLButtonElement;
  act(() => tile.click());
}

describe("removing a photograph from the lightbox itself", () => {
  test("a reader who is not the owner sees no remove control", () => {
    render(undefined);
    openFirst();
    expect(container!.querySelector('[aria-label="Remove this photo"]')).toBeNull();
  });

  test("the owner sees it, and it reports which photograph was on screen", () => {
    let removed: string | undefined;
    render((src) => {
      removed = src;
    });
    openFirst();
    // The lightbox is open — the photograph itself is on screen.
    expect(container!.querySelector('[aria-label="Photo viewer"]')).not.toBeNull();

    const button = container!.querySelector(
      '[aria-label="Remove this photo"]',
    ) as HTMLButtonElement;
    expect(button).not.toBeNull();

    act(() => button.click());
    expect(removed).toBe(items[0].src);
  });
});
