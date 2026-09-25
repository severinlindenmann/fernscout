"use client";

import { useState } from "react";
import ConfirmPanel from "@/components/ConfirmPanel";
import { useI18n } from "@/components/LocaleProvider";
import type { TranslationKey } from "@/lib/i18n";

export type DeletableDay = { tripId: string; slug: string; title: string; published: boolean };

/**
 * The question before a day is deleted — B2259. A shared day names what
 * happens to it (taken down first, readers keep what they saw) and sends
 * `takeDown: true`; the server refuses a shared day without it, so this panel
 * can never take down a day it presented as a draft.
 */
export function DeleteDayConfirm({
  username,
  day,
  onDone,
  onCancel,
}: {
  username: string;
  day: DeletableDay;
  onDone: () => void;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  // A photobook draft uses the day's photographs: said in the question, and
  // the next press carries the owner's acknowledgement.
  const [draftGaps, setDraftGaps] = useState(false);

  async function remove() {
    setBusy(true);
    setError(undefined);
    const url = `/api/web/${encodeURIComponent(username)}/trips/${encodeURIComponent(day.tripId)}/days/${encodeURIComponent(day.slug)}`;
    const response = await fetch(url, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...(day.published ? { takeDown: true } : {}), ...(draftGaps ? { acceptPhotobookGaps: true } : {}) }),
    }).catch(() => null);
    setBusy(false);
    if (response?.ok) return onDone();
    const code = ((await response?.json().catch(() => null)) as { error?: string } | null)?.error;
    if (code === "photobook_draft_uses_day") return setDraftGaps(true);
    const known: Record<string, TranslationKey> = {
      used_by_postcard: "studio.delete.postcard",
      used_by_photobook_order: "studio.delete.photobookOrder",
      media_shared: "studio.delete.shared",
    };
    setError(t(known[code ?? ""] ?? "studio.delete.failed"));
  }

  return (
    <ConfirmPanel
      label={t("studio.delete.label")}
      question={t(day.published ? "studio.delete.questionShared" : "studio.delete.questionDraft", { title: day.title })}
      confirmLabel={t(day.published ? "studio.delete.confirmShared" : "studio.delete.confirmDraft")}
      busyLabel={t("studio.delete.busy")}
      tone="destructive"
      busy={busy}
      error={error}
      onConfirm={() => void remove()}
      onCancel={onCancel}
    >
      {draftGaps && (
        <p data-photobook-gaps className="mt-2 text-sm font-semibold leading-6 text-ink-strong">
          {t("studio.delete.photobookDraft")}
        </p>
      )}
    </ConfirmPanel>
  );
}

/** "Delete…" and its question, for one day — "Change a day" and the day's
 *  own page. `onDone` is the caller's done screen; without one, the line
 *  that says where the day went takes the button's place. */
export default function DeleteDay({ username, day, onDone }: { username: string; day: DeletableDay; onDone?: () => void }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <p role="status" className="mt-3 text-sm text-ink-body">
        {t("studio.delete.done", { title: day.title })}{" "}
        <a href={`/${encodeURIComponent(username)}/studio/day/deleted`} className="font-semibold underline underline-offset-2">
          {t("studio.deleted.title")}
        </a>
      </p>
    );
  }
  if (open) {
    return (
      <div className="mt-3">
        <DeleteDayConfirm
          username={username}
          day={day}
          onDone={() => (onDone ? onDone() : setDone(true))}
          onCancel={() => setOpen(false)}
        />
      </div>
    );
  }
  return (
    <button
      type="button"
      data-delete-day
      onClick={() => setOpen(true)}
      className="mt-3 min-h-11 text-sm font-semibold text-coral-600 underline underline-offset-2 hover:opacity-75"
    >
      {t("studio.delete.button")}
    </button>
  );
}
