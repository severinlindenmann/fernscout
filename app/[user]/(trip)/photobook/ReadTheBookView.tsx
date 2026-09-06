"use client";

import { useEffect, useRef, useState } from "react";
import type { TranslationKey } from "@/lib/i18n";

/**
 * Whether the person reading has a keyboard — B561.
 *
 * A hint about the arrow keys is help on a laptop and noise on a phone, and
 * there is no way to ask directly. `(pointer: fine)` is the closest honest
 * proxy: a mouse or a trackpad almost always comes with a keyboard, a
 * touchscreen almost never does. Read after mounting rather than in the
 * initialiser, for the same reason the arrangement is: the server has no
 * `matchMedia` and a first render that disagrees with it is a hydration
 * mismatch.
 */
export function useHasKeyboard(): boolean {
  const [has, setHas] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHas(window.matchMedia("(pointer: fine)").matches);
  }, []);
  return has;
}

/**
 * The arrow keys turn the pages — B561.
 *
 * The book lives inside an iframe, so the keys cannot simply be left to the
 * browser: the document that scrolls is not the document with focus. The
 * frame is `srcDoc` and therefore same-origin, so the scroller is reachable
 * directly, and one spread is the step — the unit the book is actually read
 * in, and the one the CSS snap points already land on.
 *
 * `axis` is the whole difference between the two places the book is shown:
 * the composer's strip is swiped sideways, the reading view is scrolled down.
 * Both accept both pairs of keys, because a person pressing Down on a strip
 * means "the next one".
 */
export function useSpreadKeys(
  frame: React.RefObject<HTMLIFrameElement | null>,
  axis: "x" | "y",
  enabled: boolean,
) {
  useEffect(() => {
    if (!enabled) return;
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const forward = e.key === "ArrowRight" || e.key === "ArrowDown";
      const back = e.key === "ArrowLeft" || e.key === "ArrowUp";
      if (!forward && !back) return;
      const doc = frame.current?.contentDocument;
      const strip = doc?.querySelector<HTMLElement>(".spreads");
      const spread = doc?.querySelector<HTMLElement>(".spread");
      if (!strip || !spread) return;
      e.preventDefault();
      const box = spread.getBoundingClientRect();
      const step = (forward ? 1 : -1) * ((axis === "x" ? box.width : box.height) + 24);
      strip.scrollBy({ [axis === "x" ? "left" : "top"]: step, behavior: "smooth" });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [frame, axis, enabled]);
}

/**
 * Reading the finished book, before paying for it — B561.
 *
 * Until this existed the only view of the book was the composer's swipe
 * strip, and pressing Pay was therefore a leap: nobody had seen the thing end
 * to end. This is the deliberate step in between — the whole book, spread
 * after spread, at the size the screen allows, and an order button at the
 * bottom of it rather than a way back to a form.
 *
 * **Spreads, not single pages.** B514 established that a bound book is read
 * as facing pages and caught B518 (the route map sitting in the fold) the
 * same day. The column here is the same `.spread` grouping the strip uses.
 *
 * **The same HTML, one class different.** `readingHtml` adds `read` to the
 * preview document's body and `lib/photobook/preview.ts` unwraps the strip
 * into a column. No second request: the composer already holds this book, and
 * a second request shape for "the same book, laid out differently" is one
 * more thing to keep in step with the first.
 */
export default function ReadTheBookView({
  html,
  summary,
  onBack,
  onOrder,
  t,
}: {
  html: string;
  /** "32 pages · Square, 21 × 21 cm · glued spine" — what is being ordered. */
  summary: string | null;
  onBack: () => void;
  onOrder: () => void;
  t: (key: TranslationKey, vars?: Record<string, string>) => string;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const hasKeyboard = useHasKeyboard();
  useSpreadKeys(frame, "y", true);

  // Escape closes it, because this covers the page and there is no other way
  // out but the button.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onBack();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onBack]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t("photobook.read.heading")}
      className="fixed inset-0 z-50 flex flex-col bg-cream-50"
    >
      <div className="flex items-center gap-3 border-b border-navy-200 px-4 py-2">
        <button
          type="button"
          onClick={onBack}
          className="min-h-11 shrink-0 text-sm font-semibold text-navy-800 underline"
        >
          ← {t("photobook.read.back")}
        </button>
        <p className="truncate text-sm font-semibold text-navy-900">
          {t("photobook.read.heading")}
        </p>
      </div>

      {hasKeyboard && (
        <p className="px-4 py-1 text-xs text-navy-600">{t("photobook.composer.keyHint")}</p>
      )}

      <iframe
        ref={frame}
        srcDoc={html}
        className="min-h-0 w-full flex-1 border-0 bg-cream-100"
        title={t("photobook.read.heading")}
      />

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-navy-200 px-4 py-3">
        {summary && <p className="text-sm text-navy-700">{summary}</p>}
        <button
          type="button"
          onClick={onOrder}
          className="min-h-11 flex-1 rounded-full bg-navy-900 px-5 text-sm font-semibold text-white transition-colors hover:bg-navy-700 sm:flex-none"
        >
          {t("photobook.read.order")}
        </button>
      </div>
    </div>
  );
}
