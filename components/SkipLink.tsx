"use client";

import { useI18n } from "./LocaleProvider";

/** First thing in the tab order: jumps past the header, the day bar and the
 * path sidebar, which is otherwise a long walk to reach the day itself.
 * A client component only because the label is translated. */
export default function SkipLink() {
  const { t } = useI18n();
  return (
    <a
      href="#main"
      className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-3 focus:z-50 focus:rounded-full focus:bg-navy-900 focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
    >
      {t("a11y.skipToContent")}
    </a>
  );
}
