"use client";

import { useState } from "react";
import Link from "next/link";
import { CircleCheck, Images, PencilLine, Share2 } from "lucide-react";
import { useI18n } from "@/components/LocaleProvider";
import { journalPath } from "@/lib/journalPath";

/**
 * "Published" — B2678. What a day's publish actually did (`told`, straight
 * from B2674's response — never more than it says), then one "Share as a
 * story" card leading, then one card of three action rows (icon, title,
 * sub-line, `>`), 64px each, separated by hairlines rather than three loose
 * underlined links — the owner's own objection to the screen this replaces.
 */
export default function PublishedDay({
  username,
  tripId,
  slug,
  title,
  readerLine,
  thumb,
}: {
  username: string;
  tripId: string;
  slug: string;
  title: string;
  /** The one sentence of what happened — built by the caller from B2674's
   *  `told` and the reader count, never invented here. */
  readerLine: string;
  /** The story thumbnail (`…/story?look=photo`), or null when the day has
   *  no photographs to draw one from. */
  thumb: string | null;
}) {
  const { t } = useI18n();
  const [shared, setShared] = useState(false);
  const dayHref = `${journalPath(username)}/trips/${encodeURIComponent(tripId)}/day/${encodeURIComponent(slug)}`;
  const shareHref = `${journalPath(username)}/studio/day/share?trip=${encodeURIComponent(tripId)}&day=${encodeURIComponent(slug)}`;
  const writeHref = `${journalPath(username)}/studio/day/new?from=published`;
  // EditDay's own panel already has its add/drop photo controls built in —
  // this just has to land there, not reopen a sheet that page has no such
  // thing for.
  const addPhotosHref = `${journalPath(username)}/studio/day/edit?slug=${encodeURIComponent(slug)}`;
  const fullLink = typeof window !== "undefined" ? `${window.location.origin}${dayHref}` : dayHref;

  async function sendLink() {
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title, url: fullLink });
        setShared(true);
        return;
      }
    } catch {
      // Cancelled, or share failed — fall through to copy.
    }
    try {
      await navigator.clipboard.writeText(fullLink);
      setShared(true);
    } catch {
      // Best-effort; nothing else to show for a clipboard refusal.
    }
  }

  const rows: { icon: React.ReactNode; title: string; sub: string; onClick?: () => void; href?: string }[] = [
    { icon: <Share2 aria-hidden className="h-5 w-5" />, title: t("studio.published.sendLink"), sub: t("studio.published.sendLinkSub"), onClick: () => void sendLink() },
    { icon: <PencilLine aria-hidden className="h-5 w-5" />, title: t("studio.published.nextDay"), sub: t("studio.published.nextDaySub"), href: writeHref },
    { icon: <Images aria-hidden className="h-5 w-5" />, title: t("studio.published.addPhotos"), sub: t("studio.published.addPhotosSub"), href: addPhotosHref },
  ];

  return (
    <div className="mt-4">
      <div role="status" className="flex items-start gap-3 rounded-2xl border border-green-500/40 bg-green-100 px-4 py-4 text-ink-strong">
        <CircleCheck aria-hidden className="mt-0.5 h-6 w-6 flex-none text-green-700" />
        <div className="min-w-0">
          <p className="text-sm font-semibold uppercase tracking-wide text-green-700">{t("studio.published.pageTitle")}</p>
          <p className="mt-0.5 font-display text-[22px] font-semibold leading-tight">{title}</p>
          <p className="mt-2 text-base leading-snug">{readerLine}</p>
          <Link href={dayHref} className="mt-3 inline-flex min-h-11 items-center font-semibold underline underline-offset-2">
            {t("studio.published.seeDay")}
          </Link>
        </div>
      </div>

      <div className="mt-5 overflow-hidden rounded-2xl border border-line-quiet bg-surface-raised">
        {thumb && (
          <div className="flex h-[120px] items-center justify-center bg-surface-subtle">
            {/* eslint-disable-next-line @next/next/no-img-element -- a small story-look thumbnail. */}
            <img src={`${thumb}&w=240`} alt="" className="h-[108px] w-[86px] rounded-lg object-cover" />
          </div>
        )}
        <div className="p-4">
          <p className="font-display text-xl font-semibold text-ink-strong">{t("studio.share.title")}</p>
          <p className="mt-1 text-base text-ink-secondary">{t("studio.share.whatNextBody")}</p>
          <Link
            href={shareHref}
            className="mt-4 flex h-[50px] items-center justify-center rounded-full bg-yellow-400 px-5 text-base font-semibold text-navy-900 hover:bg-yellow-300"
          >
            {t("studio.share.whatNextLabel")}
          </Link>
        </div>
      </div>

      <div className="mt-3 divide-y divide-line-faint overflow-hidden rounded-2xl border border-line-quiet bg-surface-raised">
        {rows.map((row) => {
          const body = (
            <>
              <span className="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-surface-subtle text-ink-body">{row.icon}</span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-ink-strong">{row.title}</span>
                <span className="block text-sm leading-[1.45] text-ink-secondary">{row.href ? row.sub : shared && row.title === t("studio.published.sendLink") ? t("studio.share.done") : row.sub}</span>
              </span>
              <span aria-hidden className="text-ink-faint">
                ›
              </span>
            </>
          );
          const cls = "flex min-h-14 w-full items-center gap-3 px-4 py-[18px] text-left hover:bg-surface-subtle";
          return row.href ? (
            <Link key={row.title} href={row.href} className={cls}>
              {body}
            </Link>
          ) : (
            <button key={row.title} type="button" onClick={row.onClick} className={cls}>
              {body}
            </button>
          );
        })}
      </div>
    </div>
  );
}
