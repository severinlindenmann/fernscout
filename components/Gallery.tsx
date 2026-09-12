"use client";

import { useCallback, useState } from "react";
import Image from "next/image";
import { Trash2 } from "lucide-react";
import { mediaLoader } from "./mediaLoader";
import { motion } from "motion/react";
import { useI18n } from "./LocaleProvider";
import FullPhoto from "./FullPhoto";
import Lightbox from "./Lightbox";
import { PhotoBadge } from "./Visibility";
import type { GalleryItem } from "@/lib/types";

// Alternating tilt gives the polaroid grid a scattered, hand-placed feel
// instead of a perfectly uniform AI-card grid.
const TILTS = [-2.5, 1.5, -1, 2, -1.5, 1];

export default function Gallery({
  items,
  onRemove,
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

  return (
    <div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-5 py-2 sm:grid-cols-3">
        {items.map((item, i) => (
          <motion.button
            key={item.src}
            onClick={() => setOpenIndex(i)}
            aria-label={item.caption ?? t("a11y.openPhoto")}
            initial={{ opacity: 0, y: 14, rotate: 0 }}
            animate={{ opacity: 1, y: 0, rotate: TILTS[i % TILTS.length] }}
            whileHover={{ rotate: 0, scale: 1.04, zIndex: 10 }}
            whileTap={{ scale: 0.97 }}
            transition={{ duration: 0.35, delay: i * 0.05, ease: "easeOut" }}
            className="group relative rounded-sm border border-navy-200 bg-white p-2 pb-6 shadow-lg shadow-navy-900/15"
          >
            <span className="relative block aspect-[4/3] overflow-hidden bg-cream-200">
              {item.type === "video" ? (
                // A still if there is one, and there almost always is —
                // ingest writes a poster frame for every clip. The grid used
                // to load the clip itself to show a thumbnail of it, which on
                // a page of a dozen is a dozen videos fetched to draw twelve
                // small rectangles.
                <video
                  src={item.src}
                  poster={item.poster}
                  preload={item.poster ? "none" : "metadata"}
                  className="h-full w-full object-cover"
                  muted
                />
              ) : (
                <Image
                  src={item.src}
                  loader={mediaLoader}
                  // The caption, and empty when there is none — the button's
                  // aria-label covers that case. The caption drawn below is
                  // `aria-hidden` so the two do not both reach a screen
                  // reader; the same rule as the trip gallery's tiles (B522).
                  alt={item.caption ?? ""}
                  fill
                  sizes="(max-width: 640px) 50vw, 33vw"
                  className="object-cover"
                />
              )}
              {item.type === "video" && (
                <span className="absolute inset-0 flex items-center justify-center bg-black/20 text-2xl text-white">
                  ▶
                </span>
              )}
              <PhotoBadge own={item.visibility} />
            </span>
            {item.caption && (
              <span
                aria-hidden
                // Two lines rather than one truncated: a tile is a third of
                // the column on a phone, so almost every caption longer than
                // four words was ending in an ellipsis that said nothing.
                className="mt-1.5 line-clamp-2 block px-0.5 text-left font-display text-xs italic leading-snug text-navy-700"
              >
                {item.caption}
              </span>
            )}
          </motion.button>
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
              className="absolute left-4 top-4 z-10 rounded-full bg-navy-900/40 p-2 text-white/80 hover:bg-white/10 hover:text-white"
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
              <p className="mt-3 text-center font-display text-base italic text-white/90">
                {open.caption}
              </p>
            )}
          </>
        )}
      </Lightbox>

    </div>
  );
}
