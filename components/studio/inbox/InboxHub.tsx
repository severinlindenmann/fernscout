"use client";

import { Fragment, useState, type ReactNode } from "react";
import BusyButton from "@/components/BusyButton";
import ConfirmPanel from "@/components/ConfirmPanel";
import { useI18n } from "@/components/LocaleProvider";
import { useStudioBar } from "@/components/studio/StudioBar";
import MonthGrid from "@/components/studio/day/MonthGrid";
import DayStrip from "@/components/studio/day/DayStrip";
import InboxTile, { formatBytes } from "@/components/studio/inbox/InboxTile";
import { weekdayIndex } from "@/lib/studio/dayStrip";
import { weekdayNames } from "@/lib/i18n";
import type { InboxDayEntry, InboxFileType, InboxHubModel, InboxRow } from "@/lib/studio/inbox";
import type { TranslationKey } from "@/lib/i18n";

/**
 * The studio's own view over `content/<user>/inbox/` — B1990.
 *
 * Grouped "waiting for a day" first, then one group per day folder
 * (`lib/studio/inbox.ts`'s `buildInboxHubModel`), with type chips that
 * filter and a selection bar for bulk moves. Every mutation (move, delete)
 * goes through the owner-cookie routes under `app/api/helper/[user]/inbox/`
 * and updates local state on success rather than reloading the page — the
 * server-read `model` is only ever the *first* paint.
 *
 * One row's own drawing (icons, date/dimensions, the `.vcf` detail sheet) is
 * `InboxTile.tsx` (B1995) — this file keeps every piece of state a tile's
 * buttons act on.
 *
 * **The move sheet and the delete confirmation are each built once**, as a
 * `moveSheet`/`deletePanel` JSX value below, **and placed twice** — handed to
 * `useStudioBar` (`@/components/studio/StudioBar`, B2001) for the studio's
 * shared sticky bottom slot (phone, `replace`, no desktop row) and again from
 * `md` up in the grid right after the tile it acts on (B2084; B1993 put it
 * after every group, far from the file it named). Rendering the same element
 * reference in two places gives each position its own component instance,
 * so this is "one component, two positions" rather than two copies of the
 * same markup to keep in sync.
 */

const TYPE_LABEL: Record<InboxFileType, TranslationKey> = {
  photo: "studio.inbox.type.photo",
  video: "studio.inbox.type.video",
  location: "studio.inbox.type.location",
  contact: "studio.inbox.type.contact",
  statement: "studio.inbox.type.statement",
  document: "studio.inbox.type.document",
  transcript: "studio.inbox.type.transcript",
};

/** A row's own selection/lookup key — an id is unique per file, but the same
 *  bytes could in principle sit under two different day folders, so the key
 *  is scoped to where the row currently is rather than the id alone. */
function keyOf(row: Pick<InboxRow, "id" | "day">): string {
  return `${row.day ?? ""}:${row.id}`;
}

/** Every JSON `error` code the move and delete routes answer with, mapped to
 *  a sentence — B1993: never surface a bare status code or a raw code word. */
const ERROR_KEYS: Record<string, TranslationKey> = {
  invalid_json: "studio.inbox.error.invalidRequest",
  invalid_day: "studio.inbox.error.invalidDay",
  unknown_inbox_file: "studio.inbox.error.unknownFile",
  move_failed: "studio.inbox.error.moveFailed",
  not_your_journal: "studio.inbox.error.notYourJournal",
  unknown_day: "studio.inbox.error.unknownDay",
};

/** A day's own key in the move sheet's "put it on" choice. */
const entryKey = (e: Pick<InboxDayEntry, "tripId" | "slug">) => `${e.tripId}/${e.slug}`;

export default function InboxHub({ username, model }: { username: string; model: InboxHubModel }) {
  const { t, tn, formatShortDate, locale } = useI18n();
  const base = `/api/helper/${encodeURIComponent(username)}`;
  const weekdays = weekdayNames(locale);

  const [rows, setRows] = useState<InboxRow[]>(() => [...model.waiting, ...model.days.flatMap((d) => d.rows)]);
  const [activeType, setActiveType] = useState<InboxFileType | "all">("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [failedThumbs, setFailedThumbs] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState<string | null>(null);
  // `day: null` until the owner taps one — B2084. The sheet used to open
  // with a proposed day already highlighted while its confirm stayed
  // disabled (B1993's guard against sending an untouched default), which
  // read as a chosen day that could not be used. Nothing is highlighted
  // until something is chosen; `""` is "back to waiting".
  // B2138 — `onto` is the day a move puts the files on for real (a
  // `entryKey`), `""` only pins them to the date's folder, `null` is not
  // answered yet (two days on one date: the sheet asks which).
  const [moving, setMoving] = useState<{ keys: string[]; day: string | null; onto: string | null } | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [moved, setMoved] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const presentTypes = [...new Set(rows.map((r) => r.type))];
  // The active filter can only ever name a type still present — a chip for
  // a type nobody has any files of left would filter to an empty page that
  // looks broken rather than empty (deleting or moving the last file of the
  // active type — B1993). Derived at render time, the same "adjust during
  // render rather than in an effect" call `DayStrip.tsx` already makes for
  // its own prop-driven reset, rather than a `setState` a lint rule (and
  // React's own docs) flag as a cause of cascading renders: `rows` changing
  // is already what triggers this render, so there is no external event to
  // synchronise from.
  const effectiveActiveType: InboxFileType | "all" =
    activeType !== "all" && !presentTypes.includes(activeType) ? "all" : activeType;
  const visible = effectiveActiveType === "all" ? rows : rows.filter((r) => r.type === effectiveActiveType);
  const waiting = visible.filter((r) => r.day === null);
  const dayGroups = new Map<string, InboxRow[]>();
  for (const row of visible) {
    if (!row.day) continue;
    const list = dayGroups.get(row.day);
    if (list) list.push(row);
    else dayGroups.set(row.day, [row]);
  }
  const days = [...dayGroups.entries()].sort((a, b) => b[0].localeCompare(a[0]));

  function toggle(key: string) {
    setSelected((was) => {
      const next = new Set(was);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function thumbSrc(row: InboxRow, width: number): string {
    const params = new URLSearchParams();
    if (row.day) params.set("day", row.day);
    params.set("w", String(width));
    return `${base}/inbox/${encodeURIComponent(row.id)}/thumbnail?${params.toString()}`;
  }

  /** The JSON `error` a route answered with, turned into a sentence a
   *  person reads — never the bare status code B1993 found in the live
   *  log. */
  async function errorSentence(response: Response): Promise<string> {
    const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
    const code = body && typeof body.error === "string" ? body.error : null;
    const key = code ? ERROR_KEYS[code] : undefined;
    return key ? t(key) : t("studio.inbox.error.generic", { status: String(response.status) });
  }

  /** B2082 — a location export never goes onto a day, not even in a
   *  selection; its tile has no Move button either. */
  const movable = (keys: string[]) =>
    keys.filter((k) => rows.find((r) => keyOf(r) === k)?.type !== "location");

  /** The written days a move of `keys` onto `day` could put them on — only
   *  photographs and videos go onto a day (`attachStagedFiles` takes media). */
  function daysFor(keys: string[], day: string | null): InboxDayEntry[] {
    if (!day) return [];
    const targets = rows.filter((r) => keys.includes(keyOf(r)));
    if (targets.length === 0 || targets.some((r) => r.kind !== "media")) return [];
    return model.entriesByDate[day] ?? [];
  }

  /** Choosing a date: one day on it is proposed, two are asked between,
   *  none leaves only the pin. */
  function chooseDay(keys: string[], day: string) {
    const days = daysFor(keys, day);
    setMoving({ keys, day, onto: days.length === 0 ? "" : days.length === 1 ? entryKey(days[0]) : null });
  }

  function openMove(requested: string[], day?: string) {
    const keys = movable(requested);
    if (keys.length === 0) return;
    setError("");
    setMoved("");
    setDeleting(null);
    setBulkDeleting(false);
    if (day) chooseDay(keys, day);
    else setMoving({ keys, day: null, onto: null });
  }

  async function callDelete(row: InboxRow) {
    const url = row.day
      ? `${base}/inbox/${encodeURIComponent(row.id)}?day=${encodeURIComponent(row.day)}`
      : `${base}/inbox/${encodeURIComponent(row.id)}`;
    const response = await fetch(url, { method: "DELETE" });
    if (!response.ok) throw new Error(await errorSentence(response));
  }

  async function callMove(row: InboxRow, day: string | null) {
    const url = row.day
      ? `${base}/inbox/${encodeURIComponent(row.id)}/move?day=${encodeURIComponent(row.day)}`
      : `${base}/inbox/${encodeURIComponent(row.id)}/move`;
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ day }),
    });
    if (!response.ok) throw new Error(await errorSentence(response));
  }

  /** B2138 — the whole selection, one call per file in order, the same
   *  stop-at-the-first-failure shape as a bulk move. */
  async function confirmBulkDelete() {
    const targets = rows.filter((r) => selected.has(keyOf(r)));
    setBusy(true);
    setError("");
    let gone = 0;
    for (const row of targets) {
      const key = keyOf(row);
      try {
        await callDelete(row);
      } catch (thrown) {
        setBusy(false);
        setError(t("studio.inbox.deletePartial", { deleted: String(gone), total: String(targets.length), error: (thrown as Error).message }));
        return;
      }
      gone += 1;
      setRows((was) => was.filter((r) => keyOf(r) !== key));
      setSelected((was) => {
        const next = new Set(was);
        next.delete(key);
        return next;
      });
    }
    setBusy(false);
    setBulkDeleting(false);
    setMoved(tn("studio.inbox.deleted", gone, { count: String(gone) }));
  }

  async function confirmDelete() {
    const row = rows.find((r) => keyOf(r) === deleting);
    if (!row) return;
    setBusy(true);
    setError("");
    try {
      await callDelete(row);
      setRows((was) => was.filter((r) => keyOf(r) !== deleting));
      setSelected((was) => {
        const next = new Set(was);
        next.delete(deleting!);
        return next;
      });
      setDeleting(null);
    } catch (thrown) {
      setError((thrown as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /** One call per file, in order, each updating its own row as it succeeds —
   *  B1993. A failure stops the run rather than racing ahead: the files
   *  already moved show their new day, the rest (the one that failed and
   *  everything not yet attempted) stay selected, and the message names how
   *  many actually moved. The previous version awaited every call before
   *  touching state at all, so one failure left the whole batch showing its
   *  old place even for the files that had already moved. */
  async function confirmMove() {
    if (!moving) return;
    const targets = rows.filter((r) => moving.keys.includes(keyOf(r)));
    if (moving.day === null || moving.onto === null) return;
    if (moving.onto) return putOnDay(targets, moving.onto);
    const destination = moving.day || null;
    setBusy(true);
    setError("");
    let movedCount = 0;
    let failure: string | null = null;
    for (const row of targets) {
      const key = keyOf(row);
      try {
        await callMove(row, destination);
        movedCount += 1;
        setRows((was) => was.map((r) => (keyOf(r) === key ? { ...r, day: destination } : r)));
        setSelected((was) => {
          const next = new Set(was);
          next.delete(key);
          return next;
        });
      } catch (thrown) {
        failure = (thrown as Error).message;
        break;
      }
    }
    setBusy(false);
    if (failure) {
      setError(
        targets.length > 1
          ? t("studio.inbox.movePartial", { moved: String(movedCount), total: String(targets.length), error: failure })
          : failure,
      );
      return; // Sheet stays open; the unfinished rows are still selected.
    }
    setMoving(null);
    const what = targets.length === 1 ? targets[0].name : tn("studio.inbox.filesCount", targets.length, { count: String(targets.length) });
    // B2138 — a move to a date only pins the file to that date's folder;
    // the day's own photographs are unchanged, and the sentence says so.
    setMoved(
      destination
        ? tn("studio.inbox.pinned", targets.length, { name: what, day: dayLabel(destination) })
        : t("studio.inbox.movedWaiting", { name: what }),
    );
  }

  /** B2138 — onto a written day for real: a pinned file goes back to the
   *  flat bucket first (the attach door reads only that), then one
   *  `day/attach` call puts every file on the day, which empties them out of
   *  the inbox. */
  async function putOnDay(targets: InboxRow[], onto: string) {
    const entry = (model.entriesByDate[moving?.day ?? ""] ?? []).find((e) => entryKey(e) === onto);
    if (!entry) return;
    setBusy(true);
    setError("");
    try {
      for (const row of targets.filter((r) => r.day !== null)) {
        await callMove(row, null);
        setRows((was) => was.map((r) => (keyOf(r) === keyOf(row) ? { ...r, day: null } : r)));
      }
      const response = await fetch(`${base}/day/attach`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ trip: entry.tripId, slug: entry.slug, files: targets.map((r) => r.id) }),
      });
      if (!response.ok) throw new Error(await errorSentence(response));
    } catch (thrown) {
      setBusy(false);
      setError((thrown as Error).message);
      return;
    }
    const ids = new Set(targets.map((r) => r.id));
    setRows((was) => was.filter((r) => !ids.has(r.id)));
    setSelected((was) => new Set([...was].filter((k) => !targets.some((r) => keyOf(r) === k))));
    setBusy(false);
    setMoving(null);
    const what = targets.length === 1 ? targets[0].name : tn("studio.inbox.filesCount", targets.length, { count: String(targets.length) });
    setMoved(tn("studio.inbox.putOn", targets.length, { name: what, title: entry.title }));
  }

  const movingTargets = moving ? rows.filter((r) => moving.keys.includes(keyOf(r))) : [];
  const showBackToWaiting = movingTargets.length > 0 && movingTargets.every((r) => r.day !== null);
  const movingDays = moving ? daysFor(moving.keys, moving.day) : [];
  const movingOnto = movingDays.find((e) => entryKey(e) === moving?.onto);
  const moveConfirmDisabled =
    !moving ||
    moving.day === null ||
    moving.onto === null ||
    movingTargets.length === 0 ||
    (!moving.onto && movingTargets.every((r) => (r.day ?? "") === moving.day));

  function dayLabel(date: string): string {
    return `${weekdays[weekdayIndex(date)]} ${formatShortDate(date)}`;
  }

  function moveConfirmLabel(): string {
    if (!moving || moving.day === null) return t("studio.inbox.move");
    if (movingOnto) return t("studio.inbox.putOnConfirm", { title: movingOnto.title });
    return moving.day === ""
      ? t("studio.inbox.moveConfirmWaiting")
      : t("studio.inbox.pinConfirm", { day: dayLabel(moving.day) });
  }

  const moveSheet = moving ? (
    <div className="rounded-2xl border border-line-quiet bg-surface-base p-4">
      <p className="text-sm font-semibold text-ink-strong">
        {movingTargets.length === 1
          ? t("studio.inbox.moveTitleFile", { name: movingTargets[0].name })
          : t("studio.inbox.moveTitle")}
      </p>
      {showBackToWaiting && (
        <button
          type="button"
          onClick={() => setMoving({ ...moving, day: "", onto: "" })}
          className={`mt-2 min-h-11 rounded-full border px-4 text-sm font-semibold ${
            moving.day === "" ? "border-yellow-600 bg-yellow-400 text-yellow-950" : "border-line-strong text-ink-body"
          }`}
        >
          {t("studio.inbox.backToWaiting")}
        </button>
      )}
      <div className="mt-2">
        <DayStrip
          value={moving.day ?? ""}
          onChange={(date) => chooseDay(moving.keys, date)}
          start={model.dayBounds.start}
          end={model.dayBounds.end}
          writtenDates={model.writtenDates}
        />
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-semibold text-ink-body underline underline-offset-2">
            {t("studio.day.which.anotherDate")}
          </summary>
          <MonthGrid
            value={moving.day ?? ""}
            onChange={(date) => chooseDay(moving.keys, date)}
            min={model.dayBounds.start}
            max={model.dayBounds.end}
            writtenDates={model.writtenDates}
          />
        </details>
      </div>
      {movingDays.length > 0 && (
        <fieldset className="mt-3">
          <legend className="text-sm font-semibold text-ink-strong">{t("studio.inbox.ontoLegend")}</legend>
          {[...movingDays.map((e) => ({ key: entryKey(e), label: `${e.tripTitle} · ${e.title}` })), { key: "", label: t("studio.inbox.ontoPinOnly") }].map(
            (choice) => (
              <label key={choice.key} className="mt-1 flex min-h-11 items-center gap-2 text-sm text-ink-body">
                <input
                  type="radio"
                  name="inbox-onto"
                  checked={moving.onto === choice.key}
                  onChange={() => setMoving({ ...moving, onto: choice.key })}
                />
                {choice.label}
              </label>
            ),
          )}
          {movingOnto?.published && <p className="mt-1 text-sm text-ink-body">{t("studio.inbox.ontoPublished")}</p>}
        </fieldset>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <BusyButton
          busy={busy}
          type="button"
          disabled={moveConfirmDisabled}
          onClick={confirmMove}
          className="min-h-11 rounded-full bg-yellow-400 px-5 text-base font-semibold text-yellow-950 disabled:opacity-50"
        >
          {moveConfirmLabel()}
        </BusyButton>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setMoving(null);
            setError("");
          }}
          className="min-h-11 rounded-full border border-line-strong px-5 text-base font-semibold text-ink-body disabled:opacity-50"
        >
          {t("me.cancel")}
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-coral-600">
          {error}
        </p>
      )}
    </div>
  ) : null;

  const selectedRows = rows.filter((r) => selected.has(keyOf(r)));
  const deletePanel = bulkDeleting ? (
    <ConfirmPanel
      label={t("studio.inbox.deleteLabel")}
      question={tn("studio.inbox.bulkDeleteQuestion", selectedRows.length, {
        count: String(selectedRows.length),
        size: formatBytes(selectedRows.reduce((sum, r) => sum + r.bytes, 0)),
      })}
      confirmLabel={tn("studio.inbox.bulkDeleteConfirm", selectedRows.length, { count: String(selectedRows.length) })}
      tone="destructive"
      busy={busy}
      error={error}
      onConfirm={confirmBulkDelete}
      onCancel={() => {
        setBulkDeleting(false);
        setError("");
      }}
    />
  ) : deleting ? (
    <ConfirmPanel
      label={t("studio.inbox.deleteLabel")}
      question={t("studio.inbox.deleteQuestion", {
        name: rows.find((r) => keyOf(r) === deleting)?.name ?? "",
      })}
      confirmLabel={t("studio.inbox.deleteConfirm")}
      tone="destructive"
      busy={busy}
      error={error}
      onConfirm={confirmDelete}
      onCancel={() => {
        setDeleting(null);
        setError("");
      }}
    />
  ) : null;

  // `md` and up: the open sheet sits in the grid right after the tile it
  // acts on — B2084 — rather than after every group. A bulk move (or a
  // tile the active filter hides) has no one tile, so it sits under the
  // selection bar instead.
  const sheet = moveSheet ?? deletePanel;
  const anchorKey = deleting ?? (moving && moving.keys.length === 1 ? moving.keys[0] : null);
  const anchored = anchorKey !== null && visible.some((r) => keyOf(r) === anchorKey);

  function openDelete(row: InboxRow) {
    setError("");
    setMoved("");
    setMoving(null);
    setBulkDeleting(false);
    setDeleting(keyOf(row));
  }

  function openBulkDelete() {
    setError("");
    setMoved("");
    setMoving(null);
    setDeleting(null);
    setBulkDeleting(true);
  }

  const allVisibleSelected = visible.length > 0 && visible.every((r) => selected.has(keyOf(r)));

  // Registered with the studio's shared bottom bar (B2001) rather than
  // rendered as this page's own `ActionBar`: `replace` while a sheet or the
  // delete confirmation is open, so the default "back to the studio" link
  // cannot be tapped by mistake mid-action; `extend` (the default) the rest
  // of the time, with nothing of its own to add.
  useStudioBar(
    moveSheet ? (
      <div className="w-full">{moveSheet}</div>
    ) : deletePanel ? (
      <div className="w-full">{deletePanel}</div>
    ) : null,
    { replace: Boolean(moveSheet || deletePanel) },
  );

  return (
    <>

      {rows.length === 0 && (
        <p className="mt-6 rounded-2xl border border-line-quiet bg-surface-base p-4 text-sm text-ink-body">
          {t("studio.inbox.empty")}
        </p>
      )}

      {presentTypes.length > 1 && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Chip
            active={effectiveActiveType === "all"}
            onClick={() => setActiveType("all")}
            label={t("studio.inbox.chip.all")}
          />
          {presentTypes.map((type) => (
            <Chip
              key={type}
              active={effectiveActiveType === type}
              onClick={() => setActiveType(type)}
              label={t(TYPE_LABEL[type])}
            />
          ))}
        </div>
      )}

      {visible.length > 1 && !allVisibleSelected && (
        <button
          type="button"
          onClick={() => setSelected(new Set(visible.map(keyOf)))}
          className="mt-3 min-h-11 text-sm font-semibold text-ink-body underline underline-offset-2"
        >
          {t("studio.inbox.selectAll", { count: String(visible.length) })}
        </button>
      )}

      {selected.size > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-line-strong bg-surface-raised px-4 py-3">
          <span className="text-sm font-semibold text-ink-strong">
            {tn("studio.inbox.selection", selected.size, { count: String(selected.size) })}
          </span>
          {movable([...selected]).length > 0 && (
            <button
              type="button"
              onClick={() => openMove([...selected])}
              className="min-h-11 rounded-full bg-action-strong px-4 text-sm font-semibold text-on-action"
            >
              {t("studio.inbox.moveSelected")}
            </button>
          )}
          {/* B2138 — location exports are out of a bulk move, never out of a
              bulk delete. */}
          <button
            type="button"
            onClick={openBulkDelete}
            className="min-h-11 text-sm font-semibold text-ink-body underline underline-offset-2"
          >
            {t("studio.inbox.deleteSelected")}
          </button>
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="min-h-11 rounded-full border border-line-strong px-4 text-sm font-semibold text-ink-body"
          >
            {t("studio.inbox.clearSelection")}
          </button>
        </div>
      )}

      {sheet && !anchored && <div className="mt-4 hidden md:block">{sheet}</div>}

      <p role="status" className="mt-4 text-sm font-semibold text-ink-strong empty:hidden">
        {moved}
      </p>

      {waiting.length > 0 && (
        <Group
          username={username}
          heading={t("studio.inbox.groupWaiting")}
          rows={waiting}
          selected={selected}
          onToggle={toggle}
          onMoveOne={(row) => openMove([keyOf(row)])}
          onDeleteOne={openDelete}
          anchorKey={anchorKey}
          sheet={sheet}
          thumbSrc={thumbSrc}
          failedThumbs={failedThumbs}
          onThumbError={(key) => setFailedThumbs((was) => new Set(was).add(key))}
        />
      )}

      {days.map(([date, dayRows]) => (
        <Group
          key={date}
          username={username}
          heading={formatShortDate(date)}
          rows={dayRows}
          selected={selected}
          onToggle={toggle}
          onMoveOne={(row) => openMove([keyOf(row)])}
          onDeleteOne={openDelete}
          onPutOnDay={(row) => (daysFor([keyOf(row)], row.day).length > 0 ? () => openMove([keyOf(row)], row.day!) : undefined)}
          anchorKey={anchorKey}
          sheet={sheet}
          thumbSrc={thumbSrc}
          failedThumbs={failedThumbs}
          onThumbError={(key) => setFailedThumbs((was) => new Set(was).add(key))}
        />
      ))}

      {/* `md` and up — inline, in the ordinary flow, right where the old
          card used to sit. Below `md` the same content lives in the
          studio's shared bottom bar instead — see the `useStudioBar` call
          above. */}
    </>
  );
}

function Chip({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`min-h-9 rounded-full border px-3 text-sm font-semibold ${
        active ? "border-yellow-600 bg-yellow-400 text-yellow-950" : "border-line-strong text-ink-body"
      }`}
    >
      {label}
    </button>
  );
}

function Group({
  username,
  heading,
  rows,
  selected,
  onToggle,
  onMoveOne,
  onDeleteOne,
  onPutOnDay,
  thumbSrc,
  failedThumbs,
  onThumbError,
  anchorKey,
  sheet,
}: {
  /** B2138 — a pinned photograph whose date has a written day: the tile's
   *  "Put on the day", or nothing. */
  onPutOnDay?: (row: InboxRow) => (() => void) | undefined;
  anchorKey: string | null;
  sheet: ReactNode;
  username: string;
  heading: string;
  rows: InboxRow[];
  selected: Set<string>;
  onToggle: (key: string) => void;
  onMoveOne: (row: InboxRow) => void;
  onDeleteOne: (row: InboxRow) => void;
  thumbSrc: (row: InboxRow, width: number) => string;
  failedThumbs: Set<string>;
  onThumbError: (key: string) => void;
}) {
  return (
    <section className="mt-6">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">{heading}</h2>
      <ul className="mt-2 grid grid-cols-1 gap-3 md:grid-cols-2">
        {rows.map((row, i) => {
          const key = keyOf(row);
          return (
            <Fragment key={key}>
              <InboxTile
                username={username}
                row={row}
                selected={selected.has(key)}
                onToggle={() => onToggle(key)}
                onMoveOne={() => onMoveOne(row)}
                onDeleteOne={() => onDeleteOne(row)}
                onPutOnDay={onPutOnDay?.(row)}
                thumbSrc={thumbSrc}
                hasThumbFailed={failedThumbs.has(key)}
                onThumbError={() => onThumbError(key)}
                arriveIndex={i}
              />
              {key === anchorKey && sheet && <li className="hidden md:col-span-2 md:block">{sheet}</li>}
            </Fragment>
          );
        })}
      </ul>
    </section>
  );
}
