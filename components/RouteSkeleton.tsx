"use client";

import PageHeader from "./PageHeader";
import { useI18n } from "./LocaleProvider";

/**
 * What a reading page shows while its body is still on the way.
 *
 * There is deliberately no `loading.tsx` under a journal, for two reasons.
 * A route fallback replaces the whole page, and each page draws its own
 * header, so every tap would blank the header (components/NavProgress.tsx).
 * And a `loading.tsx` wraps the page from *above*: a page that answers
 * `notFound()` or `redirect()` for itself — a draft day's permalink, a trip
 * that has since become current — would then throw it after the `200` had
 * already been sent, a soft 404 in place of a real one. Measured, not
 * assumed: with one at `trips/[trip]/`, a day slug that does not exist and
 * the weather page of a trip with no weather both came back `200`.
 *
 * So the heavy reading pages split themselves instead. The page decides
 * everything that changes the answer — the 404, the redirect, the gate — and
 * only then puts the part that just takes time inside a `RouteBoundary`
 * (components/RouteBoundary.tsx), with this as its fallback. On a client-side
 * navigation the router can then draw this as soon as the first bytes of the
 * answer arrive, rather than after the whole payload — the part that grows
 * with the trip — has come down a slow connection. A document load never sees
 * it: `RouteBoundary` draws no boundary there, and RouteBoundary.tsx says why.
 *
 * **The header is the real one.** It reads the journal, the trip and the
 * language from the providers the layout and the page have already mounted
 * outside the boundary, so it is already the right header and does not move
 * when the page arrives. Only the body below it is a placeholder.
 *
 * **Nothing about the reader is in here.** It takes a shape and nothing else:
 * whatever the reader may or may not see is decided by the page, above the
 * boundary, before this is ever rendered — and it is only rendered to a
 * reader the page has already let in.
 *
 * The blocks borrow the `.fs-photo[data-loading]` shimmer (app/globals.css)
 * that a photograph's frame shows while it arrives, and rest still under
 * reduced motion like it does.
 */
export default function RouteSkeleton({ shape }: { shape: "story" | "day" | "map" | "list" }) {
  const { t } = useI18n();
  const block = "fs-photo block rounded-2xl bg-surface-selected";
  const line = "h-4 rounded bg-surface-selected motion-safe:animate-pulse";
  return (
    // `min-h-screen` keeps whatever the layout draws after the page (the
    // notification offer, the showcase bar) below the fold until the page is
    // there, so its arrival pushes nothing the reader is looking at.
    <div className="flex min-h-screen flex-col" data-route-skeleton={shape}>
      <PageHeader>
        {/* The story's header carries its day counter here (app/TripStory.tsx),
            and on a wide screen that box is what makes the nav wrap onto a
            second row in the longer languages. Holding its width keeps the
            header the height the story will give it. */}
        {(shape === "story" || shape === "day") && <div aria-hidden className="hidden w-36 xl:block" />}
      </PageHeader>
      <main id="main" tabIndex={-1} aria-busy className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
        <p role="status" className="sr-only">
          {t("nav.pageLoading")}
        </p>
        <div aria-hidden>
          {shape === "map" ? (
            <span data-loading className={`${block} h-[60vh] min-h-72`} />
          ) : shape === "list" ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <span key={i} data-loading className={`${block} h-56`} />
              ))}
            </div>
          ) : (
            <>
              {shape === "story" && <span data-loading className={`${block} mb-6 h-56 sm:h-72`} />}
              <div className="rounded-2xl border border-line-quiet bg-surface-raised p-5 shadow-sm sm:p-7">
                <div className={`${line} mb-6 w-1/3`} />
                <div className="space-y-3">
                  <div className={`${line} w-3/4`} />
                  <div className={`${line} w-full`} />
                  <div className={`${line} w-5/6`} />
                </div>
                {shape === "day" && <span data-loading className={`${block} mt-6 h-64`} />}
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
