import { describe, expect, test } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import LocaleProvider from "@/components/LocaleProvider";
import Lightbox from "@/components/Lightbox";
import FullPhoto from "@/components/FullPhoto";
import { swipeIntent, SWIPE_DISTANCE, SWIPE_VELOCITY } from "@/components/swipe";
import { dictionaryFor } from "@/lib/locales";
import type { GalleryItem } from "@/lib/types";

/**
 * The photograph a reader opens, on the device most of them are holding.
 *
 * B16: the viewer answered the keyboard and nothing else. There was no swipe —
 * the only way forward was a chevron pinned to the screen edge, which is where
 * the browser's own back gesture lives — and nothing said which photograph of
 * how many was open, so the silent wrap from the last back to the first read
 * as the viewer losing its place.
 *
 * B08: and it fetched the camera original to do it.
 *
 * Rendered on the server, which is where the markup comes from and is also the
 * only state a test without a DOM can see. Motion writes the drag it will
 * accept into the element's style (`touch-action`), so the gesture is visible
 * here even though no finger can be put on it.
 */

const photo: GalleryItem = { src: "/alex/media/alps-2024/day-one/01.jpg", type: "image" };
const clip: GalleryItem = { src: "/alex/media/alps-2024/day-one/02.mp4", type: "video" };

function viewer(
  props: Partial<React.ComponentProps<typeof Lightbox>> = {},
  item: GalleryItem = photo,
) {
  return renderToStaticMarkup(
    <LocaleProvider locale="en" dictionary={dictionaryFor("en")}>
      <Lightbox
        index={2}
        count={9}
        onClose={() => {}}
        onPrev={() => {}}
        onNext={() => {}}
        {...props}
      >
        <FullPhoto item={item} />
      </Lightbox>
    </LocaleProvider>,
  );
}

describe("what a horizontal drag means", () => {
  test("a tap that slid a few pixels is not a swipe", () => {
    expect(swipeIntent(0, 0)).toBe(null);
    expect(swipeIntent(12, 30)).toBe(null);
    expect(swipeIntent(-40, 0)).toBe(null);
  });

  test("a long drag moves the picture, whichever way it went", () => {
    expect(swipeIntent(SWIPE_DISTANCE, 0)).toBe("prev");
    expect(swipeIntent(-SWIPE_DISTANCE, 0)).toBe("next");
    expect(swipeIntent(200, 10)).toBe("prev");
  });

  test("a flick counts even though it barely moved", () => {
    // What a thumb actually produces: 25px, gone in a tenth of a second.
    expect(swipeIntent(25, SWIPE_VELOCITY)).toBe("prev");
    expect(swipeIntent(-25, -SWIPE_VELOCITY)).toBe("next");
    // Fast, but from a standing start — that is a twitch, not a gesture.
    expect(swipeIntent(4, -900)).toBe(null);
  });

  test("a drag that ends in a flick the other way follows the flick", () => {
    // The most recent thing the reader did is what they meant.
    expect(swipeIntent(120, -900)).toBe("next");
  });
});

describe("the open photograph", () => {
  test("says which one of how many it is", () => {
    const html = viewer();
    expect(html).toContain(">3 / 9<");
    // And says it in words for a reader who cannot see it — the counter is
    // the only evidence a swipe did anything.
    expect(html).toContain("Photo 3 of 9");
    expect(html).toContain('aria-live="polite"');
  });

  test("takes a horizontal drag, and leaves vertical scrolling to the page", () => {
    expect(viewer()).toContain("touch-action:pan-y");
  });

  test("a video with controls is not draggable — that is its scrubber", () => {
    const html = viewer({ swipeable: false }, clip);
    expect(html).not.toContain("touch-action");
    expect(html).toContain("<video");
  });

  test("one photograph has no counter and nowhere to go", () => {
    const html = viewer({ index: 0, count: 1 });
    expect(html).not.toContain("1 / 1");
    expect(html).not.toContain("Next photo");
    expect(html).not.toContain("touch-action");
  });

  test("closed renders nothing at all", () => {
    expect(viewer({ index: null })).toBe("");
  });

  test("the keyboard and the focus trap are still wired to the dialog", () => {
    const html = viewer();
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('tabindex="-1"');
  });
});

/**
 * B08 — W30's fifth item. The sized path already re-encodes to WebP
 * (`lib/media.ts`), so what was missing was the negotiation on the one request
 * that carries no width: the open photograph, served the camera original.
 */
describe("what the open photograph offers a browser", () => {
  test("WebP first, the original as the fallback", () => {
    const html = viewer();
    expect(html).toContain('type="image/webp"');
    // Every width the media route will serve, so a phone takes a small one.
    expect(html).toContain("/alex/media/alps-2024/day-one/01.jpg?w=320 320w");
    expect(html).toContain("/alex/media/alps-2024/day-one/01.jpg?w=2000 2000w");
    expect(html).toContain('sizes="(max-width: 896px) 100vw, 896px"');
    // The img keeps the untouched source: a browser that cannot decode WebP
    // ignores the source element and gets exactly the bytes it got before.
    expect(html).toContain('<img src="/alex/media/alps-2024/day-one/01.jpg"');
  });

  test("a source our own route cannot resize is left alone", () => {
    // The demo content ships SVG placeholders, and an absolute URL is
    // somebody else's server. Neither can answer `?w=`.
    for (const src of ["/alex/media/x/01.svg", "https://example.test/photo.jpg"]) {
      const html = viewer({}, { src, type: "image" });
      expect(html).not.toContain("<picture>");
      expect(html).toContain(`<img src="${src}"`);
    }
  });

  test("a clip is a video, not a picture", () => {
    const html = viewer({}, clip);
    expect(html).not.toContain("<picture>");
    expect(html).toContain('<video src="/alex/media/alps-2024/day-one/02.mp4"');
  });
});
