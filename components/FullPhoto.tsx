"use client";

import { MEDIA_WIDTHS } from "@/lib/mediaSizes";
import type { GalleryItem } from "@/lib/types";

/**
 * The picture inside an open viewer, at whatever size the browser wants.
 *
 * **B08, and the shape of the answer changed while it was open.** The task was
 * written as W30's fifth item: write a `.webp` beside every `.jpg` at ingest
 * time and offer both. Two things have happened since. `resizedCopy`
 * (`lib/media.ts`) re-encodes to WebP on demand and caches the result under
 * `content/.cache/media`, and the media route serves that for any `?w=`; and
 * the grid thumbnails already go through it, via `components/mediaLoader.ts`.
 *
 * So the derivative exists and nothing needed writing. What was left was
 * exactly one path: the open photograph. `<img src={item.src}>` carries no
 * `?w=`, and a request with no width is served the stored file as it is — the
 * full-resolution original from somebody's camera, several megabytes of it, to
 * a phone that is going to draw it 390 pixels wide.
 *
 * `<picture>` is what makes both true at once. The `<source>` offers the sized
 * WebP at every width the route will serve; the `<img>` underneath keeps the
 * original as its `src`, so a browser that cannot decode WebP ignores the
 * source element entirely and gets exactly the bytes it got before. That is
 * the fallback the task asks for, and it costs no new files on disk: a
 * derivative is written only for a width somebody actually requested.
 *
 * Two sources are skipped, the same two `mediaLoader` skips: an absolute URL
 * is somebody else's server and cannot answer `?w=`, and the SVG placeholders
 * the demo content ships would be rasterised for nothing.
 */
export default function FullPhoto({ item }: { item: GalleryItem }) {
  if (item.type === "video") {
    return (
      <video src={item.src} className="max-h-[78vh] w-full rounded-lg" controls autoPlay />
    );
  }

  const className = "max-h-[78vh] w-full rounded-lg object-contain";

  // The caption, the place and the date are printed under the picture by the
  // caller, so an alt here would only say the same words twice.
  const alt = "";

  // **`draggable={false}` is load-bearing.** A picture in a browser is a drag
  // source by default: a mouse-down on one starts the browser's own
  // drag-and-drop, which swallows every pointer event after it, so the swipe
  // in `components/Lightbox.tsx` never began. It cost an hour of driving a
  // real browser to see, because it is invisible on a phone — there is no
  // native drag from a finger — and it is the whole gesture on a laptop.

  if (!resizable(item.src)) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={item.src} alt={alt} className={className} draggable={false} />;
  }

  return (
    <picture>
      <source
        type="image/webp"
        srcSet={MEDIA_WIDTHS.map((w) => `${item.src}?w=${w} ${w}w`).join(", ")}
        // The frame is `w-full max-w-4xl` inside a viewer padded by 4 — 896px
        // at the widest, the viewport below that. The browser multiplies by
        // its own pixel ratio before it picks.
        sizes="(max-width: 896px) 100vw, 896px"
      />
      {/* The original, for a browser with no WebP — and the element every
          other attribute hangs off, since a `<source>` renders nothing. No
          eslint exception needed for this one: `no-img-element` is about
          reaching for `<img>` instead of `next/image`, and an `<img>` inside a
          `<picture>` is the only thing that element can contain. */}
      <img src={item.src} alt={alt} className={className} draggable={false} />
    </picture>
  );
}

/** Whether this source is one our own media route can resize. */
function resizable(src: string): boolean {
  return !/^https?:/.test(src) && !src.endsWith(".svg");
}
