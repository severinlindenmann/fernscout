"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Languages } from "lucide-react";
import { useRouter } from "next/navigation";
import { useI18n } from "./LocaleProvider";
import { useOptionalSite } from "./SiteProvider";
import { LOCALE_COOKIE } from "@/lib/requestKeys";
import { LOCALE_SHORT, LOCALE_LABEL, MAINTAINED_LOCALES } from "@/lib/i18n";

/** Compact language picker: one small chip that opens a menu, so the header
 * isn't three buttons wide on every page. */
/**
 * The language is rendered on the server now, so changing it has to reach the
 * server. A cookie does that; before this the choice lived in localStorage,
 * the server never saw it, and every page was served in English whatever the
 * reader had picked.
 */
function remember(locale: string) {
  const year = 60 * 60 * 24 * 365;
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${year}; samesite=lax`;
}

export default function LocaleSwitcher({
  locales: given,
  subtle = false,
}: { locales?: string[]; subtle?: boolean } = {}) {
  const { locale, t } = useI18n();
  // Inside a journal the languages are that journal's, in the order it lists
  // them. Outside one — the landing page — there is no journal to ask, so the
  // caller passes the set this build ships chrome for.
  const site = useOptionalSite();
  const locales = given ?? site?.locales ?? MAINTAINED_LOCALES;
  const router = useRouter();

  const choose = (next: string) => {
    remember(next);
    router.refresh();
  };
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrapRef} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-label={t("lang.label")}
        aria-haspopup="menu"
        aria-expanded={open}
        title={LOCALE_LABEL[locale]}
        // In the header the chip sits among other controls and is drawn like
        // them. On the landing page it is alone above the headline, where a
        // white pill on cream reads as the first thing on the page — which is
        // not what it is. So there it keeps the size and the hit area and
        // gives up the border and the fill until it is pointed at.
        className={`flex min-h-11 items-center gap-1 rounded-full border px-2.5 text-xs font-bold transition-colors ${
          subtle
            ? "border-transparent bg-transparent text-navy-600 hover:bg-cream-100 hover:text-navy-900"
            : "border-navy-200 bg-white text-navy-700 hover:border-navy-500"
        }`}
      >
        <Languages className="h-3.5 w-3.5" aria-hidden />
        {LOCALE_SHORT[locale]}
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-40 mt-1.5 min-w-[9rem] overflow-hidden rounded-xl border border-navy-200 bg-white py-1 shadow-lg"
        >
          {locales.map((l: string) => (
            <button
              key={l}
              role="menuitemradio"
              aria-checked={locale === l}
              onClick={() => {
                choose(l);
                setOpen(false);
              }}
              className={`flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs transition-colors hover:bg-cream-50 ${
                locale === l ? "font-semibold text-navy-900" : "text-navy-600"
              }`}
            >
              {LOCALE_LABEL[l]}
              {locale === l && <Check className="h-4 w-4 text-yellow-950" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
