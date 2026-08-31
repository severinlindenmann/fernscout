"use client";

import { FileWarning } from "lucide-react";
import { useI18n } from "./LocaleProvider";

/**
 * The banner on a day only its owner can see.
 *
 * Loud on purpose. The failure this guards against is the author reading their
 * own site, seeing a day an agent wrote, and assuming their family has seen it
 * too — so it has to be impossible to mistake for part of the page. It says
 * what to delete, because publishing is one line in one file and naming it is
 * cheaper than sending somebody to the documentation.
 *
 * Coral rather than yellow: yellow is the brand's own colour and reads as
 * decoration here, and `yellow-600` is 2.36:1 on cream, which is not a text
 * colour. See docs/branding/BRAND.md.
 */
/** The one line a person deletes to publish. */
const LINE = "status: draft";

export default function DraftNotice() {
  const { t } = useI18n();
  const [before, after] = t("draft.body").split("{line}");
  return (
    <div
      role="note"
      data-draft-notice
      className="mb-5 flex items-start gap-3 rounded-xl border-2 border-coral-600 bg-coral-300 px-4 py-3"
    >
      <FileWarning className="mt-0.5 h-5 w-5 shrink-0 text-navy-900" aria-hidden />
      <div className="min-w-0">
        <p className="font-display text-base font-semibold text-navy-900">{t("draft.title")}</p>
        <p className="mt-1 text-sm leading-6 text-navy-900">
          {/* The sentence names the line to delete, so the token is set in
              code where it falls rather than appended after the full stop. */}
          {before}
          <code className="rounded bg-white px-1.5 py-0.5 font-mono text-xs text-navy-900">
            {LINE}
          </code>
          {after}
        </p>
      </div>
    </div>
  );
}
