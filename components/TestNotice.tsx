"use client";

import { FlaskConical } from "lucide-react";
import { useI18n } from "./LocaleProvider";

/**
 * The banner on content nobody lived.
 *
 * An operator proving that signup, a journal, a trip, a day and its
 * photographs still work end to end has to write a day that did not happen.
 * The guide otherwise forbids inventing anything, and until `test: true`
 * existed an agent asked to do it had only its own prose to warn anybody —
 * "this is invented test content" in the first paragraph, which is a
 * convention rather than a guarantee and which reads as part of the day.
 *
 * So this is deliberately not part of the day. Unlike the draft banner, which
 * is only ever seen by the author, **this one is shown to everybody**: a test
 * day is reachable by its URL, and the person who reaches it may not be the
 * person who made it. It is kept out of the feed, the search index and the
 * sitemap — see `isIndexable` — so arriving here means following a link.
 *
 * Coral, like the draft notice, and for the same reason: yellow is the brand's
 * own colour and reads as decoration. See docs/branding/BRAND.md.
 */
export default function TestNotice() {
  const { t } = useI18n();
  return (
    <div
      role="note"
      data-test-notice
      className="mb-5 flex items-start gap-3 rounded-xl border-2 border-coral-600 bg-coral-300 px-4 py-3"
    >
      <FlaskConical className="mt-0.5 h-5 w-5 shrink-0 text-navy-900" aria-hidden />
      <div className="min-w-0">
        <p className="font-display text-base font-semibold text-navy-900">{t("test.title")}</p>
        <p className="mt-1 text-sm leading-6 text-navy-900">{t("test.body")}</p>
      </div>
    </div>
  );
}
