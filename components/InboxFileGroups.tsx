"use client";

import Image from "next/image";
import { Contact, FileText, MapPin } from "lucide-react";
import { useI18n } from "@/components/LocaleProvider";
import { mediaLoader } from "@/components/mediaLoader";

/**
 * The whole inbox, newest first, grouped by kind — B1123.
 *
 * The room used to show only what had already been chosen; `HelperRoom`'s own
 * `FilesPane` now shows the whole inbox, but as one flat grid with a 📄
 * fallback for anything without a thumbnail — a photograph waiting in the
 * inbox looked exactly like a bank statement, because nothing under
 * `content/<user>/inbox/` is reachable by URL and nothing served a picture
 * for one.
 *
 * `app/api/helper/[user]/inbox/[id]/thumbnail/route.ts` is the new door for
 * exactly that (owner-only, resolved through `lib/inbox.ts`, a derivative
 * rather than the original). This component is the view over it: split by
 * `kind` rather than by "waiting" vs "already on the trip" — a photograph is
 * a small square thumbnail, a document is a labelled row with its own name,
 * size and date, and neither group hides the other because both matter to
 * "what is waiting".
 *
 * Wired into `HelperRoom.tsx`'s files pane, fed by `filesForRoom`
 * (`lib/helper/server.ts`), which carries `kind`, `bytes` and `uploadedAt` on
 * `RoomFile` and points an inbox photograph's `src` at this route rather than
 * leaving it `undefined`.
 *
 * A fourth kind of group, added by inbox day-assembly Phase 2's Task 4: a
 * `date` on a file (`content/<user>/inbox/days/<date>/`, staged there by a
 * WhatsApp pin among other things) groups it under a heading naming that
 * date, above the three undated groups — otherwise it would sit in `filesForRoom`
 * unread and never show that anything had moved.
 */

type InboxFileKind = "photo" | "video" | "document" | "location" | "contact";

export type InboxFile = {
  /** `inbox:<id>` or `photo:<slug>:<src>` — the same selection ids the room
   *  already reads. */
  id: string;
  name: string;
  kind: InboxFileKind;
  /** A thumbnail — for `kind: "photo"`, the new route; absent for a video or
   *  a document, which draw the typed icon instead. */
  src?: string;
  bytes?: number;
  /** ISO timestamp — `InboxEntry.uploadedAt` (`lib/inbox.ts`), or an
   *  already-placed photograph's own date. */
  at?: string;
  /**
   * `YYYY-MM-DD` — set only for content staged under a day folder
   * (`content/<user>/inbox/days/<date>/`, `lib/inbox.ts`'s `listDayInbox`).
   * Phase 2 (inbox day-assembly) Task 4: a person watching this pane after a
   * WhatsApp pin lands into a date folder (Task 3) saw nothing move, since
   * nothing here read that folder. A file carrying this groups under its own
   * date heading instead of the three undated groups below.
   */
  date?: string;
};

/** `1.2 MB`, `340 KB`, `12 B` — a client-safe one-liner rather than an import
 *  of `lib/storageQuota.ts`'s `formatBytes`, which is `server-only`. */
function formatBytes(n: number): string {
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

function KindIcon({ kind }: { kind: InboxFileKind }) {
  if (kind === "video") return <span aria-hidden>🎞️</span>;
  if (kind === "location") return <MapPin className="h-5 w-5 text-navy-600" aria-hidden />;
  if (kind === "contact") return <Contact className="h-5 w-5 text-navy-600" aria-hidden />;
  return <FileText className="h-5 w-5 text-navy-600" aria-hidden />;
}

/** Newest first — `undefined` sorts last rather than first, since a file
 *  with no timestamp is not necessarily an old one. */
function newestFirst(files: InboxFile[]): InboxFile[] {
  return [...files].sort((a, b) => {
    if (!a.at && !b.at) return 0;
    if (!a.at) return 1;
    if (!b.at) return -1;
    return b.at.localeCompare(a.at);
  });
}

/**
 * One row in a list group — a document, an "other" item, or a day folder's
 * staged item. Documents and "other" already drew this exact markup twice;
 * a day-folder group (Task 4) reuses it rather than a third copy.
 */
function FileRow({
  file,
  selected,
  onToggle,
  onRemove,
  t,
}: {
  file: InboxFile;
  selected: string[];
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
  t: ReturnType<typeof useI18n>["t"];
}) {
  return (
    <li className="flex items-center gap-1">
      <label
        data-inbox-id={file.id}
        className={`flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-lg border px-2 py-1.5 focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-navy-800 ${
          selected.includes(file.id) ? "border-navy-800 ring-2 ring-navy-800" : "border-navy-200 bg-white"
        }`}
      >
        <input
          type="checkbox"
          checked={selected.includes(file.id)}
          onChange={() => onToggle(file.id)}
          className="sr-only"
        />
        <KindIcon kind={file.kind} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm text-navy-900">{file.name}</span>
          {(file.bytes !== undefined || file.at) && (
            <span className="block text-xs text-navy-600">
              {t("agent.room.fileMeta", {
                size: file.bytes !== undefined ? formatBytes(file.bytes) : "",
                date: file.at ? new Date(file.at).toLocaleDateString() : "",
              })}
            </span>
          )}
        </span>
      </label>
      <button
        type="button"
        onClick={() => onRemove(file.id)}
        aria-label={t("agent.room.menuDiscard")}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-lg text-navy-500 hover:bg-navy-50"
      >
        ×
      </button>
    </li>
  );
}

export function InboxFileGroups({
  files,
  selected,
  onToggle,
  onRemove,
}: {
  files: InboxFile[];
  selected: string[];
  onToggle: (id: string) => void;
  /**
   * A visible remove control per tile — B1272. The long-press/right-click
   * menu (`HelperRoom`'s `data-inbox-id` handler) already offered this, but
   * `contextmenu` is not a gesture a phone announces itself, so the pane had
   * no control anybody could actually find. One tap here opens the same
   * `discard_file` confirmation the menu does; nothing is removed without it.
   */
  onRemove: (id: string) => void;
}) {
  const { t } = useI18n();
  // A day folder's own content (Task 4) is pulled out first and grouped by
  // its date, above the three undated groups below; everything without a
  // `date` groups exactly as it did before this ticket.
  const dated = files.filter((f) => f.date);
  const undated = files.filter((f) => !f.date);
  const dateGroups = new Map<string, InboxFile[]>();
  for (const file of dated) {
    const group = dateGroups.get(file.date!);
    if (group) group.push(file);
    else dateGroups.set(file.date!, [file]);
  }
  const days = [...dateGroups.entries()].sort((a, b) => b[0].localeCompare(a[0]));

  const photos = newestFirst(undated.filter((f) => f.kind === "photo" || f.kind === "video"));
  const documents = newestFirst(undated.filter((f) => f.kind === "document"));
  const other = newestFirst(undated.filter((f) => f.kind === "location" || f.kind === "contact"));

  return (
    <>
      {days.map(([date, dayFiles]) => (
        <section className="mt-4" key={date}>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-navy-600">{date}</h3>
          <ul className="mt-2 space-y-1">
            {newestFirst(dayFiles).map((file) => (
              <FileRow key={file.id} file={file} selected={selected} onToggle={onToggle} onRemove={onRemove} t={t} />
            ))}
          </ul>
        </section>
      ))}

      {photos.length > 0 && (
        <section className="mt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-navy-600">
            {t("agent.room.photos")}
          </h3>
          <ul className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-4 lg:grid-cols-3">
            {photos.map((file) => (
              <li key={file.id} className="relative">
                <label
                  data-inbox-id={file.id}
                  className={`flex cursor-pointer flex-col overflow-hidden rounded-lg border bg-white focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-navy-800 ${
                    selected.includes(file.id) ? "border-navy-800 ring-2 ring-navy-800" : "border-navy-200"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(file.id)}
                    onChange={() => onToggle(file.id)}
                    className="sr-only"
                  />
                  <span className="relative block aspect-square bg-cream-200">
                    {/* A video's `src` is the same owner-only thumbnail route a
                     *  photograph's is (`lib/helper/server.ts`), but
                     *  `resizedCopy` (`lib/media.ts`) cannot make a derivative
                     *  of a video — sharp does not read one — and 404s. Never
                     *  point an `<img>` at that: B1380 was a video tile
                     *  showing the browser's broken-image icon for exactly
                     *  this reason. Fall through to the typed icon instead,
                     *  same as a document with no picture at all. */}
                    {file.src && file.kind !== "video" ? (
                      <Image
                        src={file.src}
                        loader={mediaLoader}
                        alt=""
                        fill
                        sizes="96px"
                        className="object-cover"
                      />
                    ) : (
                      <span className="flex h-full w-full items-center justify-center text-lg" aria-hidden>
                        <KindIcon kind={file.kind} />
                      </span>
                    )}
                  </span>
                  <span className="truncate px-1 py-1 text-[11px] leading-4 text-navy-800">
                    {file.name}
                  </span>
                </label>
                <button
                  type="button"
                  onClick={() => onRemove(file.id)}
                  aria-label={t("agent.room.menuDiscard")}
                  className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-navy-900/70 text-sm leading-none text-white"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {documents.length > 0 && (
        <section className="mt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-navy-600">
            {t("agent.room.documents")}
          </h3>
          <ul className="mt-2 space-y-1">
            {documents.map((file) => (
              <FileRow key={file.id} file={file} selected={selected} onToggle={onToggle} onRemove={onRemove} t={t} />
            ))}
          </ul>
        </section>
      )}

      {other.length > 0 && (
        <section className="mt-4">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-navy-600">
            {t("agent.room.otherFiles")}
          </h3>
          <ul className="mt-2 space-y-1">
            {other.map((file) => (
              <FileRow key={file.id} file={file} selected={selected} onToggle={onToggle} onRemove={onRemove} t={t} />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
