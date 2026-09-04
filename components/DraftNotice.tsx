"use client";

import { FileWarning } from "lucide-react";
import { useI18n } from "./LocaleProvider";

/**
 * The banner on a day only its owner can see.
 *
 * Loud on purpose. The failure this guards against is the author reading their
 * own site, seeing a day an agent wrote, and assuming their family has seen it
 * too — so it has to be impossible to mistake for part of the page.
 *
 * **It names the agent, not a file.** It used to print `status: draft` and tell
 * the reader to delete that line, which was true and useless: the person most
 * likely to be standing here is the owner of a journal an agent created, who
 * has never seen the folder and has no editor open. Publishing is a call the
 * agent makes now (B28, B223), so the next move this banner can honestly offer
 * is the one they already have — go back to the agent and say yes.
 *
 * Coral rather than yellow: yellow is the brand's own colour and reads as
 * decoration here, and `yellow-600` is 2.36:1 on cream, which is not a text
 * colour. See docs/branding/BRAND.md.
 */

export default function DraftNotice() {
  const { t } = useI18n();
  return (
    <div
      role="note"
      data-draft-notice
      className="mb-5 flex items-start gap-3 rounded-xl border-2 border-coral-600 bg-coral-300 px-4 py-3"
    >
      <FileWarning className="mt-0.5 h-5 w-5 shrink-0 text-navy-900" aria-hidden />
      <div className="min-w-0">
        <p className="font-display text-base font-semibold text-navy-900">{t("draft.title")}</p>
        <p className="mt-1 text-sm leading-6 text-navy-900">{t("draft.body")}</p>
      </div>
    </div>
  );
}
