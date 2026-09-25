"use client";

import { useState } from "react";
import Link from "next/link";
import { Contact, Eye, FileText, MapPin, Play, Receipt, ScrollText } from "lucide-react";
import { useI18n } from "@/components/LocaleProvider";
import type { InboxFileType, InboxRow } from "@/lib/studio/inbox";

/**
 * One inbox tile — split out of `InboxHub.tsx` (B1995) so its own icons, its
 * date/dimensions line and its `.vcf` detail sheet can be built without
 * touching the hub's move/delete/selection state, which a concurrent ticket
 * (B1993) is changing at the same time. `InboxHub` still owns every piece of
 * state a tile's buttons act on (`selected`, `moving`, `deleting`) — this
 * component only renders one row and calls back up.
 */

/** `1.2 MB`, `340 KB`. */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB"];
  let value = n / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 ? Math.round(value) : Math.round(value * 10) / 10} ${units[unit]}`;
}

/** The non-photo, non-video type glyphs this ticket leaves alone — a photo
 *  or video's own missing-thumbnail placeholder is the inline `PreviewIcon`
 *  below instead. */
function TypeGlyph({ type, className = "h-8 w-8" }: { type: InboxFileType; className?: string }) {
  const props = { className, "aria-hidden": true as const, strokeWidth: 2 };
  if (type === "location") return <MapPin {...props} />;
  if (type === "contact") return <Contact {...props} />;
  if (type === "statement") return <Receipt {...props} />;
  if (type === "transcript") return <ScrollText {...props} />;
  return <FileText {...props} />;
}

/** A photograph/video placeholder — inline, not `lucide-react`'s, because
 *  this is one of the three icons the ticket asks to draw by hand. */
function PreviewIcon({ className = "h-5 w-5", "aria-hidden": hidden }: { className?: string; "aria-hidden"?: true }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden={hidden}>
      <rect x="3" y="6" width="18" height="14" rx="2" stroke="currentColor" strokeWidth="1.75" />
      <path d="M8 6l1.5-2.5h5L16 6" stroke="currentColor" strokeWidth="1.75" strokeLinejoin="round" />
      <circle cx="12" cy="13" r="3.25" stroke="currentColor" strokeWidth="1.75" />
    </svg>
  );
}

/** "Onto a day" — the move button's calendar, one of the three hand-drawn
 *  icons. */
function CalendarIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <rect x="3.5" y="5" width="17" height="16" rx="2" stroke="currentColor" strokeWidth="1.75" />
      <path d="M3.5 9.5h17M8 3v3.5M16 3v3.5" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

/** Delete's trash can, coral rather than the tile's ordinary ink colour —
 *  the third hand-drawn icon, and the one place this row draws attention to
 *  itself on purpose. */
function TrashIcon({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden>
      <path
        d="M4.5 7h15M9.5 7V4.75c0-.69.56-1.25 1.25-1.25h2.5c.69 0 1.25.56 1.25 1.25V7M6.5 7l.7 12.15c.05.99.87 1.75 1.86 1.75h6.88c.99 0 1.81-.76 1.86-1.75L18.5 7"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M10 11v6M14 11v6" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}

export default function InboxTile({
  username,
  row,
  selected,
  onToggle,
  onMoveOne,
  onDeleteOne,
  onPutOnDay,
  thumbSrc,
  hasThumbFailed,
  onThumbError,
  arriveIndex,
}: {
  username: string;
  row: InboxRow;
  selected: boolean;
  onToggle: () => void;
  onMoveOne: () => void;
  onDeleteOne: () => void;
  /** B2138 — set only for a file pinned to a date that has a written day. */
  onPutOnDay?: () => void;
  thumbSrc: (row: InboxRow, width: number) => string;
  hasThumbFailed: boolean;
  onThumbError: () => void;
  /** B2325 — this row's position in its group on first paint; see
   *  `GroupCard`'s own doc comment in `StudioHub.tsx` for why re-render is
   *  safe (`rows` is keyed by `keyOf`, so a move/delete elsewhere does not
   *  remount the rows that stay). */
  arriveIndex: number;
}) {
  const { t, tn, formatShortDate } = useI18n();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const hasPicture = (row.type === "photo" || row.type === "video") && !hasThumbFailed;

  // `takenAt`/`uploadedAt` are full ISO timestamps; `formatShortDate` wants
  // just the date part.
  const dateLabel = formatShortDate((row.takenAt ?? row.uploadedAt).slice(0, 10));
  const dimensionsLabel = row.dimensions ? `${row.dimensions.width}×${row.dimensions.height}` : null;
  const typeAndSize = t("studio.inbox.preview.typeSize", {
    type: row.name.split(".").pop()?.toUpperCase() ?? "",
    size: formatBytes(row.bytes),
  });
  // Icon plus word at every width — B2084: an unlabelled calendar and bin
  // at 390 read as decoration. The row wraps before a word is dropped.
  const action = "flex min-h-11 items-center gap-1.5 rounded-lg border border-line-strong px-3 text-sm font-semibold text-ink-strong";

  return (
    <li
      className="fs-arrive relative rounded-xl border border-line-quiet bg-surface-raised p-3"
      style={{ "--i": arriveIndex } as React.CSSProperties}
    >
      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          className="mt-1 h-4 w-4 shrink-0"
          aria-label={t("studio.inbox.select", { name: row.name })}
        />
        <span className="relative block h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-surface-muted">
          {hasPicture ? (
            // eslint-disable-next-line @next/next/no-img-element -- a private, no-store owner-only derivative; Next's own optimiser cannot read it (mediaLoader's own doc comment explains why for the published-media case, and this route is cookie-gated the same way).
            <img
              src={thumbSrc(row, 200)}
              alt=""
              width={64}
              height={64}
              loading="lazy"
              decoding="async"
              className="h-full w-full object-cover"
              onError={onThumbError}
            />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-ink-secondary">
              {row.type === "photo" || row.type === "video" ? (
                <PreviewIcon className="h-7 w-7" aria-hidden />
              ) : (
                <TypeGlyph type={row.type} className="h-7 w-7" />
              )}
            </span>
          )}
          {row.type === "video" && (
            <span className="absolute bottom-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-overlay-strong/70 text-overlay-ink">
              <Play className="h-3 w-3" aria-hidden fill="currentColor" />
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-ink-strong">
            {row.contact ? row.contact.name || row.name : row.name}
          </span>
          {row.contact ? (
            <span className="block truncate text-xs text-ink-secondary">
              {tn("studio.inbox.phones", row.contact.phones, { count: String(row.contact.phones) })}
              {" · "}
              {tn("studio.inbox.emails", row.contact.emails, { count: String(row.contact.emails) })}
            </span>
          ) : (
            <span className="block text-xs text-ink-secondary">
              {formatBytes(row.bytes)} · {dateLabel}
              {dimensionsLabel ? ` · ${dimensionsLabel}` : ""}
            </span>
          )}
          {/* B2082 — a location export is somebody's whole movement history,
              left here by the location flow: said on the tile itself, once
              (the preview below then leaves its own copy out). */}
          {row.type === "location" && (
            <span className="mt-0.5 block text-xs font-semibold text-ink-strong">{t("studio.inbox.preview.keptPrivately")}</span>
          )}
        </span>
      </label>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => (row.contact ? setDetailsOpen(true) : setPreviewOpen((was) => !was))}
          aria-expanded={row.contact ? undefined : previewOpen}
          className={action}
        >
          <Eye className="h-4 w-4" aria-hidden />
          {row.contact ? t("studio.inbox.viewContact") : t("studio.inbox.preview")}
        </button>
        {/* B2082 — a location export never goes onto a day. */}
        {row.type !== "location" && (
          <button type="button" onClick={onMoveOne} className={action}>
            <CalendarIcon />
            {t("studio.inbox.move")}
          </button>
        )}
        {onPutOnDay && (
          <button type="button" onClick={onPutOnDay} className={action}>
            {t("studio.inbox.putOnDay")}
          </button>
        )}
        <button type="button" onClick={onDeleteOne} className={action}>
          <span aria-hidden className="text-coral-600">
            <TrashIcon />
          </span>
          {t("studio.inbox.deleteLabel")}
        </button>
      </div>

      {previewOpen && (
        <div className="mt-3 rounded-lg bg-surface-subtle p-3" data-testid="inbox-preview">
          {hasPicture ? (
            // eslint-disable-next-line @next/next/no-img-element -- the same owner-only derivative as the tile, larger; never the original.
            <img src={thumbSrc(row, 640)} alt={row.name} className="max-h-80 w-full rounded-lg object-contain" onError={onThumbError} />
          ) : row.preview?.kind === "table" && row.preview.rows.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs text-ink-strong">
                <caption className="sr-only">{t("studio.inbox.preview.csvCaption", { name: row.name })}</caption>
                <thead>
                  <tr>
                    {row.preview.rows[0].map((cell, i) => (
                      <th key={i} className="whitespace-nowrap border-b border-line-quiet px-2 py-1 font-semibold">
                        {cell}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {row.preview.rows.slice(1).map((cells, r) => (
                    <tr key={r}>
                      {cells.map((cell, i) => (
                        <td key={i} className="whitespace-nowrap px-2 py-1">
                          {cell}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : row.preview?.kind === "location" ? (
            <>
              <p className="text-sm text-ink-strong">
                {row.preview.format ? t("studio.inbox.preview.location", { format: row.preview.format }) : typeAndSize}
              </p>
              {row.type !== "location" && (
                <p className="mt-1 text-xs text-ink-secondary">{t("studio.inbox.preview.keptPrivately")}</p>
              )}
            </>
          ) : (
            <p className="text-sm text-ink-strong">{typeAndSize}</p>
          )}
        </div>
      )}

      {detailsOpen && row.contact && (
        <div
          role="dialog"
          aria-modal="false"
          aria-label={row.contact.name || row.name}
          className="absolute inset-x-0 top-full z-10 mt-1.5 rounded-xl border border-line-strong bg-surface-base p-3 shadow-lg"
        >
          <p className="text-sm font-semibold text-ink-strong">{row.contact.name || row.name}</p>
          <p className="mt-1 text-xs text-ink-body">
            {tn("studio.inbox.phones", row.contact.phones, { count: String(row.contact.phones) })}
          </p>
          {row.contact.email && <p className="text-xs text-ink-body">{row.contact.email}</p>}
          <p className="mt-1 text-[11px] text-ink-secondary">
            {t("studio.inbox.contactSource")} · {dateLabel}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Link
              href={`/${encodeURIComponent(username)}/studio/people?step=bring&name=${encodeURIComponent(row.contact.name ?? "")}`}
              className="min-h-9 rounded-full bg-yellow-400 px-3 text-xs font-semibold text-yellow-950"
            >
              {t("studio.inbox.createPerson")}
            </Link>
            <button
              type="button"
              onClick={() => setDetailsOpen(false)}
              className="min-h-9 rounded-full border border-line-strong px-3 text-xs font-semibold text-ink-body"
            >
              {t("studio.inbox.closeDetails")}
            </button>
          </div>
        </div>
      )}
    </li>
  );
}
