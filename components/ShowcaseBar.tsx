"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { X } from "lucide-react";
import { useI18n } from "./LocaleProvider";
import { useEngagement } from "./useEngagement";

/**
 * The way out of a journal that exists to be looked at — B1718.
 *
 * `/example` is the one page on the instance whose whole job is to convince
 * somebody, and it had no door. A reader followed the landing page in, read a
 * trip, reached the end and had to go back to the front page by hand.
 *
 * ## Why it is not a popup
 *
 * It rises from the foot of the page and never covers what is being read.
 * The demo has to keep reading like somebody's actual trip, because that is
 * the argument — an overlay across a stranger's holiday would be the one part
 * of this site behaving like the things it competes with. Same register as
 * `PushPrompt`, which sits in the same corner for the same reasons, and the
 * same engagement rule: it appears only once the reader has actually read
 * something (`useEngagement`).
 *
 * ## Why there is a variable instead of a fixed offset
 *
 * Two fixed things at the bottom of one page is how they end up on top of
 * each other. This one is the full-width band underneath, so it publishes its
 * own measured height as `--fs-showcase-bar` on the document element, and
 * `app/globals.css` spends it twice: `PushPrompt` sits above the bar rather
 * than behind it, and `body` gains the same padding so the last line of a day
 * is never hidden under it. Unset — which is every journal that is not a
 * showcase, and every reader who has closed this — the variable falls back to
 * `0px` and nothing moves.
 *
 * ## Who sees it
 *
 * Only a journal the **operator** named in `site.showcase`; the layout
 * decides and this component is not rendered at all otherwise. Never a field
 * in a journal's own `config.json`, which its owner can write over the API:
 * that would let one person put an advertisement over another's photographs.
 *
 * Closing it is remembered for that browser, forever. A thing that cannot be
 * dismissed is the pattern this product refuses everywhere else, and a reader
 * who has said no once has said it.
 */

/** One key for the whole instance, not one per journal: a reader who has
 *  closed this has answered the question, and asking again from the next
 *  showcase journal would be the nagging this is written to avoid. */
const CLOSED_KEY = "fs.showcase.closed";

export default function ShowcaseBar() {
  const { t } = useI18n();
  const engaged = useEngagement();
  const [closed, setClosed] = useState(true);
  const bar = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Starts closed and opens once the browser has been asked, so a reader
    // who dismissed it last week never sees a frame of it on this load.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setClosed(window.localStorage.getItem(CLOSED_KEY) === "1");
  }, []);

  const shown = engaged && !closed;

  // Measured rather than assumed: the sentence wraps to two lines on a phone
  // and to one on a desktop, so a hardcoded height would either leave a gap
  // or let the bar cover a line of somebody's day.
  useLayoutEffect(() => {
    const root = document.documentElement;
    if (!shown) {
      root.style.removeProperty("--fs-showcase-bar");
      return;
    }
    const publish = () => {
      const height = bar.current?.offsetHeight;
      if (height) root.style.setProperty("--fs-showcase-bar", `${height}px`);
    };
    publish();
    window.addEventListener("resize", publish);
    return () => {
      window.removeEventListener("resize", publish);
      root.style.removeProperty("--fs-showcase-bar");
    };
  }, [shown]);

  const close = useCallback(() => {
    window.localStorage.setItem(CLOSED_KEY, "1");
    setClosed(true);
  }, []);

  if (!shown) return null;

  return (
    <div
      ref={bar}
      role="region"
      aria-label={t("showcase.title")}
      /* `fs-rise-in` is a plain keyframe in globals.css, off under
         `prefers-reduced-motion` like every other animation here — the bar
         still appears, it simply stops sliding. */
      className="fs-rise-in fixed inset-x-0 bottom-0 z-30 border-t border-line-strong bg-surface-raised
                 px-4 py-3 shadow-[0_-8px_24px_-20px_rgba(0,0,0,0.6)]"
    >
      <div className="relative mx-auto flex max-w-3xl flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
        {/* The close button is positioned rather than in the flow: on a phone
            the bar stacks, and a third column beside two full-width buttons
            would squeeze both. `pr-8` is the room it sits in. */}
        <button
          type="button"
          onClick={close}
          aria-label={t("showcase.close")}
          className="absolute -top-1 right-0 rounded-full p-1 text-ink-faint transition-colors
                     hover:text-ink-body sm:static sm:order-3 sm:-mr-1
                     focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
        <div className="min-w-0 flex-1 pr-8 sm:pr-0">
          <p className="text-sm font-semibold text-ink-strong">{t("showcase.title")}</p>
          <p className="mt-0.5 text-sm leading-6 text-ink-secondary">{t("showcase.body")}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2 sm:order-2">
          <Link
            href="/agent"
            className="inline-flex min-h-11 flex-1 items-center justify-center rounded-xl border border-yellow-600
                       bg-yellow-400 px-4 text-sm font-semibold text-yellow-950 transition-colors
                       hover:bg-yellow-300 sm:flex-none
                       focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
          >
            {t("showcase.cta")}
          </Link>
          <Link
            href="/"
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-line-quiet px-3
                       text-sm font-semibold text-ink-body transition-colors hover:border-line-prominent
                       focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
          >
            {t("showcase.how")}
          </Link>
        </div>
      </div>
    </div>
  );
}
