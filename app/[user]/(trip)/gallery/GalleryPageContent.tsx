"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { BookOpen, Clapperboard, Send } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import GalleryGrid from "@/components/GalleryGrid";
import type { PlaceView } from "@/components/WorldMap";
import type { MediaTile, PhotobookEntry, PostcardEntry } from "@/lib/types";
import { useI18n } from "@/components/LocaleProvider";

// Behind a button — nobody should pay to download the presentation bundle
// (map projection data, motion) until they actually press it.
const SlideShow = dynamic(() => import("@/components/SlideShow"), { ssr: false });

export default function GalleryPageContent({
  media,
  places,
  photobook,
  postcard,
}: {
  media: MediaTile[];
  places: PlaceView[];
  /**
   * Present only for the journal's owner, on a journal with photobook and
   * credits switched on. The server decides (`page.tsx`, via
   * `lib/photobook/entry.ts`); this component only renders what it was
   * handed, and the routes the photobook page calls check for themselves
   * rather than trusting either.
   */
  photobook?: PhotobookEntry;
  /**
   * Present only for the journal's owner, on a journal with postcards and
   * contacts switched on — B441. The server decides (`page.tsx`); this
   * component only renders what it was handed, and the routes the sheet calls
   * check for themselves rather than trusting either.
   */
  postcard?: PostcardEntry;
}) {
  const { t } = useI18n();
  const [showing, setShowing] = useState(false);
  const [picking, setPicking] = useState(false);
  return (
    <div className="min-h-screen">
      <PageHeader />
      <main id="main" tabIndex={-1} className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <h1 className="font-display text-3xl font-semibold tracking-tight text-navy-900 sm:text-4xl">
          {t("gallery.title")}
        </h1>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-navy-600">
            {media.length} {t("gallery.subtitle")}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            {/* A link, not a picker: a book is the whole trip, so there is
                nothing to select in the gallery first — unlike the postcard
                button beside it, which does pick a photograph. Always the
                trip-scoped URL, even from the current trip's own gallery
                where the shorter path would also resolve — one href is one
                thing to be wrong. */}
            {photobook && media.length > 0 && (
              <a
                href={`/${photobook.username}/trips/${photobook.trip}/photobook`}
                className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border border-navy-200 bg-white px-4 text-sm font-semibold text-navy-700 transition-colors hover:border-navy-500"
              >
                <BookOpen className="h-4 w-4" />
                {t("photobook.start")}
              </a>
            )}
            {/* The header has no photograph selected, and a postcard is one
                photograph — so this button asks for one rather than pretending
                to have it. The lightbox's own control is the shorter path for
                somebody already looking at the picture they meant. */}
            {postcard && media.length > 0 && (
              <button
                onClick={() => setPicking((was) => !was)}
                aria-pressed={picking}
                className={`flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold transition-colors ${
                  picking
                    ? "border-yellow-600 bg-yellow-400 text-yellow-950"
                    : "border-navy-200 bg-white text-navy-700 hover:border-navy-500"
                }`}
              >
                <Send className="h-4 w-4" />
                {picking ? t("postcard.cancel") : t("postcard.start")}
              </button>
            )}
            {media.length > 0 && (
              <button
                onClick={() => setShowing(true)}
                className="flex min-h-11 shrink-0 items-center gap-1.5 rounded-full bg-navy-900 px-4 text-sm font-semibold text-white transition-colors hover:bg-navy-700"
              >
                <Clapperboard className="h-4 w-4" />
                {t("show.start")}
              </button>
            )}
          </div>
        </div>
        {picking && <p className="mt-3 text-sm text-navy-700">{t("postcard.pickHint")}</p>}
        <div className="mt-6">
          <GalleryGrid
            media={media}
            postcard={postcard}
            picking={picking}
            onPicked={() => setPicking(false)}
          />
        </div>
      </main>

      {showing && <SlideShow places={places} onClose={() => setShowing(false)} />}
    </div>
  );
}
