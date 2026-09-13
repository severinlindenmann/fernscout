"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/components/LocaleProvider";
import {
  applyThemeChoice,
  THEME_CHOICES,
  THEME_STORAGE_KEY,
  themeChoice,
  type ThemeChoice,
} from "@/lib/theme";

const DARK_QUERY = "(prefers-color-scheme: dark)";

/** A reader/device setting. Nothing here calls the server or changes a journal. */
export default function ThemePicker() {
  const { t } = useI18n();
  const [choice, setChoice] = useState<ThemeChoice>("auto");
  const [systemDark, setSystemDark] = useState(false);

  useEffect(() => {
    const media = window.matchMedia(DARK_QUERY);
    const read = () => {
      let next: ThemeChoice = "auto";
      try {
        next = themeChoice(window.localStorage.getItem(THEME_STORAGE_KEY));
      } catch {
        // Storage may be refused in private browsing. Automatic still works.
      }
      setChoice(next);
      setSystemDark(media.matches);
      applyThemeChoice(next);
    };
    const systemChanged = () => setSystemDark(media.matches);
    const storageChanged = (event: StorageEvent) => {
      if (event.key === THEME_STORAGE_KEY || event.key === null) read();
    };
    read();
    media.addEventListener("change", systemChanged);
    window.addEventListener("storage", storageChanged);
    return () => {
      media.removeEventListener("change", systemChanged);
      window.removeEventListener("storage", storageChanged);
    };
  }, []);

  function choose(next: ThemeChoice) {
    try {
      if (next === "auto") window.localStorage.removeItem(THEME_STORAGE_KEY);
      else window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // The choice still applies for this page even when it cannot persist.
    }
    applyThemeChoice(next);
    setChoice(next);
  }

  const labels = {
    auto: t("me.appearanceAuto"),
    light: t("me.appearanceLight"),
    dark: t("me.appearanceDark"),
  } as const;

  return (
    <section className="mt-6 rounded-2xl border border-line-quiet bg-surface-raised p-5 sm:p-6">
      <h2 className="font-display text-xl font-semibold text-ink-strong">
        {t("me.appearanceTitle")}
      </h2>
      <p className="mt-1.5 text-base leading-7 text-ink-secondary">
        {t("me.appearanceLede")}
      </p>
      <fieldset className="mt-4">
        <legend className="sr-only">{t("me.appearanceTitle")}</legend>
        <div className="grid grid-cols-3 gap-2">
          {THEME_CHOICES.map((item) => (
            <label
              key={item}
              className={`flex min-h-11 cursor-pointer items-center justify-center rounded-full border px-3 text-sm font-semibold transition-colors focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-blue-500 ${
                choice === item
                  ? "border-action-strong bg-action-strong text-on-action"
                  : "border-line-strong bg-surface-raised text-ink-body hover:bg-surface-subtle"
              }`}
            >
              <input
                className="sr-only"
                type="radio"
                name="appearance"
                value={item}
                checked={choice === item}
                onChange={() => choose(item)}
              />
              {labels[item]}
            </label>
          ))}
        </div>
      </fieldset>
      {choice === "auto" && (
        <p className="mt-2 text-sm text-ink-muted" role="status">
          {t("me.appearanceResolved", {
            appearance: systemDark ? labels.dark : labels.light,
          })}
        </p>
      )}
    </section>
  );
}
