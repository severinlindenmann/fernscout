"use client";

import { useCallback, useState } from "react";
import Image from "next/image";
import { Trash2 } from "lucide-react";
import { mediaLoader, posterSrc } from "./mediaLoader";
import { POSTER_WIDTH } from "@/lib/mediaSizes";
import { useI18n } from "./LocaleProvider";
import FullPhoto from "./FullPhoto";
import { PhotoFrame } from "./PhotoFrame";
import Lightbox from "./Lightbox";
import { PhotoBadge } from "./Visibility";
import type { GalleryItem } from "@/lib/types";

/**
 * A day's photographs as the story draws them — B2570.
 *
 * They were a scattered polaroid grid under the prose, every photograph its
 * own tilted card. The owner found the day cluttered with that and a street
 * map on top, and chose a cover instead: the photographs across the top of
 * the card, edge to edge, at most three of them — one wide; two side by side;
 * three or more as one big over two small, the third saying how many more
 * there are. The rest are one tap away, in the same viewer as before.
 *
 * Captions moved into the viewer with them. On the card they were two lines
 * of italic under a tile a third of a phone wide; in the viewer they are
 * under the photograph they describe, at a size somebody can read.
 *
 * `inset` is the same layout inside a card rather than across its top —
 * the photographs of a day's second or third update, drawn inside that
 * update's own row (see `DayCard`), rounded because they no longer meet the
 * card's edge.
 */
export default function Gallery({
  items,
  onRemove,
  inset = false,
}: {
  items: GalleryItem[];
  /**
   * Owner only — B862. The photograph a person is looking at, full screen, is
   * where they notice they do not want it; without this the only way there
   * was closing the viewer, finding "Correct this day" below the fold, and
   * finding the same photograph again among its thumbnails. Passing this
   * closes that gap: it marks the open photograph to go and opens the
   * correction panel already showing it that way — one press, not several,
   * and still nothing leaves disk until the panel's own Save (`EditDay`).
   * Absent for a reader who is not the owner.
   */
  onRemove?: (src: string) => void;
  inset?: boolean;
}) {
  const { t } = useI18n();
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const close = useCallback(() => setOpenIndex(null), []);
  const prev = useCallback(
    () => setOpenIndex((i) => (i === null ? null : (i - 1 + items.length) % items.length)),
    [items.length],
  );
  const next = useCallback(
    () => setOpenIndex((i) => (i === null ? null : (i + 1) % items.length)),
    [items.length],
  );

  const open = openIndex === null ? null : items[openIndex];

  if (items.length === 0) return null;

  const shown = items.slice(0, 3);
  const more = items.length - shown.length;
  // Phone: the first tile spans both columns when there are three. From
  // `sm` up the three become one tall tile on the left and two stacked on
  // the right, inside a box of fixed height.
  const layout =
    shown.length === 1
      ? "grid-cols-1"
      : shown.length === 2
        ? "grid-cols-2 sm:h-72"
        : "grid-cols-2 sm:h-80 sm:grid-cols-3 sm:grid-rows-2";
  const tileShape = (i: number) =>
    shown.length === 1
      ? "aspect-[16/9] sm:aspect-[2/1]"
      : shown.length === 2
        ? "aspect-[4/3] sm:aspect-auto sm:h-full"
        : i === 0
          ? "col-span-2 aspect-[16/9] sm:row-span-2 sm:aspect-auto sm:h-full"
          : "aspect-[4/3] sm:aspect-auto sm:h-full";

  return (
    <div>
      <div
        className={`grid ${layout} ${inset ? "gap-1.5 overflow-hidden rounded-xl" : "gap-[3px]"}`}
      >
        {shown.map((item, i) => (
          <button
            key={item.src}
            type="button"
            onClick={() => setOpenIndex(i)}
            aria-label={item.caption ?? t("a11y.openPhoto")}
            className={`group relative block overflow-hidden bg-surface-muted ${tileShape(i)}`}
          >
            <PhotoFrame className="absolute inset-0 block">
              {(img) => (
                <>
                  {item.type === "video" ? (
                    // A still if there is one, and there almost always is —
                    // ingest writes a poster frame for every clip. The grid used
                    // to load the clip itself to show a thumbnail of it, which on
                    // a page of a dozen is a dozen videos fetched to draw twelve
                    // small rectangles.
                    <video
                      src={item.src}
                      poster={posterSrc(item.poster, POSTER_WIDTH.GRID)}
                      preload={item.poster ? "none" : "metadata"}
                      className="h-full w-full object-cover"
                      muted
                    />
                  ) : (
                    <Image
                      {...img}
                      src={item.src}
                      loader={mediaLoader}
                      // What the photograph shows if anything has described it
                      // (B1867), else the caption, else empty — the button's
                      // aria-label covers that last case.
                      alt={item.alt ?? item.caption ?? ""}
                      fill
                      sizes={i === 0 ? "(max-width: 640px) 100vw, 66vw" : "(max-width: 640px) 50vw, 33vw"}
                      className="object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                    />
                  )}
                  {item.type === "video" && (
                    <span className="absolute inset-0 flex items-center justify-center bg-black/20 text-2xl text-overlay-ink">
                      ▶
                    </span>
                  )}
                  <PhotoBadge own={item.visibility} />
                </>
              )}
            </PhotoFrame>
            {i === shown.length - 1 && more > 0 && (
              <span className="absolute inset-0 flex items-center justify-center bg-overlay-strong/45 font-display text-2xl font-semibold text-overlay-ink">
                +{more}
              </span>
            )}
          </button>
        ))}
      </div>

      <Lightbox
        index={openIndex}
        count={items.length}
        onClose={close}
        onPrev={prev}
        onNext={next}
        // A clip owns the pointer: dragging across it is dragging its scrubber.
        swipeable={open?.type !== "video"}
        extra={
          open &&
          onRemove && (
            <button
              type="button"
              aria-label={t("a11y.removePhoto")}
              className="absolute left-4 top-4 z-10 rounded-full bg-overlay-strong/40 p-2 text-overlay-ink/80 hover:bg-overlay-ink/10 hover:text-overlay-ink"
              onClick={(e) => {
                e.stopPropagation();
                onRemove(open.src);
                close();
              }}
            >
              <Trash2 className="h-5 w-5" />
            </button>
          )
        }
      >
        {open && (
          <>
            <FullPhoto item={open} />
            {open.caption && (
              <p className="mt-3 text-center font-display text-base italic text-overlay-ink/90">
                {open.caption}
              </p>
            )}
          </>
        )}
      </Lightbox>

    </div>
  );
}
