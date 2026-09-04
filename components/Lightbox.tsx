"use client";

import type { ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { X, ChevronLeft, ChevronRight } from "lucide-react";
import { useI18n } from "./LocaleProvider";
import { useLightbox } from "./useLightbox";
import { swipeIntent } from "./swipe";

/**
 * One photograph, full screen — the viewer behind both galleries.
 *
 * There used to be two of these, near-identical, in `Gallery.tsx` (a day) and
 * `GalleryGrid.tsx` (a trip). They already drifted: different icons, different
 * heights, and whatever was fixed in one stayed broken in the other. B16 asked
 * for swipe and a position in "both, or the same reader gets two different
 * viewers on two pages", which is the point at which one component is cheaper
 * than the discipline of copying every change.
 *
 * What the caller keeps is what actually differs: the picture itself and
 * whatever is printed under it. The chrome — the backdrop, the three buttons,
 * the counter, the drag — lives here.
 *
 * **On a phone** (B16). The only way forward used to be a chevron pinned to
 * the screen edge, which is also where the browser's own back gesture lives,
 * and nothing said how many photographs there were or that the last one wraps
 * round to the first. Both halves are here: a horizontal drag on the picture,
 * and a counter that makes the wrap legible rather than baffling.
 *
 * Wrapping itself is kept. It is the right behaviour once a reader can see
 * where they are — "1 / 9" after "9 / 9" is a loop, where the same jump with
 * no counter reads as the viewer having lost its place.
 *
 * The keyboard, the focus trap and focus return are `useLightbox`'s, unchanged
 * and called from here — read the docblock at the top of that file before
 * touching any of it.
 */
export default function Lightbox({
  index,
  count,
  onClose,
  onPrev,
  onNext,
  swipeable = true,
  children,
}: {
  /** Which photograph is open, or `null` for closed. */
  index: number | null;
  /** How many there are to move between. */
  count: number;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  /**
   * False when the open item owns the pointer itself — a video with controls,
   * where a drag across the picture is a drag along the scrubber (B16).
   */
  swipeable?: boolean;
  /** The picture, and whatever is printed beneath it. */
  children: ReactNode;
}) {
  const { t } = useI18n();
  const dialog = useLightbox({ open: index !== null, onClose, onPrev, onNext });

  // One photograph is not a sequence: there is nowhere for an arrow to go and
  // "1 / 1" tells a reader something they can see.
  const many = count > 1;

  // The three buttons and the counter are stacked over the picture rather than
  // under it. Positioned siblings paint in document order, so the frame used
  // to cover both chevrons on a phone — where the photograph is the full width
  // of the screen, which is every phone — and the only control B16 says a
  // reader has was drawn behind the thing it moves. The dark disc behind each
  // is for the same reason: white on white/70 over a bright photograph is not
  // a control anybody can find.

  return (
    <AnimatePresence>
      {index !== null && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          {...dialog}
          aria-label={t("a11y.photoViewer")}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-navy-900/95 p-4 outline-none backdrop-blur-sm"
          onClick={onClose}
        >
          <button
            aria-label={t("a11y.closePhoto")}
            className="absolute right-4 top-4 z-10 rounded-full bg-navy-900/40 p-2 text-white/80 hover:bg-white/10 hover:text-white"
            onClick={onClose}
          >
            <X className="h-6 w-6" />
          </button>
          {many && (
            <>
              <button
                aria-label={t("a11y.prevPhoto")}
                className="absolute left-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-navy-900/40 p-2 text-white/70 hover:bg-white/10 hover:text-white sm:left-5"
                onClick={(e) => {
                  e.stopPropagation();
                  onPrev();
                }}
              >
                <ChevronLeft className="h-7 w-7" />
              </button>
              <button
                aria-label={t("a11y.nextPhoto")}
                className="absolute right-2 top-1/2 z-10 -translate-y-1/2 rounded-full bg-navy-900/40 p-2 text-white/70 hover:bg-white/10 hover:text-white sm:right-5"
                onClick={(e) => {
                  e.stopPropagation();
                  onNext();
                }}
              >
                <ChevronRight className="h-7 w-7" />
              </button>
            </>
          )}

          <motion.div
            key={index}
            initial={{ opacity: 0, scale: 0.97 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.2 }}
            // Constrained to its own origin, so the picture gives a little and
            // springs back: the drag is a gesture, not a way to move a
            // photograph off the screen and leave it there.
            drag={many && swipeable ? "x" : false}
            dragDirectionLock
            dragConstraints={{ left: 0, right: 0 }}
            dragElastic={0.18}
            dragMomentum={false}
            onDragEnd={(_, info) => {
              const intent = swipeIntent(info.offset.x, info.velocity.x);
              if (intent === "prev") onPrev();
              if (intent === "next") onNext();
            }}
            className="relative max-h-[82vh] w-full max-w-4xl"
            onClick={(e) => e.stopPropagation()}
          >
            {children}
          </motion.div>

          {many && (
            <p
              // Announced on change, because for a reader who cannot see the
              // photograph the counter is the only evidence the swipe did
              // anything at all.
              aria-live="polite"
              className="pointer-events-none absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold tabular-nums text-white/85"
            >
              <span className="sr-only">
                {t("a11y.photoPosition", {
                  index: String(index + 1),
                  count: String(count),
                })}
              </span>
              <span aria-hidden="true">
                {index + 1} / {count}
              </span>
            </p>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
