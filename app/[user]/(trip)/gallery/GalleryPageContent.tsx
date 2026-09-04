"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { Clapperboard } from "lucide-react";
import PageHeader from "@/components/PageHeader";
import GalleryGrid from "@/components/GalleryGrid";
import type { PlaceView } from "@/components/WorldMap";
import type { MediaTile } from "@/lib/types";
import { useI18n } from "@/components/LocaleProvider";

// Behind a button — nobody should pay to download the presentation bundle
// (map projection data, motion) until they actually press it.
const SlideShow = dynamic(() => import("@/components/SlideShow"), { ssr: false });

export default function GalleryPageContent({
  media,
  places,
}: {
  media: MediaTile[];
  places: PlaceView[];
}) {
  const { t } = useI18n();
  const [showing, setShowing] = useState(false);
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
        <div className="mt-6">
          <GalleryGrid media={media} />
        </div>
      </main>

      {showing && <SlideShow places={places} onClose={() => setShowing(false)} />}
    </div>
  );
}
