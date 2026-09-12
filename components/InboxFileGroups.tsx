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
 * **Not wired into `HelperRoom.tsx` by this ticket.** That file's `FilesPane`
 * and `Tile` are private to it and out of scope here; wiring this component
 * in means `filesForRoom` (`lib/helper/server.ts`) growing `kind`, `bytes`
 * and `uploadedAt` on `RoomFile`, and setting an inbox photograph's `src` to
 * this new route rather than leaving it `undefined`. Both are called out in
 * the ticket's own report rather than done here.
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
  const photos = newestFirst(files.filter((f) => f.kind === "photo" || f.kind === "video"));
  const documents = newestFirst(files.filter((f) => f.kind === "document"));
  const other = newestFirst(files.filter((f) => f.kind === "location" || f.kind === "contact"));

  return (
    <>
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
              <li key={file.id} className="flex items-center gap-1">
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
              <li key={file.id} className="flex items-center gap-1">
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
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
