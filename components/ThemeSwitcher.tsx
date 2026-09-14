"use client";

import { Check, Moon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "./LocaleProvider";
import {
  applyThemeChoice,
  THEME_CHOICES,
  THEME_STORAGE_KEY,
  themeChoice,
  type ThemeChoice,
} from "@/lib/theme";

/** The header-sized sibling of the full Appearance panel on `/me`. */
export default function ThemeSwitcher() {
  const { t } = useI18n();
  const [choice, setChoice] = useState<ThemeChoice>("auto");
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // Shaped like `ThemePicker`'s own read rather than a bare setState in the
    // effect body — which is both what the lint rule asks for and what keeps
    // the two in step. They are the same setting seen from two places: the
    // header here, the Appearance panel on `/me`. Listening for `storage`
    // means changing it in either one moves the other, and moves a second tab
    // too, instead of leaving a tick that disagrees with the page it is on.
    const read = () => {
      let next: ThemeChoice = "auto";
      try {
        next = themeChoice(window.localStorage.getItem(THEME_STORAGE_KEY));
      } catch {
        // Storage may be refused in private browsing. Automatic still works.
      }
      setChoice(next);
    };
    const storageChanged = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY || event.key === null) read();
    };
    read();
    window.addEventListener("storage", storageChanged);
    return () => window.removeEventListener("storage", storageChanged);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!wrapRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const labels = {
    auto: t("me.appearanceAuto"),
    light: t("me.appearanceLight"),
    dark: t("me.appearanceDark"),
  } as const;

  function choose(next: ThemeChoice) {
    try {
      if (next === "auto") window.localStorage.removeItem(THEME_STORAGE_KEY);
      else window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // The appearance still applies for this page when storage is refused.
    }
    applyThemeChoice(next);
    setChoice(next);
    setOpen(false);
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={t("me.appearanceTitle")}
        aria-haspopup="menu"
        aria-expanded={open}
        title={t("me.appearanceTitle")}
        className="flex min-h-11 items-center gap-1 rounded-full border border-transparent bg-transparent px-2.5 text-xs font-bold text-ink-secondary transition-colors hover:bg-surface-subtle hover:text-ink-strong"
      >
        <Moon className="h-3.5 w-3.5" aria-hidden />
        <span className="sr-only">{labels[choice]}</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-40 mt-1.5 min-w-[9rem] overflow-hidden rounded-xl border border-line-quiet bg-surface-raised py-1 shadow-lg"
        >
          {THEME_CHOICES.map((item) => (
            <button
              key={item}
              type="button"
              role="menuitemradio"
              aria-checked={choice === item}
              onClick={() => choose(item)}
              className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs transition-colors hover:bg-surface-base ${
                choice === item ? "font-semibold text-ink-strong" : "text-ink-secondary"
              }`}
            >
              {labels[item]}
              {choice === item && <Check className="h-4 w-4 text-selected-mark" aria-hidden />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
