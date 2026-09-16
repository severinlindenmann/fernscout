"use client";

import { useEffect, useMemo, useState } from "react";
import { Image as ImageIcon, Video as VideoIcon } from "lucide-react";
import { useI18n } from "@/components/LocaleProvider";
import type { TranslationKey } from "@/lib/i18n";

/**
 * One photograph tile — B1803 Task 1.2.
 *
 * The design draws photographs in four shapes (strip, grid, hero, avatar) but
 * they are all the same tile at a different size, so this is the only
 * component: `size` picks the footprint, everything else — the badge, the
 * selected ring, the placeholder — is shared. `PhotoStrip.tsx` lays several
 * of these out; `PhotoViewer.tsx` is what a press on one opens.
 *
 * **A video never asks the thumbnail route for anything.** `.../extract/thumb`
 * 404s for a `.mov` — see that route's own docblock — so this tile decides by
 * `kind`, not by trying and catching the failure: `kind === "video"` always
 * draws the placeholder below, never an `<img>`. That is also what stops a
 * broken *image* thumbnail from retrying in a loop — `onError` only flips a
 * local flag; nothing here changes `src`, so the browser has nothing left to
 * refetch.
 *
 * **Local previews.** Before a photograph is uploaded it is a `File` in the
 * browser with no URL of its own. Pass `file` instead of `src` and this tile
 * makes and revokes its own `URL.createObjectURL` — `useObjectUrl` below,
 * exported so `PhotoViewer` shares the identical revoke path rather than a
 * second copy of it. The revoke lives here, tied to the tile's own mount and
 * `file` identity, rather than left to whichever screen happens to render a
 * few hundred of these: a tile that creates the URL is the one guaranteed to
 * still exist when it is time to let it go, so ownership and cleanup never
 * drift apart the way they would if some parent list tracked every URL by
 * hand.
 */

export type PhotoTileSize = "avatar" | "strip" | "grid" | "hero";

export type PhotoBadge =
  | { tone: "done" }
  | { tone: "failed" }
  | { tone: "queued" }
  | { tone: "progress"; percent: number };

const SIZE_CLASS: Record<PhotoTileSize, string> = {
  avatar: "h-[58px] w-[58px] shrink-0 rounded-lg",
  strip: "aspect-square w-full rounded-lg",
  grid: "aspect-square w-full rounded-lg",
  hero: "aspect-[16/10] w-full rounded-xl",
};

// The two glyphs the design draws directly rather than spelling out — a
// checkmark and an exclamation mark read the same in every language, so
// unlike "queued" below they carry no translation key of their own. The
// accessible name still does, from `BADGE_SR_KEY`.
const BADGE_GLYPH: Partial<Record<PhotoBadge["tone"], string>> = {
  done: "✓",
  failed: "!",
};

// "queued" is printed on the tile itself, so its translation doubles as both
// the visible text and the accessible name — no separate sr key needed the
// way the glyphs below need one.
//
// There is no "iCloud" badge, deliberately: whether a file is still in
// iCloud is not knowable from the File API (see the ticket's own ruling on
// the omitted badges), so the tone was removed with its string rather than
// left as an affordance nothing can honestly construct.
const BADGE_TEXT_KEY: Partial<Record<PhotoBadge["tone"], TranslationKey>> = {
  queued: "extract.upload.state.queued",
};

// Reused rather than invented: the same words `UploadStep`'s own list already
// carries for "done" and "failed", so a photograph and its list row never
// disagree about what to call the same state.
const BADGE_SR_KEY: Record<"done" | "failed", TranslationKey> = {
  done: "extract.upload.state.done",
  failed: "extract.upload.state.failed",
};

const BADGE_CLASS: Record<PhotoBadge["tone"], string> = {
  // The same green/coral fill-and-text pairs `DayBoard` and `PhotoChips`
  // already use — calibrated for both themes there, not reinvented here.
  done: "bg-green-100 text-green-700",
  failed: "bg-coral-100 text-coral-600",
  // No state-coloured pair exists for "still going" — this is the same dark
  // scrim `Lightbox`'s own floating controls sit on, chosen because it reads
  // over any photograph rather than only over the app's own surfaces.
  queued: "bg-overlay-strong/70 text-overlay-ink",
  progress: "bg-overlay-strong/70 text-overlay-ink",
};

/**
 * Makes (and, on unmount or when `file` changes, revokes) an object URL for
 * a local `File` — the one path a photograph can be drawn from before it has
 * a server URL at all. `null` while there is no file, so a caller can pass
 * this straight through to an `<img src>`.
 */
export function useObjectUrl(file: File | null | undefined): string | null {
  // Created during render, not in an effect: the URL has to exist by the
  // time this render's `<img src>` is painted, and `useMemo` keyed on `file`
  // is what makes "one URL per file identity" true without a setState round
  // trip that would paint one frame with no source at all first.
  const url = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);

  // The revoke is the only thing that belongs in an effect — it is cleanup,
  // not state, so it never trips `react-hooks/set-state-in-effect`. Tied to
  // `url` rather than `file`, so it fires for exactly the URL this hook made,
  // including the very last one on unmount.
  useEffect(() => {
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [url]);

  return url;
}

export default function PhotoTile({
  size,
  kind,
  src,
  file,
  alt,
  badge,
  selected = false,
  onPress,
}: {
  size: PhotoTileSize;
  kind: "image" | "video";
  /** Already-resolved URL — typically the extract thumb route. Ignored when `file` is given. */
  src?: string | null;
  /** A local, not-yet-uploaded photograph. Takes priority over `src` when both are given. */
  file?: File | null;
  alt: string;
  badge?: PhotoBadge;
  selected?: boolean;
  onPress?: () => void;
}) {
  const { t } = useI18n();
  const objectUrl = useObjectUrl(file);
  const resolvedSrc = objectUrl ?? src ?? null;

  // A new src (or a new file) deserves a fresh try. Adjusted during render,
  // not an effect: the React-recommended way to reset state when a prop
  // changes, so a genuinely broken image still fails silently into the
  // placeholder rather than looping, without an extra render pass to get
  // there.
  const [errored, setErrored] = useState(false);
  const [erroredFor, setErroredFor] = useState(resolvedSrc);
  if (erroredFor !== resolvedSrc) {
    setErroredFor(resolvedSrc);
    setErrored(false);
  }

  const showPlaceholder = kind === "video" || !resolvedSrc || errored;

  const frameClass = [
    SIZE_CLASS[size],
    "relative overflow-hidden bg-surface-muted",
    selected ? "ring-[3px] ring-inset ring-yellow-400" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const content = (
    <>
      {showPlaceholder ? (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-ink-faint">
          {kind === "video" ? (
            <>
              <VideoIcon className="h-5 w-5" aria-hidden />
              <span className="text-[10px] font-medium">{t("extract.photo.video")}</span>
            </>
          ) : (
            <ImageIcon className="h-5 w-5" aria-hidden />
          )}
        </div>
      ) : (
        // A local object URL and a per-run staged thumbnail are both
        // same-origin/blob sources next/image's remote optimiser cannot serve.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={resolvedSrc ?? undefined}
          alt=""
          className="h-full w-full object-cover"
          draggable={false}
          onError={() => setErrored(true)}
        />
      )}

      {badge && (
        <span
          aria-label={
            badge.tone === "done" || badge.tone === "failed" ? t(BADGE_SR_KEY[badge.tone]) : undefined
          }
          className={`absolute bottom-1 left-1 z-10 rounded px-1.5 py-0.5 text-[10px] font-semibold leading-none ${BADGE_CLASS[badge.tone]}`}
        >
          {badge.tone === "progress"
            ? `${badge.percent}%`
            : BADGE_TEXT_KEY[badge.tone]
              ? t(BADGE_TEXT_KEY[badge.tone]!)
              : BADGE_GLYPH[badge.tone]}
        </span>
      )}
    </>
  );

  if (onPress) {
    return (
      <button
        type="button"
        onClick={onPress}
        aria-label={alt}
        aria-pressed={selected}
        className={frameClass}
      >
        {content}
      </button>
    );
  }

  return (
    <div role="img" aria-label={alt} className={frameClass}>
      {content}
    </div>
  );
}
