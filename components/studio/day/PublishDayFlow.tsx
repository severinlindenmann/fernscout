"use client";

import { useMemo, useState } from "react";
import ConfirmPanel from "@/components/ConfirmPanel";
import { DeleteDayConfirm } from "@/components/DeleteDay";
import { useI18n } from "@/components/LocaleProvider";
import DoneScreen from "@/components/studio/DoneScreen";
import type { TranslationKey } from "@/lib/i18n";
import type { PublishRow } from "@/lib/studio/publishDay";

/** More rows than this and the list gets a search box. */
const SEARCH_FROM = 8;

/** More readers than this and all but two collapse into "and N others". */
const NAMES_SHOWN = 3;

/** The blanks "Change a day" (`EditDay`) has a real control for; every other
 *  declinable has none in the studio yet, so it is not linked there. */
const FILLABLE_IN_CHANGE_A_DAY = new Set(["time", "location", "media", "visibility", "costs", "transportMode", "tags"]);

/** How the sentence names the blanks: a derived field is said as the thing a
 *  person thinks of (a position, a country, a time zone are all "place").
 *  Anything not here — weather, other languages — counts as a "detail". The
 *  "Show all" list below still names every field exactly. */
const PART_OF: Record<string, string> = {
  media: "photographs",
  location: "place",
  coordinates: "place",
  country: "place",
  countryCode: "place",
  timezone: "place",
  time: "time",
  costs: "costs",
  transportMode: "transportMode",
  tags: "tags",
  visibility: "visibility",
};
const PART_ORDER = ["photographs", "place", "time", "costs", "transportMode", "tags", "visibility"];
/** Named parts in the sentence before the rest become "N more details". */
const PARTS_NAMED = 5;

/**
 * "Publish a day" — B2140. A page, not a wizard: the list (drafts, or with
 * `takeDown` the days already on the site), and once one is chosen by URL
 * (`?day=&trip=`, so "Go to publishing" can preselect it) what publishing
 * does and to whom, then one `ConfirmPanel`. Nothing is written until its
 * confirm is pressed; the write is the owner's cookie door
 * (`/api/web/.../days/<slug>/publish` or `.../unpublish`), which never sends.
 */
export default function PublishDayFlow({
  username,
  rows,
  chosen,
  missing,
  takeDown,
  canTell,
  blank = [],
  readers = null,
}: {
  username: string;
  rows: PublishRow[];
  chosen: PublishRow | null;
  /** `?day=` named something that is not in `rows` (already published, gone). */
  missing: boolean;
  takeDown: boolean;
  /** Whether mail or WhatsApp is switched on, so the day's page can tell readers. */
  canTell: boolean;
  /** B2192 — the chosen draft's declinables still blank (`blankFieldsOf`). */
  blank?: string[];
  /** B2192 — its readers by name (`readersOf`); `null` where it is "anyone". */
  readers?: string[] | null;
}) {
  const { t, tn, formatLongDate, locale } = useI18n();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [done, setDone] = useState(false);
  // B2259 — the row whose "Delete…" is asking, and the one just deleted.
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleted, setDeleted] = useState<PublishRow | null>(null);

  const base = `/${encodeURIComponent(username)}/studio/day/publish`;
  const listHref = takeDown ? `${base}?list=published` : base;
  const dayHref = (row: PublishRow) =>
    `/${encodeURIComponent(username)}/trips/${encodeURIComponent(row.tripId)}/day/${encodeURIComponent(row.slug)}`;
  const chooseHref = (row: PublishRow) =>
    `${base}?day=${encodeURIComponent(row.slug)}&trip=${encodeURIComponent(row.tripId)}${takeDown ? "&list=published" : ""}`;

  /** An untitled day is called by its date, as a person says it. */
  const nameOf = (row: PublishRow) => row.title || formatLongDate(row.date);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => `${r.title} ${r.tripTitle} ${r.date}`.toLowerCase().includes(q));
  }, [rows, query]);

  async function commit(row: PublishRow) {
    setBusy(true);
    setError(undefined);
    const url = `/api/web/${encodeURIComponent(username)}/trips/${encodeURIComponent(row.tripId)}/days/${encodeURIComponent(row.slug)}/${takeDown ? "unpublish" : "publish"}`;
    // The blanks this sheet named — the server checks each is really blank.
    // `visibility` is never sent: the studio does not answer it by leaving it.
    const declineOpen = takeDown ? [] : blank.filter((field) => field !== "visibility");
    const body = JSON.stringify(declineOpen.length > 0 ? { declineOpen } : {});
    const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body }).catch(() => null);
    setBusy(false);
    if (response?.ok) return setDone(true);
    setError(response?.status === 422 ? t("studio.publish.incomplete") : t("studio.publish.failed"));
  }

  const deletedHref = `/${encodeURIComponent(username)}/studio/day/deleted`;
  if (deleted) {
    return (
      <DoneScreen
        username={username}
        done={t("studio.delete.done", { title: nameOf(deleted) })}
        next={[
          { title: t("studio.deleted.title"), href: deletedHref, label: t("studio.deleted.title") },
          {
            title: t(takeDown ? "studio.publish.anotherDown" : "studio.publish.another"),
            href: listHref,
            label: t(takeDown ? "studio.publish.anotherDown" : "studio.publish.another"),
          },
        ]}
      />
    );
  }

  if (chosen && done) {
    return (
      <DoneScreen
        username={username}
        done={t(takeDown ? "studio.publish.doneDown" : "studio.publish.done", { title: nameOf(chosen) })}
        next={[
          { title: nameOf(chosen), href: dayHref(chosen), label: t("studio.day.done.openDay") },
          {
            title: t(takeDown ? "studio.publish.anotherDown" : "studio.publish.another"),
            href: listHref,
            label: t(takeDown ? "studio.publish.anotherDown" : "studio.publish.another"),
          },
        ]}
      />
    );
  }

  if (chosen) {
    const list = (items: string[]) => new Intl.ListFormat(locale, { type: "conjunction" }).format(items);
    const label = (field: string) => t(`studio.day.field.${field}` as TranslationKey);
    const parts = PART_ORDER.filter((part) => blank.some((f) => PART_OF[f] === part));
    const named = parts.slice(0, PARTS_NAMED);
    // Every field whose part is not named — a detail, or a part past the cap.
    const details = blank.filter((f) => !named.includes(PART_OF[f])).length;
    const sentence = [
      ...named.map((part) => t(`studio.publish.part.${part}` as TranslationKey)),
      ...(details > 0 ? [tn("studio.publish.moreDetails", details, { count: String(details) })] : []),
    ];
    const editHref = `/${encodeURIComponent(username)}/studio/day/edit?slug=${encodeURIComponent(chosen.slug)}`;
    const readerNames =
      readers && readers.length > NAMES_SHOWN
        ? [...readers.slice(0, 2), tn("studio.publish.others", readers.length - 2, { count: String(readers.length - 2) })]
        : readers;
    return (
      <>
        <a href={listHref} className="mt-1 inline-block text-sm font-semibold text-ink-body underline underline-offset-2">
          {t(takeDown ? "studio.publish.backToPublished" : "studio.publish.backToDrafts")}
        </a>
        <h2 className="mt-3 font-display text-lg font-semibold text-ink-strong">{nameOf(chosen)}</h2>
        <p className="text-sm text-ink-secondary">
          {chosen.tripTitle} · {formatLongDate(chosen.date)} · {tn("studio.publish.photos", chosen.photos, { count: String(chosen.photos) })}
        </p>
        <a href={dayHref(chosen)} className="mt-2 inline-block text-sm font-semibold text-ink-body underline underline-offset-2">
          {t("studio.publish.preview")}
        </a>

        {!takeDown && (
          <dl className="mt-4 space-y-3 rounded-xl border border-line-faint bg-surface-subtle px-4 py-3 text-sm text-ink-body">
            <div>
              <dt className="font-semibold text-ink-strong">{t("studio.publish.whoTitle")}</dt>
              <dd data-audience={chosen.audience}>{t(`studio.publish.who.${chosen.audience}` as TranslationKey)}</dd>
              {readerNames && (
                <dd data-readers className="mt-1">
                  {readerNames.length > 0 ? t("studio.publish.readers", { names: list(readerNames) }) : t("studio.publish.readersNobody")}
                </dd>
              )}
            </div>
            <div>
              <dt className="font-semibold text-ink-strong">{t("studio.publish.tellTitle")}</dt>
              <dd>{t(canTell ? "studio.publish.tell" : "studio.publish.tellOff")}</dd>
            </div>
          </dl>
        )}

        <div className="mt-4">
          <ConfirmPanel
            label={t(takeDown ? "edit.takeDown" : "studio.publish.confirm")}
            question={t(takeDown ? "edit.takeDownQuestion" : "studio.publish.question", { title: nameOf(chosen) })}
            confirmLabel={t(takeDown ? "edit.takeDownConfirm" : "studio.publish.confirm")}
            busyLabel={t(takeDown ? "studio.publish.busyDown" : "studio.publish.busy")}
            tone={takeDown ? "destructive" : "commit"}
            busy={busy}
            error={error}
            onConfirm={() => void commit(chosen)}
            onCancel={() => window.location.assign(listHref)}
            cancelLabel={takeDown ? undefined : t("studio.publish.cancel")}
          >
            {!takeDown && blank.length > 0 && (
              <div data-blank={blank.join(" ")} className="mt-2 space-y-1 text-sm leading-6 text-ink-body">
                <p>{t("studio.publish.blank", { fields: list(sentence) })}</p>
                <details>
                  <summary className="cursor-pointer font-semibold underline underline-offset-2">{t("studio.publish.showAll")}</summary>
                  <ul className="mt-1 space-y-1">
                    {blank.map((field) => (
                      <li key={field} data-blank-field={field} className="flex flex-wrap items-baseline justify-between gap-x-3">
                        <span>{label(field)}</span>
                        {FILLABLE_IN_CHANGE_A_DAY.has(field) && (
                          <a href={editHref} className="font-semibold underline underline-offset-2">
                            {t("studio.publish.fillNow")}
                          </a>
                        )}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1 text-ink-secondary">{t("studio.publish.fillLater")}</p>
                </details>
              </div>
            )}
          </ConfirmPanel>
        </div>
      </>
    );
  }

  return (
    <>
      {missing && (
        <div className="mt-3 rounded-xl border border-coral-300 bg-coral-50 px-4 py-3 text-sm text-ink-body">
          {t("studio.publish.notFound")}
        </div>
      )}

      {rows.length === 0 ? (
        <p className="mt-4 rounded-xl bg-surface-subtle px-4 py-3 text-sm text-ink-secondary">
          {t(takeDown ? "studio.publish.nonePublished" : "studio.publish.noDrafts")}
        </p>
      ) : (
        <>
          {rows.length > SEARCH_FROM && (
            <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-ink-secondary">
              {t("studio.day.edit.searchLabel")}
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("studio.day.edit.searchPlaceholder")}
                className="mt-1 block min-h-11 w-full rounded-xl border border-line-strong bg-surface-base px-3 text-sm text-ink-body"
              />
            </label>
          )}
          {visible.length === 0 && <p className="mt-4 text-sm text-ink-secondary">{t("studio.day.edit.noMatches")}</p>}
          <ul className="mt-4 divide-y divide-line-faint rounded-xl border border-line-strong">
            {visible.map((row) => (
              <li key={`${row.tripId}/${row.slug}`} data-publish-row className="px-4 py-3 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <a href={chooseHref(row)} className="min-w-0 flex-1 hover:underline">
                    <span className="block font-semibold text-ink-strong">{nameOf(row)}</span>
                    <span className="block text-xs text-ink-secondary">
                      {row.tripTitle} · {row.date} · {tn("studio.publish.photos", row.photos, { count: String(row.photos) })}
                    </span>
                  </a>
                  <span className="flex flex-none flex-col items-end gap-1">
                    {!takeDown && (
                      <a href={chooseHref(row)} className="font-semibold text-ink-body underline underline-offset-2">
                        {t("studio.publish.shareRow")}
                      </a>
                    )}
                    <a href={dayHref(row)} className="text-ink-secondary underline underline-offset-2">
                      {t("studio.publish.previewShort")}
                    </a>
                    <button
                      type="button"
                      data-delete-day
                      onClick={() => setDeleting(`${row.tripId}/${row.slug}`)}
                      className="font-semibold text-coral-600 underline underline-offset-2"
                    >
                      {t("studio.delete.button")}
                    </button>
                  </span>
                </div>
                {deleting === `${row.tripId}/${row.slug}` && (
                  <div className="mt-3">
                    <DeleteDayConfirm
                      username={username}
                      day={{ tripId: row.tripId, slug: row.slug, title: nameOf(row), published: takeDown }}
                      onDone={() => setDeleted(row)}
                      onCancel={() => setDeleting(null)}
                    />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      <a
        href={takeDown ? base : `${base}?list=published`}
        className="mt-6 inline-block text-sm font-semibold text-ink-body underline underline-offset-2"
      >
        {t(takeDown ? "studio.publish.toDrafts" : "studio.publish.toTakeDown")}
      </a>
    </>
  );
}
