"use client";

import { useEffect, useState } from "react";

/**
 * The floor under everything.
 *
 * Reached only when the root layout itself throws, which means no stylesheet,
 * no fonts and no `LocaleProvider` — this file replaces the whole document. So
 * it carries its own `<html>`, its own colours as inline styles taken from the
 * palette, and reads the stored language itself.
 *
 * The language is adopted after mount, exactly as `LocaleProvider` does it: on
 * a server-rendered failure this page is streamed from the server, where
 * `localStorage` does not exist, and guessing there would make the client
 * disagree with the HTML at the one moment nothing else is working either.
 */
const STORAGE_KEY = "fs.locale";

/**
 * This page renders when the root layout itself failed, so it can reach
 * neither LocaleProvider nor the content folder. Its handful of strings are
 * inline by necessity — a crash page that crashes looking up a translation is
 * worse than one that is only in three languages.
 */
const STRINGS: Record<string, Record<string, string>> = {
  en: {
    "err.crashTitle": "Something went wrong",
    "err.crashBody": "The page could not be shown. Reloading usually fixes it.",
    "err.retry": "Try again",
    "err.reference": "Reference: {id}",
  },
  de: {
    "err.crashTitle": "Etwas ist schiefgelaufen",
    "err.crashBody": "Die Seite konnte nicht angezeigt werden. Neu laden hilft meistens.",
    "err.retry": "Nochmal versuchen",
    "err.reference": "Referenz: {id}",
  },
  hu: {
    "err.crashTitle": "Valami elromlott",
    "err.crashBody": "Az oldalt nem sikerült megjeleníteni. Az újratöltés általában segít.",
    "err.retry": "Újra",
    "err.reference": "Hivatkozás: {id}",
  },
};

function say(locale: string, key: string, vars?: Record<string, string>): string {
  const raw = (STRINGS[locale] ?? STRINGS.en)[key] ?? STRINGS.en[key] ?? key;
  return vars ? raw.replace(/\{(\w+)\}/g, (m, n: string) => vars[n] ?? m) : raw;
}

export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  const [locale, setLocale] = useState<string>("en");

  useEffect(() => {
    console.error("[fernscout] root layout failed", error);
    // Only the languages this page carries strings for, since there is no
    // dictionary to load here.
    const known = Object.keys(STRINGS);
    const stored = window.localStorage.getItem(STORAGE_KEY);
    const nav = navigator.language.slice(0, 2).toLowerCase();
    const next = stored && known.includes(stored) ? stored : known.includes(nav) ? nav : null;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (next && next !== "en") setLocale(next);
  }, [error]);

  return (
    <html lang={locale}>
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          background: "#fffaf0",
          color: "#1e293b",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
        }}
      >
        <main style={{ maxWidth: "36rem", margin: "0 auto", padding: "5rem 1.5rem" }}>
          <h1 style={{ fontSize: "2rem", lineHeight: 1.2, margin: 0, fontWeight: 600 }}>
            {say(locale, "err.crashTitle")}
          </h1>
          <p style={{ marginTop: "1.25rem", fontSize: "1.25rem", lineHeight: 1.6, color: "#3a4a63" }}>
            {say(locale, "err.crashBody")}
          </p>
          <button
            type="button"
            onClick={() => retry()}
            style={{
              marginTop: "2.25rem",
              minHeight: "3rem",
              padding: "0 1.5rem",
              borderRadius: "9999px",
              border: "none",
              background: "#ffd23f",
              color: "#4a3300",
              fontSize: "1.125rem",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {say(locale, "err.retry")}
          </button>
          {error.digest && (
            <p style={{ marginTop: "2rem", fontSize: "0.875rem", color: "#44546c" }}>
              {say(locale, "err.reference", { id: error.digest })}
            </p>
          )}
        </main>
      </body>
    </html>
  );
}
