"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { Lock, Play, Share2 } from "lucide-react";
import { useI18n } from "@/components/LocaleProvider";
import { journalPath } from "@/lib/journalPath";

type Photo = { src: string; caption?: string };
type Look = "photo" | "postcard" | "collage" | "video";

const LOOK_PARAM: Record<Exclude<Look, "video">, string> = {
  photo: "photo",
  postcard: "postcard",
  collage: "collage",
};

async function toFile(url: string, name: string, type: string): Promise<File> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`fetch ${url} failed`);
  const blob = await response.blob();
  return new File([blob], name, { type });
}

/**
 * "Share as a story" — B2665. Picks one of three stills or a short clip,
 * optionally the day's own photos, and a caption drawn from the owner's
 * own words, then hands it all to the phone's share sheet
 * (`navigator.share` with `files`) so WhatsApp Status / Instagram Story
 * appear there. Desktop (no file share) falls back to downloads + copy —
 * the same copy pattern `components/studio/readers/ShareLink.tsx` uses.
 */
export default function ShareDayStory({
  username,
  tripId,
  slug,
  photos,
  caption: initialCaption,
  linkAllowed,
  link,
  videoAvailable,
}: {
  username: string;
  tripId: string;
  slug: string;
  photos: Photo[];
  caption: string;
  linkAllowed: boolean;
  link: string | null;
  videoAvailable: boolean;
}) {
  const { t } = useI18n();
  const canCollage = photos.length >= 3;
  const [look, setLook] = useState<Look>("photo");
  const [selectedPhotos, setSelectedPhotos] = useState<Set<number>>(new Set());
  const [caption, setCaption] = useState(initialCaption);
  const [includeLink, setIncludeLink] = useState(linkAllowed);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shared, setShared] = useState(false);

  const base = `/api/web/${encodeURIComponent(username)}/trips/${encodeURIComponent(tripId)}/days/${encodeURIComponent(slug)}/story`;
  const pictureUrl = useMemo(
    () => (look === "video" ? null : `${base}?look=${LOOK_PARAM[look]}`),
    [base, look],
  );
  const videoUrl = `${base}/video`;

  function togglePhoto(index: number) {
    setSelectedPhotos((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  const noop = () => () => {};
  const canShareFiles = useSyncExternalStore(
    noop,
    () => typeof navigator.canShare === "function" && typeof navigator.share === "function",
    () => false,
  );

  async function doShare() {
    setBusy(true);
    setError(null);
    setShared(false);
    try {
      const files: File[] = [];
      if (look === "video") {
        files.push(await toFile(videoUrl, "story.mp4", "video/mp4"));
      } else if (pictureUrl) {
        files.push(await toFile(pictureUrl, "story.png", "image/png"));
      }
      for (const index of selectedPhotos) {
        const photo = photos[index];
        if (!photo) continue;
        files.push(await toFile(photo.src, `photo-${index + 1}.jpg`, "image/jpeg"));
      }
      const text = includeLink && link ? `${caption}\n\n${link}` : caption;
      if (canShareFiles && navigator.canShare({ files })) {
        await navigator.share({ files, text });
        setShared(true);
      } else {
        for (const file of files) {
          const url = URL.createObjectURL(file);
          const a = document.createElement("a");
          a.href = url;
          a.download = file.name;
          a.click();
          URL.revokeObjectURL(url);
        }
        setShared(true);
      }
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") {
        // The owner cancelled the share sheet — not an error.
        return;
      }
      setError(t("studio.share.failed"));
    } finally {
      setBusy(false);
    }
  }

  async function copyCaption() {
    try {
      await navigator.clipboard.writeText(includeLink && link ? `${caption}\n\n${link}` : caption);
    } catch {
      // Best-effort; nothing else to show for a clipboard refusal here.
    }
  }

  async function copyLink() {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
    } catch {
      // Best-effort.
    }
  }

  const tileClass = (active: boolean) =>
    `flex min-h-16 flex-col items-center justify-center gap-1 rounded-xl border px-2 py-2 text-xs font-semibold ${
      active
        ? "border-[#2f6fed] ring-2 ring-[#2f6fed] bg-surface-raised text-ink-strong"
        : "border-line-quiet bg-surface-raised text-ink-secondary hover:border-line-prominent"
    }`;

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="text-sm font-semibold text-ink-strong">{t("studio.share.pickLook")}</p>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <button type="button" aria-pressed={look === "photo"} className={tileClass(look === "photo")} onClick={() => setLook("photo")}>
            {t("studio.share.look.photo")}
          </button>
          <button type="button" aria-pressed={look === "postcard"} className={tileClass(look === "postcard")} onClick={() => setLook("postcard")}>
            {t("studio.share.look.postcard")}
          </button>
          {canCollage && (
            <button type="button" aria-pressed={look === "collage"} className={tileClass(look === "collage")} onClick={() => setLook("collage")}>
              {t("studio.share.look.collage")}
            </button>
          )}
          {videoAvailable && photos.length > 0 && (
            <button type="button" aria-pressed={look === "video"} className={tileClass(look === "video")} onClick={() => setLook("video")}>
              <span className="flex items-center gap-1">
                <Play aria-hidden className="h-3.5 w-3.5" /> {t("studio.share.look.video")}
              </span>
              <span className="text-[11px] font-normal text-ink-tertiary">0:08</span>
            </button>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-xl border border-line-quiet bg-surface-subtle">
        {look === "video" ? (
          // eslint-disable-next-line jsx-a11y/media-has-caption
          <video key={videoUrl} src={videoUrl} muted loop playsInline autoPlay className="mx-auto max-h-[480px] w-auto" />
        ) : (
          pictureUrl && <img key={pictureUrl} src={pictureUrl} alt="" className="mx-auto max-h-[480px] w-auto" />
        )}
      </div>

      {photos.length > 0 && (
        <div>
          <p className="text-sm font-semibold text-ink-strong">{t("studio.share.photosToo")}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {photos.map((photo, index) => (
              <button
                key={photo.src}
                type="button"
                aria-pressed={selectedPhotos.has(index)}
                onClick={() => togglePhoto(index)}
                className={`h-16 w-16 overflow-hidden rounded-lg border ${
                  selectedPhotos.has(index) ? "border-[#2f6fed] ring-2 ring-[#2f6fed]" : "border-line-quiet"
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo.src} alt="" className="h-full w-full object-cover" />
              </button>
            ))}
          </div>
        </div>
      )}

      <label className="flex flex-col gap-1 text-sm font-semibold text-ink-strong">
        {t("studio.share.captionLabel")}
        <textarea
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          rows={3}
          maxLength={500}
          className="mt-1 min-h-20 w-full rounded-xl border border-line-strong bg-surface-raised px-3 py-2 text-base font-normal text-ink-strong"
        />
      </label>

      {linkAllowed ? (
        <label className="flex items-center justify-between gap-3 rounded-xl border border-line-quiet bg-surface-subtle px-3 py-2">
          <span className="text-sm text-ink-strong">
            {t("studio.share.addLink")}
            {link && <span className="block text-xs text-ink-secondary">{link.replace(/^https?:\/\//, "")}</span>}
          </span>
          <input
            type="checkbox"
            checked={includeLink}
            onChange={(e) => setIncludeLink(e.target.checked)}
            className="h-5 w-5"
          />
        </label>
      ) : (
        <p className="flex items-start gap-2 rounded-xl border border-line-quiet bg-surface-subtle px-3 py-2 text-xs text-ink-secondary">
          <Lock aria-hidden className="mt-0.5 h-4 w-4 flex-none" />
          <span>
            {t("studio.share.noLink")}{" "}
            <a
              href={`${journalPath(username)}/studio/trip/visibility?trip=${encodeURIComponent(tripId)}`}
              className="underline underline-offset-2"
            >
              {t("studio.share.noLinkHint")}
            </a>
          </span>
        </p>
      )}

      <div className="flex flex-col gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={doShare}
          className="flex min-h-11 items-center justify-center gap-2 rounded-full bg-yellow-400 px-5 text-sm font-semibold text-navy-900 hover:bg-yellow-300 disabled:opacity-60"
        >
          <Share2 aria-hidden className="h-4 w-4" />
          {t(canShareFiles ? "studio.share.shareButton" : "studio.share.downloadButton")}
        </button>
        {!canShareFiles && (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={copyCaption} className="min-h-9 rounded-lg border border-line-strong px-3 text-xs font-semibold text-ink-strong">
              {t("studio.share.copyCaption")}
            </button>
            {includeLink && link && (
              <button type="button" onClick={copyLink} className="min-h-9 rounded-lg border border-line-strong px-3 text-xs font-semibold text-ink-strong">
                {t("studio.share.copyLink")}
              </button>
            )}
          </div>
        )}
        <p className="text-xs text-ink-secondary">{t("studio.share.helper")}</p>
        {shared && !error && <p role="status" className="text-xs text-green-700">{t("studio.share.done")}</p>}
        {error && <p role="alert" className="text-xs text-coral-600">{error}</p>}
      </div>
    </div>
  );
}
