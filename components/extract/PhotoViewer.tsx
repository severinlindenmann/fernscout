"use client";

import type { ReactNode } from "react";
import { Video as VideoIcon } from "lucide-react";
import Lightbox from "@/components/Lightbox";
import { useI18n } from "@/components/LocaleProvider";
import { useObjectUrl } from "@/components/extract/PhotoTile";

export type PhotoViewerItem = {
  id: string;
  kind: "image" | "video";
  /** Already-resolved URL, large enough to tell two similar photographs
   *  apart. Ignored when `file` is given. */
  src?: string | null;
  /** A local, not-yet-uploaded photograph. Takes priority over `src`. */
  file?: File | null;
};

/**
 * The photograph viewer — the owner's own request, B1803 Task 1.2.
 *
 * **Before writing a dialog, this repository already had one.**
 * `components/Lightbox.tsx` is exactly this: full-screen, a close button,
 * left/right chevrons that only appear past one item, swipe, focus trap and
 * return, wrapping on both ends, all driven from `components/useLightbox.ts`
 * and `components/swipe.ts`. It already serves two galleries (`Gallery.tsx`,
 * `GalleryGrid.tsx`) precisely so a third one would not quietly drift from
 * the other two — the same reasoning applies to a third caller here, so this
 * is a thin adapter from the extract flow's own photograph shape onto that
 * chrome rather than a second viewer. `ConfirmPanel.tsx` was the other
 * candidate the brief asked about — it is a non-modal confirmation panel
 * that sits in the page's own flow, the wrong shape for "open this photograph
 * full screen and let me tell two of them apart."
 *
 * A video with nothing to preview (every `.mov` today — see
 * `app/api/helper/[user]/extract/thumb/[run]/[id]/route.ts`) draws the same
 * placeholder `PhotoTile` does, rather than asking `<video>` to play a URL
 * that was never given.
 *
 * **`extra`, B1803 Task 1.3 fix round.** The same slot `Gallery.tsx` already
 * uses for its owner-only "remove this photo" button, threaded straight
 * through to `Lightbox`'s own `extra` prop rather than a second copy of
 * that chrome. `CreditsScreen` is the first caller here: its free sample is
 * spent once, permanently, so the person needs to see the photograph large
 * — via this same viewer, not a small grid tile — before committing to it,
 * and `extra` is where that "use this one" action lives.
 */
export default function PhotoViewer({
  items,
  index,
  onClose,
  onPrev,
  onNext,
  extra,
}: {
  items: PhotoViewerItem[];
  /** Which item is open, or `null` for closed. */
  index: number | null;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  /** A control beside the close button, the caller's own — absent for every
   *  screen that has nothing extra to add. Same shape as `Lightbox`'s own
   *  `extra`; see its doc comment. */
  extra?: ReactNode;
}) {
  const { t } = useI18n();
  const open = index === null ? null : (items[index] ?? null);
  const objectUrl = useObjectUrl(open?.file);
  const resolvedSrc = open ? (open.file ? objectUrl : (open.src ?? null)) : null;

  return (
    <Lightbox
      index={index}
      count={items.length}
      onClose={onClose}
      onPrev={onPrev}
      onNext={onNext}
      extra={extra}
      // A video's own controls own the pointer — the same rule `Gallery.tsx`
      // applies to a clip's scrubber.
      swipeable={open?.kind !== "video"}
    >
      {open &&
        (open.kind === "video" ? (
          resolvedSrc ? (
            <video src={resolvedSrc} className="max-h-[78vh] w-full rounded-lg" controls autoPlay />
          ) : (
            <div className="flex h-[50vh] w-full flex-col items-center justify-center gap-2 text-overlay-ink/80">
              <VideoIcon className="h-12 w-12" aria-hidden />
              <span className="text-sm font-medium">{t("extract.photo.video")}</span>
            </div>
          )
        ) : (
          resolvedSrc && (
            // A local object URL or a per-run staged thumbnail, both sources
            // next/image's remote optimiser cannot serve.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={resolvedSrc}
              alt=""
              className="max-h-[78vh] w-full rounded-lg object-contain"
              draggable={false}
            />
          )
        ))}
    </Lightbox>
  );
}
