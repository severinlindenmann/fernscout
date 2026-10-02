"use client";

import { type ReactNode, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Lock, Play, Share2 } from "lucide-react";
import { useI18n } from "@/components/LocaleProvider";
import { journalPath } from "@/lib/journalPath";
import ReadAlongLink, { type ReadAlongState } from "./ReadAlongLink";

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

/** B2678 — the look is remembered across visits, so a story made every day
 *  does not start from "photo" every time. Per owner, not per trip: it is a
 *  preference about how they like their stories to look, not a trip fact. */
function rememberedLook(username: string): Look | null {
  try {
    const raw = window.localStorage.getItem(`fs.share.look.${username}`);
    return raw === "photo" || raw === "postcard" || raw === "collage" || raw === "video" ? raw : null;
  } catch {
    return null;
  }
}
function rememberLook(username: string, look: Look) {
  try {
    window.localStorage.setItem(`fs.share.look.${username}`, look);
  } catch {
    // A browser with no storage still works; it just asks again next time.
  }
}

/**
 * "Share as a story" — B2665. Picks one of three stills or a short clip,
 * optionally the day's own photos, and a caption drawn from the owner's
 * own words, then hands it all to the phone's share sheet
 * (`navigator.share` with `files`) so WhatsApp Status / Instagram Story
 * appear there. Desktop (no file share) falls back to downloads + copy —
 * the same copy pattern `components/studio/readers/ShareLink.tsx` uses.
 *
 * B2665 round 2: iOS only opens the share sheet from inside the tap that
 * triggered it, so every file this button might share is fetched ahead of
 * time, into state, as soon as anything that changes the output changes —
 * never after the tap. The tap itself only ever reads state and calls
 * `navigator.share` synchronously.
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
  visibility = "public",
  readAlong = null,
}: {
  username: string;
  tripId: string;
  slug: string;
  photos: Photo[];
  caption: string;
  /** Public trip only — the plain day link, decided server-side. Unused for
   * a readers-only trip, which carries `readAlong` instead. */
  linkAllowed: boolean;
  link: string | null;
  videoAvailable: boolean;
  /** B2665 round 2 — which link, if any, this trip could carry on a story. */
  visibility?: "public" | "guest" | "private";
  /** The owner's standing read-along link's current state, for a
   * readers-only trip. `null` when the trip is public (irrelevant) or the
   * feature is unavailable on this journal — either way nothing is shown. */
  readAlong?: ReadAlongState | null;
}) {
  const { t } = useI18n();
  // B2665 round 2 — the read-along link's live URL, kept in state so
  // turning it on, pausing or resuming updates the share immediately.
  const [readAlongUrl, setReadAlongUrl] = useState<string | null>(
    readAlong?.status === "live" ? readAlong.url : null,
  );
  const guestLinkAllowed = visibility === "guest" && readAlongUrl !== null;
  const effectiveLinkAllowed = visibility === "public" ? linkAllowed : guestLinkAllowed;
  const effectiveLink = visibility === "public" ? link : readAlongUrl;
  const canCollage = photos.length >= 3;
  const looks: Look[] = [
    "photo",
    "postcard",
    ...(canCollage ? (["collage"] as const) : []),
    ...(videoAvailable && photos.length > 0 ? (["video"] as const) : []),
  ];
  const [look, setLook] = useState<Look>(() => {
    const remembered = rememberedLook(username);
    return remembered && looks.includes(remembered) ? remembered : "photo";
  });
  function chooseLook(next: Look) {
    setLook(next);
    rememberLook(username, next);
  }
  // B2678 — "Include more photos from this day", off by default: the day's
  // own photos are a choice to widen the story with, not something offered
  // open on every visit.
  const [includeMorePhotos, setIncludeMorePhotos] = useState(false);
  const [selectedPhotos, setSelectedPhotos] = useState<Set<number>>(new Set());
  const [caption, setCaption] = useState(initialCaption);
  const [includeLink, setIncludeLink] = useState(effectiveLinkAllowed);
  // B2665 round 2 — off by default: a photo's own caption is the owner's
  // words repeated verbatim on a public card, drawn only on request.
  const [showCaptions, setShowCaptions] = useState(false);
  const [shared, setShared] = useState(false);
  const [shareError, setShareError] = useState(false);

  const base = `/api/web/${encodeURIComponent(username)}/trips/${encodeURIComponent(tripId)}/days/${encodeURIComponent(slug)}/story`;
  const query = useMemo(() => {
    const params = new URLSearchParams();
    params.set("link", includeLink ? "1" : "0");
    if (visibility === "guest") params.set("readalong", "1");
    if (showCaptions) params.set("captions", "1");
    return params.toString();
  }, [includeLink, showCaptions, visibility]);
  const pictureUrl = useMemo(
    () => (look === "video" ? null : `${base}?look=${LOOK_PARAM[look]}&${query}`),
    [base, look, query],
  );
  const videoUrl = `${base}/video?${query}`;

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

  // The files this tap would share, fetched ahead of the tap itself (see
  // the component doc above) — "idle" never happened yet, "preparing" is in
  // flight, "ready" has `files` to hand to `navigator.share` with no await
  // in between, "error" means the fetch itself failed.
  type PrepareState = "idle" | "preparing" | "ready" | "error";
  const [prepareState, setPrepareState] = useState<PrepareState>("idle");
  const [preparedFiles, setPreparedFiles] = useState<File[] | null>(null);
  const prepareToken = useRef(0);

  async function prepare(token: number) {
    setPrepareState("preparing");
    setShared(false);
    setShareError(false);
    try {
      const files: File[] = [];
      if (look === "video") {
        files.push(await toFile(videoUrl, "story.mp4", "video/mp4"));
      } else if (pictureUrl) {
        files.push(await toFile(pictureUrl, "story.png", "image/png"));
      }
      if (includeMorePhotos) {
        for (const index of selectedPhotos) {
          const photo = photos[index];
          if (!photo) continue;
          files.push(await toFile(photo.src, `photo-${index + 1}.jpg`, "image/jpeg"));
        }
      }
      if (token !== prepareToken.current) return; // a later change overtook this fetch
      setPreparedFiles(files);
      setPrepareState("ready");
    } catch {
      if (token !== prepareToken.current) return;
      setPreparedFiles(null);
      setPrepareState("error");
    }
  }

  useEffect(() => {
    void prepare(++prepareToken.current);
    // selectedPhotos is a Set replaced wholesale on every toggle, so a
    // reference check here already re-runs this on every real change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [look, pictureUrl, videoUrl, includeMorePhotos, selectedPhotos]);

  const previewUrl = useMemo(() => {
    if (!preparedFiles || !preparedFiles[0]) return null;
    return URL.createObjectURL(preparedFiles[0]);
  }, [preparedFiles]);
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function shareText(): string {
    return includeLink && effectiveLink ? `${caption}\n\n${effectiveLink}` : caption;
  }

  function downloadFiles(files: File[]) {
    for (const file of files) {
      const url = URL.createObjectURL(file);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name;
      a.click();
      URL.revokeObjectURL(url);
    }
  }

  // Called synchronously from the button's own click handler — iOS only
  // opens the share sheet from inside the gesture that asked for it, so
  // `navigator.share` is called with no `await` ahead of it. The files are
  // already sitting in state from the effect above.
  function handleShareClick() {
    if (!preparedFiles) return;
    const files = preparedFiles;
    const text = shareText();
    setShareError(false);
    if (canShareFiles && navigator.canShare({ files })) {
      navigator
        .share({ files, text })
        .then(() => setShared(true))
        .catch((e: unknown) => {
          if (e instanceof Error && e.name === "AbortError") return; // cancelled, not an error
          setShareError(true);
        });
    } else {
      downloadFiles(files);
    }
  }

  function retryPrepare() {
    void prepare(++prepareToken.current);
  }

  async function copyCaption() {
    try {
      await navigator.clipboard.writeText(shareText());
    } catch {
      // Best-effort; nothing else to show for a clipboard refusal here.
    }
  }

  async function copyLink() {
    if (!effectiveLink) return;
    try {
      await navigator.clipboard.writeText(effectiveLink);
    } catch {
      // Best-effort.
    }
  }

  const tileClass = (active: boolean) =>
    `flex flex-col gap-1.5 rounded-xl border p-1.5 text-left text-xs font-semibold ${
      active
        ? "border-[#2f6fed] ring-2 ring-[#2f6fed] bg-surface-raised text-ink-strong"
        : "border-line-quiet bg-surface-raised text-ink-secondary hover:border-line-prominent"
    }`;

  // A small sketch of each look, from the day's own photos — what the drafts
  // showed. Drawn here rather than by asking the server for four cards.
  const [first, second, third] = photos;
  const thumb = (src: string | undefined, className: string) =>
    src ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt="" className={`block object-cover ${className}`} />
    ) : (
      <span className={`block bg-navy-600 ${className}`} />
    );
  const sketch: Record<Look, ReactNode> = {
    photo: (
      <span className="flex aspect-[9/16] w-full flex-col overflow-hidden rounded-md bg-navy-950">
        {thumb(first?.src, "h-[70%] w-full")}
        <span className="m-1.5 block h-1.5 w-3/4 rounded-sm bg-cream-50/80" />
      </span>
    ),
    postcard: (
      <span className="flex aspect-[9/16] w-full flex-col gap-1 overflow-hidden rounded-md bg-cream-100 p-1.5">
        <span className="block bg-cream-50 p-0.5">{thumb(first?.src, "aspect-[4/5] w-full")}</span>
        <span className="block h-1.5 w-3/4 rounded-sm bg-navy-900/70" />
      </span>
    ),
    collage: (
      <span className="grid aspect-[9/16] w-full grid-cols-2 content-start gap-0.5 overflow-hidden rounded-md bg-navy-900 p-1">
        {thumb(first?.src, "col-span-2 aspect-[4/3] w-full rounded-sm")}
        {thumb(second?.src, "aspect-square w-full rounded-sm")}
        {thumb(third?.src, "aspect-square w-full rounded-sm")}
      </span>
    ),
    video: (
      <span className="relative block aspect-[9/16] w-full overflow-hidden rounded-md bg-navy-950">
        {thumb(second?.src ?? first?.src, "h-full w-full")}
        <span className="absolute left-1/2 top-1/2 flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-yellow-400 text-navy-900">
          <Play aria-hidden className="h-3.5 w-3.5" />
        </span>
        <span className="absolute bottom-1 right-1 rounded bg-navy-950 px-1 text-[10px] font-semibold text-cream-50">0:08</span>
      </span>
    ),
  };

  const ready = prepareState === "ready" && preparedFiles !== null;

  return (
    <div className="flex flex-col gap-5">
      {/* B2678 — the preview leads; the look picker is the control for it,
          not the first thing on the screen. */}
      <div data-testid="story-preview" className="relative overflow-hidden rounded-xl border border-line-quiet bg-surface-subtle">
        {prepareState === "preparing" ? (
          <div className="relative mx-auto max-h-[480px]">
            {first?.src && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={first.src} alt="" className="mx-auto max-h-[480px] w-auto opacity-40" />
            )}
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm font-semibold text-ink-strong">
              <span
                aria-hidden
                className="h-8 w-8 animate-spin rounded-full border-2 border-line-quiet border-t-[#2f6fed] motion-reduce:animate-none"
              />
              <span>{t(look === "video" ? "studio.share.preparingVideo" : "studio.share.preparingPicture")}</span>
            </div>
          </div>
        ) : prepareState === "error" ? (
          <div className="flex flex-col items-center gap-3 p-8 text-center text-sm">
            <p role="alert" className="font-semibold text-coral-600">
              {t(look === "video" ? "studio.share.prepareFailedVideo" : "studio.share.prepareFailedPicture")}
            </p>
            <button type="button" onClick={retryPrepare} className="min-h-9 rounded-lg border border-line-strong px-3 text-xs font-semibold text-ink-strong">
              {t("studio.share.tryAgain")}
            </button>
          </div>
        ) : previewUrl ? (
          look === "video" ? (
            <video key={previewUrl} src={previewUrl} muted loop playsInline autoPlay className="mx-auto max-h-[480px] w-auto" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img key={previewUrl} src={previewUrl} alt="" className="mx-auto max-h-[480px] w-auto" />
          )
        ) : null}
      </div>

      <div>
        <p className="text-sm font-semibold text-ink-strong">{t("studio.share.pickLook")}</p>
        <div className="mt-2 grid grid-cols-4 gap-2 sm:max-w-md">
          {looks.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={look === option}
              className={tileClass(look === option)}
              onClick={() => chooseLook(option)}
            >
              {sketch[option]}
              <span className="px-0.5">{t(`studio.share.look.${option}`)}</span>
            </button>
          ))}
        </div>
      </div>

      {photos.length > 0 && (
        <div>
          {/* B2678 — "Include more photos from this day", off by default:
              the picker only opens once the owner actually asks for it. */}
          <label className="flex min-h-11 items-center gap-3 text-sm text-ink-strong">
            <input type="checkbox" className="size-5" checked={includeMorePhotos} onChange={(e) => setIncludeMorePhotos(e.target.checked)} />
            {t("studio.share.photosToo")}
          </label>
          {includeMorePhotos && (
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
          )}
        </div>
      )}

      <label className="flex min-h-11 items-center gap-3 text-sm text-ink-strong">
        <input type="checkbox" className="size-5" checked={showCaptions} onChange={(e) => setShowCaptions(e.target.checked)} />
        {t("studio.share.showCaptions")}
      </label>

      <label className="flex flex-col gap-1 text-sm font-semibold text-ink-strong">
        {t("studio.share.captionLabel")}
        <textarea
          value={caption}
          onChange={(e) => setCaption(e.target.value)}
          rows={3}
          maxLength={500}
          placeholder={t("studio.share.captionPlaceholder")}
          className="mt-1 min-h-20 w-full rounded-xl border border-line-strong bg-surface-raised px-3 py-2 text-base font-normal text-ink-strong"
        />
      </label>

      {visibility === "public" &&
        (linkAllowed ? (
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
        ))}

      {/* B2665 round 2 — a readers-only trip carries the owner's own
          standing "Ask to read along" link instead, when the feature is
          available on this journal (`readAlong !== null`); absent entirely
          otherwise. */}
      {visibility === "guest" && readAlong && (
        <div className="flex flex-col gap-2">
          <ReadAlongLink username={username} initial={readAlong} onLiveChange={setReadAlongUrl} />
          {readAlongUrl && (
            <label className="flex items-center justify-between gap-3 rounded-xl border border-line-quiet bg-surface-subtle px-3 py-2">
              <span className="text-sm text-ink-strong">{t("studio.share.addLink")}</span>
              <input
                type="checkbox"
                checked={includeLink}
                onChange={(e) => setIncludeLink(e.target.checked)}
                className="h-5 w-5"
              />
            </label>
          )}
        </div>
      )}

      {visibility === "private" && (
        <div className="flex flex-col gap-2">
          <p className="flex items-start gap-2 rounded-xl border border-line-quiet bg-surface-subtle px-3 py-2 text-xs text-ink-secondary">
            <Lock aria-hidden className="mt-0.5 h-4 w-4 flex-none" />
            <span>{t("studio.share.readAlong.private")}</span>
          </p>
          <p role="alert" className="rounded-xl border border-line-quiet bg-surface-subtle px-3 py-2 text-xs text-coral-600">
            {t("studio.share.readAlong.privateWarning")}
          </p>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!ready}
            onClick={handleShareClick}
            className="flex min-h-11 items-center justify-center gap-2 rounded-full bg-yellow-400 px-5 text-sm font-semibold text-navy-900 hover:bg-yellow-300 disabled:opacity-60"
          >
            <Share2 aria-hidden className="h-4 w-4" />
            {t(canShareFiles ? "studio.share.shareButton" : "studio.share.downloadButton")}
          </button>
          {/* B2665 round 2 — "Copy link" sits next to Share whenever a link
              exists, on every device; "Copy caption" stays a desktop
              fallback below, next to the download buttons. */}
          {includeLink && effectiveLink && (
            <button type="button" onClick={copyLink} className="min-h-11 rounded-lg border border-line-strong px-3 text-xs font-semibold text-ink-strong">
              {t("studio.share.copyLink")}
            </button>
          )}
        </div>
        {!canShareFiles && (
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={copyCaption} className="min-h-9 rounded-lg border border-line-strong px-3 text-xs font-semibold text-ink-strong">
              {t("studio.share.copyCaption")}
            </button>
          </div>
        )}
        <p className="text-xs text-ink-secondary">{t("studio.share.helper")}</p>
        {shared && !shareError && <p role="status" className="text-xs text-green-700">{t("studio.share.done")}</p>}
        {shareError && <p role="alert" className="text-xs text-coral-600">{t("studio.share.failed")}</p>}
      </div>
    </div>
  );
}
