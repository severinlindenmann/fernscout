"use client";

import { useCallback, useEffect, useRef, useState } from "react";
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
 * directly, and one stop is the step — the unit the book is actually read in,
 * and the one the CSS snap points already land on. Which is a spread on the
 * strip and, since B1421, a single page in the reading view on a phone.
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
  /** Escape, where there is something to escape from. */
  onEscape?: () => void,
) {
  useEffect(() => {
    if (!enabled) return;
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape" && onEscape) {
        e.preventDefault();
        onEscape();
        return;
      }
      const forward = e.key === "ArrowRight" || e.key === "ArrowDown";
      const back = e.key === "ArrowLeft" || e.key === "ArrowUp";
      if (!forward && !back) return;
      const doc = frame.current?.contentDocument;
      const strip = doc?.querySelector<HTMLElement>(".spreads");
      /**
       * Which way this strip actually runs, and what is carrying the scroll
       * — B1524.
       *
       * `axis` says what the *view* is for, and the composer's is a sideways
       * strip only below 620px of frame: above it B1486 wraps the spreads
       * into a grid that flows down the page, so the keys were pushing an
       * element with nothing to scroll in either direction. Both questions
       * are asked of the document rather than of a media query, so the CSS
       * and the keys cannot disagree about which view is on screen.
       */
      const horizontal = !!strip && strip.scrollWidth > strip.clientWidth + 1;
      const along: "x" | "y" = axis === "x" && !horizontal ? "y" : axis;
      // The step is one stop, and on a phone a stop is one page (B1421) —
      // where the spread is `display:contents` and has no box at all, so
      // measuring it would step the book 24px. A page is exactly as tall as
      // the spread holding it, so on the y axis this is the same number it
      // was measuring before and nothing changes on a wide screen. The strip
      // keeps the spread, which is what it snaps to.
      const stop = doc?.querySelector<HTMLElement>(axis === "y" ? ".page" : ".spread");
      if (!strip || !stop || !doc) return;
      // The wrapped grid is as tall as its content, so it is the document
      // that scrolls there and not the strip.
      const scroller =
        horizontal || strip.scrollHeight > strip.clientHeight + 1
          ? strip
          : (doc.scrollingElement as HTMLElement | null) ?? strip;
      e.preventDefault();
      const box = stop.getBoundingClientRect();
      const step = (forward ? 1 : -1) * ((along === "x" ? box.width : box.height) + 24);
      scroller.scrollBy({ [along === "x" ? "left" : "top"]: step, behavior: "smooth" });
    }

    // Listened for in *both* documents. A keydown inside an iframe does not
    // reach the parent window, so a reader who has tabbed or clicked into the
    // book — which is exactly what somebody reading it does — would otherwise
    // find the arrow keys dead and Escape with nothing listening. The frame
    // is `srcDoc` and therefore same-origin, and it gets a new document every
    // time the preview is re-fetched, hence the `load` handler as well.
    const el = frame.current;
    const attach = () => el?.contentDocument?.addEventListener("keydown", onKey);
    window.addEventListener("keydown", onKey);
    el?.addEventListener("load", attach);
    attach();
    return () => {
      window.removeEventListener("keydown", onKey);
      el?.removeEventListener("load", attach);
      el?.contentDocument?.removeEventListener("keydown", onKey);
    };
  }, [frame, axis, enabled, onEscape]);
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

  /**
   * A real modal, because this one covers a Pay button.
   *
   * `showModal()` is the platform's own answer to everything a hand-rolled
   * overlay has to reimplement: the rest of the page goes inert, so a
   * keyboard reader cannot tab out of the book into controls they cannot see
   * — and one of those controls spends money. Escape closes it, and focus
   * goes back to whatever opened it, both for free.
   *
   * Every way out goes through `close()` rather than straight to the
   * callback, so the focus restore happens before this unmounts. The reason
   * rides on `returnValue`, which is what a `<dialog>` has instead of an
   * argument.
   */
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  // Escape is handled here rather than left to the dialog's own `cancel`, for
  // the reason above: with focus inside the book, the browser's Escape never
  // reaches this document.
  const dismiss = useCallback(() => dialog.current?.close("back"), []);
  useSpreadKeys(frame, "y", true, dismiss);

  return (
    <dialog
      ref={dialog}
      aria-label={t("photobook.read.heading")}
      onClose={() => (dialog.current?.returnValue === "order" ? onOrder() : onBack())}
      className="fixed inset-0 z-50 m-0 flex h-full max-h-none w-full max-w-none flex-col border-0 bg-cream-50 p-0 backdrop:bg-navy-900/40"
    >
      <div className="flex items-center gap-3 border-b border-navy-200 px-4 py-2">
        <button
          type="button"
          onClick={dismiss}
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
          onClick={() => dialog.current?.close("order")}
          className="min-h-11 flex-1 rounded-full bg-navy-900 px-5 text-sm font-semibold text-white transition-colors hover:bg-navy-700 sm:flex-none"
        >
          {t("photobook.read.order")}
        </button>
      </div>
    </dialog>
  );
}
