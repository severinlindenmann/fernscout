"use client";

import { useCallback, useState } from "react";
import Image from "next/image";
import { mediaLoader } from "./mediaLoader";
import { AnimatePresence, motion } from "motion/react";
import { useI18n } from "./LocaleProvider";
import { useLightbox } from "./useLightbox";
import type { GalleryItem } from "@/lib/types";

// Alternating tilt gives the polaroid grid a scattered, hand-placed feel
// instead of a perfectly uniform AI-card grid.
const TILTS = [-2.5, 1.5, -1, 2, -1.5, 1];

export default function Gallery({ items }: { items: GalleryItem[] }) {
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

  const dialog = useLightbox({ open: openIndex !== null, onClose: close, onPrev: prev, onNext: next });

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
                  // Empty on purpose. When there is a caption it is drawn
                  // below and is already the button's accessible name, so
                  // repeating it here made a screen reader announce every
                  // photograph's description twice; the button's aria-label
                  // covers the case where there is no caption.
                  alt=""
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
            </span>
            {item.caption && (
              <span className="mt-1.5 block truncate px-0.5 text-left font-display text-xs italic text-navy-700">
                {item.caption}
              </span>
            )}
          </motion.button>
        ))}
      </div>

      <AnimatePresence>
        {openIndex !== null && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            {...dialog}
            aria-label={t("a11y.photoViewer")}
            className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-navy-900/95 p-4 outline-none backdrop-blur-sm"
            onClick={close}
          >
            <button
              aria-label={t("a11y.closePhoto")}
              className="absolute right-4 top-4 text-3xl text-white/80 hover:text-white"
              onClick={close}
            >
              ×
            </button>
            <button
              aria-label={t("a11y.prevPhoto")}
              className="absolute left-2 top-1/2 -translate-y-1/2 px-3 py-6 text-3xl text-white/70 hover:text-white sm:left-4"
              onClick={(e) => {
                e.stopPropagation();
                prev();
              }}
            >
              ‹
            </button>
            <button
              aria-label={t("a11y.nextPhoto")}
              className="absolute right-2 top-1/2 -translate-y-1/2 px-3 py-6 text-3xl text-white/70 hover:text-white sm:right-4"
              onClick={(e) => {
                e.stopPropagation();
                next();
              }}
            >
              ›
            </button>

            <motion.div
              key={openIndex}
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.2 }}
              className="relative max-h-[80vh] w-full max-w-4xl"
              onClick={(e) => e.stopPropagation()}
            >
              {items[openIndex].type === "video" ? (
                <video
                  src={items[openIndex].src}
                  className="max-h-[80vh] w-full rounded-lg"
                  controls
                  autoPlay
                />
              ) : (
                // Full-bleed lightbox image at unknown intrinsic ratio — plain img keeps this simple.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={items[openIndex].src}
                  // The caption is printed below the picture.
                  alt=""
                  className="max-h-[80vh] w-full rounded-lg object-contain"
                />
              )}
              {items[openIndex].caption && (
                <p className="mt-3 text-center font-display text-base italic text-white/90">
                  {items[openIndex].caption}
                </p>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
