"use client";

import { useCallback, useMemo, useState } from "react";
import Image from "next/image";
import { mediaLoader } from "./mediaLoader";
import { motion } from "motion/react";
import type { MediaTile } from "@/lib/types";
import { flagFor } from "@/lib/flags";
import { useI18n } from "./LocaleProvider";
import FullPhoto from "./FullPhoto";
import Lightbox from "./Lightbox";

/**
 * How many tiles render at once, before "load more" is needed.
 *
 * Against a real trip (hundreds, not the example journal's five) rather than
 * the page's own default: big enough that most trips never see the button,
 * small enough that a several-hundred-photo gallery does not mount every
 * `motion.button` and every `<video>` on first paint (B87).
 */
const BATCH = 60;

export default function GalleryGrid({ media }: { media: MediaTile[] }) {
  const { t, formatShortDate } = useI18n();
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const [place, setPlace] = useState<string>("all");
  const [visibleCount, setVisibleCount] = useState(BATCH);

  // `location:` is optional on an entry, so a day without one arrives here as
  // `""` — which rendered as a blank, clickable, unlabelled chip (B337). The
  // photos stay in `Alle`; only the chip that could not name itself goes.
  const places = useMemo(
    () => Array.from(new Set(media.map((m) => m.location).filter(Boolean))),
    [media],
  );

  // The filter runs over the whole trip's media, not over what has rendered —
  // `shown` is the full filtered set, and the DOM window below is a slice of
  // it, not a separate query.
  const shown = useMemo(
    () => (place === "all" ? media : media.filter((m) => m.location === place)),
    [media, place],
  );

  // A new filter starts its own window; the old one's count means nothing
  // against a different array. Adjusted during render rather than in an
  // effect — the React-recommended way to reset state when something else
  // changes, without the extra paint an effect would cost.
  const [lastPlace, setLastPlace] = useState(place);
  if (place !== lastPlace) {
    setLastPlace(place);
    setVisibleCount(BATCH);
  }

  const close = useCallback(() => setOpenIndex(null), []);
  const prev = useCallback(
    () => setOpenIndex((i) => (i === null ? null : (i - 1 + shown.length) % shown.length)),
    [shown.length],
  );
  const next = useCallback(
    () => setOpenIndex((i) => (i === null ? null : (i + 1) % shown.length)),
    [shown.length],
  );

  // The lightbox's index is always into the full filtered set (`shown`), so
  // paging forward from the last *rendered* tile reaches photos the grid has
  // not mounted yet — opening one just pulls it into the window, so the grid
  // catches up rather than leaving a hole once the viewer closes.
  const [lastOpenIndex, setLastOpenIndex] = useState(openIndex);
  if (openIndex !== lastOpenIndex) {
    setLastOpenIndex(openIndex);
    if (openIndex !== null && openIndex + 1 > visibleCount) setVisibleCount(openIndex + 1);
  }

  const open = openIndex === null ? null : shown[openIndex];
  const visible = shown.slice(0, visibleCount);

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
        {visible.map((tile, i) => (
          <motion.button
            key={`${tile.src}-${i}`}
            onClick={() => setOpenIndex(i)}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: Math.min(i * 0.03, 0.4) }}
            whileHover={{ y: -3 }}
            className="group relative overflow-hidden rounded-xl border border-navy-200 bg-cream-200 shadow-sm"
          >
            <span className="relative block aspect-square">
              {tile.type === "video" ? (
                // A still if there is one, and there almost always is —
                // ingest writes a poster frame for every clip. The grid used
                // to load the clip itself to show a thumbnail of it, which on
                // a page of a dozen is a dozen videos fetched to draw twelve
                // small rectangles.
                <video
                  src={tile.src}
                  poster={tile.poster}
                  preload={tile.poster ? "none" : "metadata"}
                  className="h-full w-full object-cover"
                  muted
                />
              ) : (
                <Image
                  src={tile.src}
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
              {tile.type === "video" && (
                <span className="absolute inset-0 flex items-center justify-center bg-black/20 text-2xl text-white">
                  ▶
                </span>
              )}
            </span>
            <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-navy-900/80 to-transparent px-2.5 py-2 text-left">
              <span className="block truncate text-xs font-semibold text-white">
                {tile.location}
              </span>
              <span className="block text-[11px] text-white/90">
                {formatShortDate(tile.date)}
              </span>
            </span>
          </motion.button>
        ))}
      </div>

      {shown.length === 0 && (
        <p className="py-10 text-center text-sm text-navy-600">{t("gallery.none")}</p>
      )}

      {visibleCount < shown.length && (
        <div className="mt-6 flex justify-center">
          <button
            onClick={() => setVisibleCount((v) => v + BATCH)}
            className="min-h-11 rounded-full border border-navy-200 bg-white px-5 text-sm font-semibold text-navy-700 shadow-sm transition-colors hover:border-navy-500"
          >
            {t("gallery.loadMore")}
          </button>
        </div>
      )}

      <Lightbox
        index={openIndex}
        count={shown.length}
        onClose={close}
        onPrev={prev}
        onNext={next}
        // A clip owns the pointer: dragging across it is dragging its scrubber.
        swipeable={open?.type !== "video"}
      >
        {open && (
          <>
            <FullPhoto item={open} />
            <div className="mt-3 text-center">
              {open.caption && (
                <p className="font-display text-sm italic text-white/85">{open.caption}</p>
              )}
              <p className="mt-0.5 text-xs text-white/80">
                {flagFor(open.country, open.countryCode)} {open.location}, {open.country} ·{" "}
                {formatShortDate(open.date)}
              </p>
            </div>
          </>
        )}
      </Lightbox>

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
