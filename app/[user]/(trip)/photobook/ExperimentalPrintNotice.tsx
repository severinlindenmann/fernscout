"use client";

import { FlaskConical } from "lucide-react";
import { useI18n } from "@/components/LocaleProvider";

/**
 * Nobody has seen a Fernscout photobook actually printed except in one
 * size and cover — B1368. Every other combination in `lib/photobook/spec.ts`
 * is unverified against what Gelato actually delivers, and nothing on the
 * photobook pages said so before this.
 *
 * Same visual register as `TestNotice` (coral, not the brand's own yellow,
 * for the same reason: this has to read as a warning rather than
 * decoration) and shown twice — once before setup begins, once beside the
 * price, right before the credits are spent.
 */
export default function ExperimentalPrintNotice() {
  const { t } = useI18n();
  return (
    <div
      role="note"
      className="mb-5 flex items-start gap-3 rounded-xl border-2 border-coral-600 bg-coral-300 px-4 py-3"
    >
      <FlaskConical className="mt-0.5 h-5 w-5 shrink-0 text-navy-900" aria-hidden />
      <p className="min-w-0 text-sm leading-6 text-navy-900">
        {t("photobook.experimentalPrint")}
      </p>
    </div>
  );
}
