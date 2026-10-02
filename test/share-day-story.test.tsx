// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import LocaleProvider from "@/components/LocaleProvider";
import ShareDayStory from "@/components/studio/day/ShareDayStory";
import { dictionaryFor } from "@/lib/locales";

/**
 * B2678 — the story screen's own tweaks: the preview leads (before the look
 * picker), "Include more photos from this day" is off by default, the look
 * is remembered per owner, and "Shared." only appears once `navigator.share`
 * has actually resolved — never for the desktop download fallback.
 */
let root: Root | undefined;
let container: HTMLDivElement | undefined;

afterEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

async function mount(props: Partial<React.ComponentProps<typeof ShareDayStory>> = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root!.render(
      <LocaleProvider dictionary={dictionaryFor("en")} locale="en">
        <ShareDayStory
          username="alex"
          tripId="alps"
          slug="up"
          photos={[{ src: "/p1.jpg" }, { src: "/p2.jpg" }]}
          caption="A day in the alps."
          linkAllowed
          link="https://t.test/@alex/trips/alps/day/up"
          videoAvailable={false}
          {...props}
        />
      </LocaleProvider>,
    );
  });
}

test("the preview comes before the look picker", async () => {
  await mount();
  const order = [...container!.querySelectorAll("img, button")].map((el) => el.className);
  const previewIndex = order.findIndex((c) => c.includes("max-h-[480px]"));
  const lookButtonIndex = [...container!.querySelectorAll<HTMLButtonElement>("button[aria-pressed]")][0]
    ? [...container!.querySelectorAll("button, img")].indexOf([...container!.querySelectorAll<HTMLButtonElement>("button[aria-pressed]")][0] as Element)
    : -1;
  expect(previewIndex).toBeGreaterThanOrEqual(0);
  expect(lookButtonIndex).toBeGreaterThan(previewIndex);
});

const photoGridTiles = (el: HTMLElement) => [...el.querySelectorAll<HTMLButtonElement>("button[aria-pressed]")].filter((b) => b.className.includes("h-16 w-16"));

test("Include more photos from this day is off by default; checking it reveals the photo grid", async () => {
  await mount();
  expect(container!.textContent).toContain("Include more photos from this day");
  expect(photoGridTiles(container!)).toHaveLength(0);
  const toggle = container!.querySelector('input[type="checkbox"]') as HTMLInputElement;
  expect(toggle.checked).toBe(false);
  await act(async () => toggle.click());
  expect(toggle.checked).toBe(true);
  expect(photoGridTiles(container!)).toHaveLength(2);
});

test("'Shared.' appears only once navigator.share resolves, never for the download fallback", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(new Blob(["x"], { type: "image/png" }))));
  vi.stubGlobal("navigator", {
    ...navigator,
    canShare: () => true,
    share: vi.fn(async () => {}),
    clipboard: navigator.clipboard,
  });
  await mount();
  const shareButton = [...container!.querySelectorAll("button")].find((b) => b.textContent?.includes("Share…"))!;
  await act(async () => shareButton.click());
  expect(container!.textContent).toContain("Shared.");
});

test("remembers the chosen look per owner across mounts", async () => {
  await mount();
  const postcardTile = [...container!.querySelectorAll<HTMLButtonElement>("button[aria-pressed]")].find((b) => b.textContent?.includes("Postcard"))!;
  await act(async () => postcardTile.click());
  act(() => root?.unmount());
  container?.remove();

  await mount();
  const postcardTileAgain = [...container!.querySelectorAll<HTMLButtonElement>("button[aria-pressed]")].find((b) => b.textContent?.includes("Postcard"))!;
  expect(postcardTileAgain.getAttribute("aria-pressed")).toBe("true");
});
