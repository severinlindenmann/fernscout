"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "./LocaleProvider";

/**
 * A long day, cut — B2570. The owner asked for long text to be cut rather
 * than to push the map, the reactions and the next day a screen further
 * down. About eight lines show, faded at the bottom, and one button brings
 * the rest; text that fits, or nearly does, is left alone. Measured
 * rather than guessed from a character count, because a line's length is
 * the reader's screen, not the writer's words.
 */
/** Height in rem past which a day's text is cut: 1.5 times the 13.5rem cap. */
const CUT_AT = 20.25;

export default function CutProse({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const [whole, setWhole] = useState(false);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || whole) return;
    // Cut only what is worth cutting: a text a line or two past the cap
    // would lose three words behind a button, which is worse than showing
    // them. Past half as much again (`CUT_AT`), it is cut. The cap is applied
    // only once the text is cut, so the height measured here is always the
    // text's own and nothing between the cap and `CUT_AT` is hidden unread.
    const measure = () => {
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      setOverflows(el.scrollHeight > CUT_AT * rem);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    // A cut box keeps its height as the text inside it changes, so watch the
    // text itself too.
    for (const child of Array.from(el.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [whole]);

  const cut = !whole && overflows;
  const fade = "linear-gradient(to bottom, black 65%, transparent)";
  return (
    <div className="mt-5">
      <div
        ref={ref}
        className={cut ? "max-h-[13.5rem] overflow-hidden" : undefined}
        style={cut ? { maskImage: fade, WebkitMaskImage: fade } : undefined}
      >
        {children}
      </div>
      {cut && (
        <button
          type="button"
          onClick={() => setWhole(true)}
          className="mt-1 min-h-11 text-sm font-semibold text-ink-strong underline decoration-blue-500 decoration-2 underline-offset-4 hover:decoration-coral-600"
        >
          {t("day.readWhole")}
        </button>
      )}
    </div>
  );
}
