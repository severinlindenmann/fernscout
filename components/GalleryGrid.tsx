"use client";

import { useCallback, useMemo, useState } from "react";
import Image from "next/image";
import { mediaLoader } from "./mediaLoader";
import { AnimatePresence, motion } from "motion/react";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
import type { Entry, GalleryItem } from "@/lib/types";
import { flagFor } from "@/lib/flags";
import { useI18n } from "./LocaleProvider";
import { useLightbox } from "./useLightbox";

export type MediaEntry = { item: GalleryItem; entry: Entry };

export default function GalleryGrid({ media }: { media: MediaEntry[] }) {
  const { t, formatShortDate } = useI18n();
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [place, setPlace] = useState<string>("all");

  const places = useMemo(
    () => Array.from(new Set(media.map((m) => m.entry.location))),
    [media],
  );

  const shown = useMemo(
    () => (place === "all" ? media : media.filter((m) => m.entry.location === place)),
    [media, place],
  );

  const close = useCallback(() => setOpenIndex(null), []);
  const prev = useCallback(
    () => setOpenIndex((i) => (i === null ? null : (i - 1 + shown.length) % shown.length)),
    [shown.length],
  );
  const next = useCallback(
    () => setOpenIndex((i) => (i === null ? null : (i + 1) % shown.length)),
    [shown.length],
  );

  const dialog = useLightbox({ open: openIndex !== null, onClose: close, onPrev: prev, onNext: next });

  const open = openIndex === null ? null : shown[openIndex];

  return (
    <div>
      <div className="scrollbar-thin -mx-1 mb-5 flex gap-2 overflow-x-auto px-1 pb-1">
        <FilterChip active={place === "all"} onClick={() => setPlace("all")}>
          {t("gallery.all")} ({media.length})
        </FilterChip>
        {places.map((p) => (
          <FilterChip key={p} active={place === p} onClick={() => setPlace(p)}>
            {p}
          </FilterChip>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {shown.map(({ item, entry }, i) => (
          <motion.button
            key={`${item.src}-${i}`}
            onClick={() => setOpenIndex(i)}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: Math.min(i * 0.03, 0.4) }}
            whileHover={{ y: -3 }}
            className="group relative overflow-hidden rounded-xl border border-navy-200 bg-cream-200 shadow-sm"
          >
            <span className="relative block aspect-square">
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
                  // The tile prints the location and the date over the
                  // picture, so an alt here only made the button's accessible
                  // name say the same words twice.
                  alt=""
                  fill
                  sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
                  className="object-cover transition-transform duration-300 group-hover:scale-105"
                />
              )}
              {item.type === "video" && (
                <span className="absolute inset-0 flex items-center justify-center bg-black/20 text-2xl text-white">
                  ▶
                </span>
              )}
            </span>
            <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-navy-900/80 to-transparent px-2.5 py-2 text-left">
              <span className="block truncate text-xs font-semibold text-white">
                {entry.location}
              </span>
              <span className="block text-[11px] text-white/90">
                {formatShortDate(entry.date)}
              </span>
            </span>
          </motion.button>
        ))}
      </div>

      {shown.length === 0 && (
        <p className="py-10 text-center text-sm text-navy-600">{t("gallery.none")}</p>
      )}

      <AnimatePresence>
        {open && (
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
              className="absolute right-4 top-4 rounded-full p-2 text-white/80 hover:bg-white/10 hover:text-white"
              onClick={close}
            >
              <X className="h-6 w-6" />
            </button>
            <button
              aria-label={t("a11y.prevPhoto")}
              className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full p-2 text-white/70 hover:bg-white/10 hover:text-white sm:left-5"
              onClick={(e) => {
                e.stopPropagation();
                prev();
              }}
            >
              <ChevronLeft className="h-7 w-7" />
            </button>
            <button
              aria-label={t("a11y.nextPhoto")}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-2 text-white/70 hover:bg-white/10 hover:text-white sm:right-5"
              onClick={(e) => {
                e.stopPropagation();
                next();
              }}
            >
              <ChevronRight className="h-7 w-7" />
            </button>

            <motion.div
              key={openIndex}
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.2 }}
              className="relative max-h-[82vh] w-full max-w-4xl"
              onClick={(e) => e.stopPropagation()}
            >
              {open.item.type === "video" ? (
                <video
                  src={open.item.src}
                  className="max-h-[78vh] w-full rounded-lg"
                  controls
                  autoPlay
                />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={open.item.src}
                  // The caption and the place are both printed underneath.
                  alt=""
                  className="max-h-[78vh] w-full rounded-lg object-contain"
                />
              )}
              <div className="mt-3 text-center">
                {open.item.caption && (
                  <p className="font-display text-sm italic text-white/85">{open.item.caption}</p>
                )}
                <p className="mt-0.5 text-xs text-white/80">
                  {flagFor(open.entry.country, open.entry.countryCode)} {open.entry.location},{" "}
                  {open.entry.country} · {formatShortDate(open.entry.date)}
                </p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-full border px-3.5 text-sm font-semibold transition-colors ${
        active
          ? "border-yellow-600 bg-yellow-400 text-yellow-950"
          : "border-navy-200 bg-white text-navy-600 hover:border-navy-500"
      }`}
    >
      {children}
    </button>
  );
}
