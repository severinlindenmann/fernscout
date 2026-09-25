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
 * Staged `src` values are WebP previews for both images and videos — a clip's
 * is animated, so the `<img>` below loops it. Local video files use a muted
 * video element until a server preview is available.
 *
 * **Two sources, tried in order.** A local `File` paints instantly and costs
 * no request, so it goes first — but Chrome and Firefox decode no HEIC at
 * all, and Safari does, so which browser can show which file is not something
 * this can decide by extension. It does not try: the object URL goes first,
 * and an `onError` moves on to the staged preview the server made, which is
 * every format. The index only ever goes forward, so there is still no
 * refetch loop; past the end there is nothing left to ask for and the
 * placeholder is the honest answer.
 *
 * **Local previews.** Before a photograph is uploaded it is a `File` in the
 * browser with no URL of its own. Pass `file` instead of `src` and this tile
 * makes and revokes its own `URL.createObjectURL` — `useObjectUrl` below.
 * The revoke lives here, tied to the tile's own mount and
 * `file` identity, rather than left to whichever screen happens to render a
 * few hundred of these: a tile that creates the URL is the one guaranteed to
 * still exist when it is time to let it go, so ownership and cleanup never
 * drift apart the way they would if some parent list tracked every URL by
 * hand.
 */

/** A thumbnail URL for one staged photograph — the same route every screen in
 *  this flow draws from, `app/api/helper/[user]/studio/thumb/[run]/[id]`.
 *  `null` for a photograph that has no staged id yet, so a caller can pass
 *  the result straight to `src`. */
export function thumbSrc(username: string, runId: string, photoId: string | null | undefined): string | null {
  if (!photoId) return null;
  return `/api/helper/${encodeURIComponent(username)}/studio/thumb/${encodeURIComponent(runId)}/${encodeURIComponent(photoId)}`;
}

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
  queued: "studio.photos.upload.state.queued",
};

// Reused rather than invented: the same words `UploadStep`'s own list already
// carries for "done" and "failed", so a photograph and its list row never
// disagree about what to call the same state.
const BADGE_SR_KEY: Record<"done" | "failed", TranslationKey> = {
  done: "studio.photos.upload.state.done",
  failed: "studio.photos.upload.state.failed",
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
 * a server URL at all. `null` while there is no file. Reached through
 * `usePreviewSource` below, which is what `PhotoViewer` shares rather than a
 * second copy of the same revoke path.
 *
 * **Create and revoke in the same effect, not in a `useMemo` — B1883.** The
 * URL used to be made during render (`useMemo`, keyed on `file`) with only
 * the revoke living in an effect. That is exactly the shape Strict Mode's
 * development-only double-invoke breaks: mount runs the effect once (revoke
 * of nothing, since there was no prior url), simulates an unmount (revokes
 * the url the single render made), then simulates a remount by running
 * effects again with no new render in between — so the second "mount"
 * revokes the *same* url a second time and the `<img>` is left pointing at
 * an already-revoked blob. Same shape as B603. Production builds run effects
 * once, which is why this was invisible outside `next dev`.
 *
 * Owning the url in state and creating it inside the effect makes each
 * effect run responsible for exactly the url it made: the double-invoke
 * sequence now creates a fresh url on the second "mount" rather than
 * re-revoking the first one, and state is what lets that second url reach
 * the `<img>`. The cost is one extra render with no source between mount and
 * the effect flushing — imperceptible next to a preview that never painted
 * at all.
 *
 * `react-hooks/set-state-in-effect` is disabled below on purpose, the same
 * way `HelperRoom.tsx`'s own post-mount `localStorage` read is (B603, that
 * component's own doc comment): `URL.createObjectURL` is a browser side
 * effect with no render-time equivalent (unlike the derived-state case that
 * rule exists to catch), so it cannot run any earlier than this.
 */
function useObjectUrl(file: File | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setUrl(null);
      return;
    }
    const created = URL.createObjectURL(file);
    setUrl(created);
    return () => URL.revokeObjectURL(created);
  }, [file]);

  return url;
}

/**
 * Which of a photograph's two possible sources to draw, and what to do when
 * one of them does not paint — B1874.
 *
 * A local `File` is instant and costs no request, so it goes first. But
 * Chrome and Firefox decode no HEIC at all and Safari does, so "can this
 * browser show this file" is not answerable from the filename. Rather than
 * guess, this tries the object URL and moves to the staged preview the
 * server made when the browser says it cannot. `tried` only ever goes
 * forward, so nothing refetches; past the end there is nothing left to ask
 * for, which is what `PhotoTile`'s placeholder means.
 *
 * `waiting` is the third state the old code did not have: a file the browser
 * could not draw, with no staged preview offered yet. A grid of grey icons
 * reads as stuck, and an import that is working should not. It ends the
 * moment `giveUp` says no staged preview is coming — an import that has
 * stopped must not go on looking busy.
 */
export function usePreviewSource(
  file: File | null | undefined,
  src: string | null | undefined,
  /** True once nothing more is coming — the upload that would have produced
   *  a staged preview failed, so waiting is a lie. B1922: eight tiles pulsed
   *  forever behind a red "8 did not make it" panel, which reads as an import
   *  still working rather than one that stopped. */
  giveUp = false,
) {
  const objectUrl = useObjectUrl(file);
  const sources = useMemo(
    () => [objectUrl, src].filter((s): s is string => !!s),
    [objectUrl, src],
  );

  // Remembered by URL, not by position: the staged preview arrives *after*
  // the local one has already failed, and a list that grows must not put the
  // known-bad source back at the front of the queue. A URL only ever moves
  // into this set, so nothing is ever asked for twice.
  const [failed, setFailed] = useState<readonly string[]>([]);
  const resolvedSrc = sources.find((s) => !failed.includes(s)) ?? null;

  // Adjusted during render, not in an effect: the React-recommended way to
  // reset state when a prop changes, so the skeleton belongs to the source
  // actually being drawn without an extra render pass to get there.
  const [loaded, setLoaded] = useState(false);
  const [loadedFor, setLoadedFor] = useState(resolvedSrc);
  if (loadedFor !== resolvedSrc) {
    setLoadedFor(resolvedSrc);
    setLoaded(false);
  }

  return {
    resolvedSrc,
    /** True while the local file is the one being drawn — the only case a
     *  clip is a `<video>` rather than the staged animated WebP. */
    isLocal: resolvedSrc !== null && resolvedSrc === objectUrl,
    waiting: !resolvedSrc && !!file && !src && !giveUp,
    loaded,
    onLoaded: () => setLoaded(true),
    onFailed: () =>
      setFailed((f) => (resolvedSrc && !f.includes(resolvedSrc) ? [...f, resolvedSrc] : f)),
  };
}

/**
 * What a tile looks like while its picture is on its way — B1941.
 *
 * The kind icon, pulsing. The owner saw six flat rectangles on the day board
 * and read them as broken; they were previews mid-generation, and a first
 * request runs `heif-convert` or `ffmpeg` per file, which is seconds rather
 * than milliseconds. A tint with nothing in it says none of that. The icon is
 * the same one the exhausted state draws, so "coming" and "never" differ by
 * the pulse and the words rather than by appearing to be different screens.
 */
function Pending({ kind }: { kind: "image" | "video" }) {
  return (
    <div
      className="absolute inset-0 flex animate-pulse items-center justify-center bg-ink-faint/15 text-ink-faint/60"
      aria-hidden
    >
      {kind === "video" ? <VideoIcon className="h-5 w-5" /> : <ImageIcon className="h-5 w-5" />}
    </div>
  );
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
  // A failed upload is the end of the road for this tile's staged preview:
  // the id that would have addressed one never arrived and will not, short of
  // the person pressing retry — which re-renders this with a fresh badge.
  const { resolvedSrc, isLocal, waiting, loaded, onLoaded, onFailed } = usePreviewSource(
    file,
    src,
    badge?.tone === "failed",
  );
  const showPlaceholder = !resolvedSrc && !waiting;

  const frameClass = [
    SIZE_CLASS[size],
    "relative overflow-hidden bg-surface-muted",
    selected ? "ring-[3px] ring-inset ring-yellow-400" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const content = (
    <>
      {waiting ? (
        <Pending kind={kind} />
      ) : showPlaceholder ? (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-ink-faint">
          {kind === "video" ? (
            <>
              <VideoIcon className="h-5 w-5" aria-hidden />
              <span className="text-[10px] font-medium">{t("studio.photos.photo.video")}</span>
            </>
          ) : (
            <>
              <ImageIcon className="h-5 w-5" aria-hidden />
              {/* B1922. A bare icon is the same picture as a photograph that
                  is merely slow, and the owner read it as one. */}
              <span className="text-center text-[10px] font-medium leading-tight">
                {t("studio.photos.photo.noPreview")}
              </span>
            </>
          )}
        </div>
      ) : kind === "video" && isLocal ? (
        // Only the local file is a video to a browser — the staged preview
        // for a clip is an animated WebP, which is an <img>.
        <video
          src={resolvedSrc ?? undefined}
          muted
          playsInline
          preload="metadata"
          className="h-full w-full object-cover"
          onLoadedData={onLoaded}
          onError={onFailed}
        />
      ) : (
        // A local object URL and a per-run staged thumbnail are both
        // same-origin/blob sources next/image's remote optimiser cannot serve.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={resolvedSrc ?? undefined}
          alt=""
          className="h-full w-full object-cover"
          draggable={false}
          onLoad={onLoaded}
          onError={onFailed}
        />
      )}

      {/* Over whichever element is drawing, until it has actually painted:
          a staged preview is a request, and an empty frame for the length of
          one is the same "is this stuck?" the placeholder used to be. */}
      {resolvedSrc && !loaded && <Pending kind={kind} />}

      {kind === "video" && !showPlaceholder && (
        <span className="absolute right-1 top-1 rounded bg-overlay-strong/70 px-1.5 py-0.5 text-[10px] text-overlay-ink">
          {t("studio.photos.photo.video")}
        </span>
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
