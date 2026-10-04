"use client";

import { useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import ConfirmPanel from "@/components/ConfirmPanel";
import { useI18n } from "@/components/LocaleProvider";
import { mediaLoader } from "@/components/mediaLoader";
import { useSite } from "@/components/SiteProvider";
import VisitedSheet from "@/components/VisitedSheet";
import { flagFromCode } from "@/lib/flags";
import { entryWhen, type VisitedCardData } from "@/lib/visitedCards";

/**
 * What tapping a country without a trip opens — the map pin or its card
 * (B2914). Says plainly that no trip is recorded, then shows what the owner
 * wrote, as written. Edit and Remove appear for the owner only; Remove asks
 * first, in the page, with a button that names what it does.
 */
export default function VisitedPreview({
  entry,
  owner,
  onEdit,
  onClose,
}: {
  entry: VisitedCardData;
  owner: boolean;
  onEdit: () => void;
  onClose: () => void;
}) {
  const { t, locale } = useI18n();
  const { username } = useSite();
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const meta = [entry.places, entryWhen(entry, locale)].filter(Boolean).join(" · ");

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/web/${encodeURIComponent(username)}/visited/${encodeURIComponent(entry.code)}`,
        { method: "DELETE" },
      );
      if (!res.ok) throw new Error(String(res.status));
      router.refresh();
      onClose();
    } catch {
      setError(t("visited.errorGeneric"));
      setBusy(false);
    }
  }

  return (
    <VisitedSheet title={`${flagFromCode(entry.code)} ${entry.name}`} onClose={onClose}>
      {entry.photo && (
        <div className="relative h-56 w-full bg-surface-muted sm:h-64">
          <Image
            src={entry.photo}
            loader={mediaLoader}
            alt={entry.name}
            fill
            sizes="(min-width: 640px) 32rem, 100vw"
            className="object-cover"
          />
        </div>
      )}
      <div className="space-y-3 px-5 py-4">
        {meta && <p className="text-sm text-ink-secondary">{meta}</p>}
        <p className="text-sm leading-6 text-ink-body">{t("visited.previewLine", { country: entry.name })}</p>
        {entry.note && <p className="whitespace-pre-wrap text-base leading-7 text-ink-strong">{entry.note}</p>}
        {owner &&
          (confirming ? (
            <ConfirmPanel
              label={t("visited.remove")}
              question={t("visited.removeQuestion", { country: entry.name })}
              confirmLabel={t("visited.removeConfirm", { country: entry.name })}
              busyLabel={t("visited.removing")}
              busy={busy}
              error={error ?? undefined}
              tone="destructive"
              onConfirm={() => void remove()}
              onCancel={() => setConfirming(false)}
            />
          ) : (
            <div className="flex flex-wrap gap-2 pt-1">
              <button
                type="button"
                onClick={onEdit}
                className="min-h-11 rounded-full bg-ink-strong px-5 text-base font-semibold text-surface-raised"
              >
                {t("visited.edit")}
              </button>
              <button
                type="button"
                onClick={() => setConfirming(true)}
                className="min-h-11 rounded-full border border-line-strong px-5 text-base font-semibold text-ink-body hover:bg-surface-subtle"
              >
                {t("visited.remove")}
              </button>
            </div>
          ))}
      </div>
    </VisitedSheet>
  );
}
