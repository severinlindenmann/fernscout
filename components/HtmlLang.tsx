"use client";

import { useEffect } from "react";

/**
 * Corrects `<html lang>` for a journal whose language differs from the
 * instance default.
 *
 * The root layout owns the `<html>` element and cannot know whose journal is
 * being read, so it renders the instance's language. On a single-journal
 * instance — the common case — that is already right and this does nothing.
 * Where a second journal is in another language, this fixes the attribute
 * after hydration.
 *
 * The complete fix is the locale in the URL, which would let the document
 * element be rendered with the right language server-side. That is the
 * remaining half of W04.
 */
export default function HtmlLang({ locale }: { locale: string }) {
  useEffect(() => {
    if (document.documentElement.lang !== locale) {
      document.documentElement.lang = locale;
    }
  }, [locale]);
  return null;
}
