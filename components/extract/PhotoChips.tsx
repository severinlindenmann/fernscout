"use client";

import { useState } from "react";
import PhotoTile, { thumbSrc } from "@/components/extract/PhotoTile";
import PhotoViewer from "@/components/extract/PhotoViewer";
import { useI18n } from "@/components/LocaleProvider";
import type { PhotoRow } from "@/lib/staging/manifest";

/**
 * One photograph's editable fields, as chips — B1751, Task 2.3.
 *
 * Three fields, three states each:
 *
 *  - **date** is required — clustering guessed it from EXIF or the person
 *    answered a "when" question for an undated group, and `known`/`missing`
 *    is the whole of it.
 *  - **caption** and **visibility** are never required — `optional` rather
 *    than `missing` when empty, so an untouched photograph does not read as
 *    broken.
 *
 * Each chip opens its own small editor rather than a shared form: a person
 * fixing one wrong caption should not also see a date field they have no
 * reason to touch.
 *
 * **The photograph itself, beside its chips — B1803 Task 1.3.** Editing a
 * caption for a picture you cannot see is the bug this whole batch of work
 * exists to fix, in miniature: a thumbnail sits to the left of every chip
 * row, visible the whole time the fields are being edited, and opens the
 * shared viewer on tap so a person can tell two similar photographs apart
 * before writing which one this caption is about.
 */
type Field = "date" | "caption" | "visibility";
type ChipState = "known" | "optional" | "missing";

function stateFor(field: Field, photo: PhotoRow): ChipState {
  if (field === "date") return photo.date ? "known" : "missing";
  if (field === "caption") return photo.caption ? "known" : "optional";
  return photo.visibility ? "known" : "optional";
}

const STATE_CLASS: Record<ChipState, string> = {
  known: "border-line-strong bg-surface-subtle text-ink-strong",
  optional: "border-line-faint text-ink-secondary",
  missing: "border-coral-400 bg-coral-300/20 text-coral-600",
};

export default function PhotoChips({
  username,
  runId,
  photo,
  onSave,
}: {
  username: string;
  runId: string;
  photo: PhotoRow;
  /** Called with only the one field that changed — the caller PATCHes it. */
  onSave: (patch: { caption?: string; visibility?: string; date?: string }) => Promise<void>;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState<Field | null>(null);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const src = thumbSrc(username, runId, photo.id);

  function open(field: Field) {
    setEditing(field);
    setValue(
      field === "date" ? (photo.date ?? "") : field === "caption" ? (photo.caption ?? "") : (photo.visibility ?? ""),
    );
  }

  async function save(field: Field, next: string) {
    setBusy(true);
    try {
      await onSave({ [field]: next } as Record<string, string>);
      setEditing(null);
    } finally {
      setBusy(false);
    }
  }

  const fields: Field[] = ["date", "caption", "visibility"];
  const label: Record<Field, string> = {
    date: t("studio.photos.chip.date"),
    caption: t("studio.photos.chip.caption"),
    visibility: t("studio.photos.chip.visibility"),
  };

  return (
    <div className="flex flex-wrap items-start gap-2">
      <PhotoTile
        size="avatar"
        kind={photo.kind}
        src={src}
        alt={photo.filename}
        onPress={() => setViewerOpen(true)}
      />
      <PhotoViewer
        items={[{ id: photo.id, kind: photo.kind, src }]}
        index={viewerOpen ? 0 : null}
        onClose={() => setViewerOpen(false)}
        onPrev={() => {}}
        onNext={() => {}}
      />
      <div className="flex flex-1 flex-wrap items-start gap-1.5">
      {fields.map((field) => {
        const state = stateFor(field, photo);
        const shown =
          field === "date" ? photo.date : field === "caption" ? photo.caption : photo.visibility;
        return (
          <div key={field} className="relative">
            <button
              type="button"
              onClick={() => open(field)}
              className={`min-h-8 rounded-full border px-3 text-xs font-medium ${STATE_CLASS[state]}`}
            >
              {label[field]}
              {shown ? `: ${shown}` : ""}
            </button>
            {editing === field && (
              <div className="absolute left-0 top-full z-10 mt-1 w-56 rounded-xl border border-line-strong bg-surface-raised p-2 shadow-lg">
                {field === "visibility" ? (
                  <select
                    autoFocus
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    className="min-h-9 w-full rounded-lg border border-line-strong bg-surface-raised px-2 text-sm text-ink-strong"
                  >
                    <option value="">{t("studio.photos.chip.visibilityDefault")}</option>
                    <option value="guest">{t("studio.photos.chip.visibilityGuest")}</option>
                    <option value="private">{t("studio.photos.chip.visibilityPrivate")}</option>
                  </select>
                ) : (
                  <input
                    autoFocus
                    type={field === "date" ? "date" : "text"}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    className="min-h-9 w-full rounded-lg border border-line-strong bg-surface-raised px-2 text-sm text-ink-strong"
                  />
                )}
                <div className="mt-2 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setEditing(null)}
                    className="min-h-8 rounded-full px-3 text-xs font-semibold text-ink-secondary"
                  >
                    {t("studio.photos.chip.cancel")}
                  </button>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void save(field, value)}
                    className="min-h-8 rounded-full bg-action-strong px-3 text-xs font-semibold text-on-action disabled:opacity-50"
                  >
                    {t("studio.photos.chip.save")}
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
      </div>
    </div>
  );
}
