"use client";

import { useState } from "react";
import BusyButton from "@/components/BusyButton";
import { useI18n } from "./LocaleProvider";
import type { Day, Entry } from "@/lib/types";

/** The fields of one update, as the panel holds them while they are typed. */
type Draft = {
  title: string;
  time: string;
  location: string;
  visibility: "" | "guest" | "private";
  content: string;
  /** `{ [locale]: { title, content } }` — only the languages this update
   *  already carries. The panel adds no language a day does not have. */
  translations: Record<string, { title: string; content: string }>;
};

const FIELD =
  "w-full rounded-lg border border-navy-200 bg-white px-3 py-2 text-sm text-navy-900 focus:border-navy-500 focus:outline-none";

function draftOf(entry: Entry): Draft {
  return {
    title: entry.title ?? "",
    time: entry.time ?? "",
    location: entry.location ?? "",
    visibility: entry.visibility ?? "",
    content: entry.content ?? "",
    translations: Object.fromEntries(
      Object.entries(entry.translations ?? {}).map(([code, said]) => [
        code,
        { title: said?.title ?? "", content: said?.content ?? "" },
      ]),
    ),
  };
}

/**
 * The owner correcting their own day, on the day — B980.
 *
 * "Correct or take down" used to be a link to `/agent/<user>`: the owner,
 * standing on the day, with the sentence they wanted to fix in front of them,
 * was taken to another page which re-asked the day from the beginning through
 * a model. For "the time was 14:00, not 15:00" that is a conversation where a
 * keystroke would do.
 *
 * **This is not a CMS, and the distinction is not a technicality.** Decision
 * 24 says a day is not composed in a browser out of form fields, and nothing
 * here composes one: there is no "new day", no upload widget with its own idea
 * of what a day is, and no field this panel can write that the day does not
 * already have. It corrects what an agent wrote, in place, for the person who
 * lived it — the same thing `PATCH .../days/<slug>` has done since B266,
 * reached from where the mistake is visible.
 *
 * **It cannot publish and it cannot unpublish.** That is B28's separation and
 * it holds here exactly as it holds for an agent: writing and putting on the
 * site are two decisions, and this panel makes only the first.
 *
 * Every write goes to `/<user>/trips/<trip>/day/<slug>/edit`, which is the
 * owner's cookie door onto the same validator and the same writer. One call
 * per update actually changed — a day with three updates where one word moved
 * writes one file.
 */
export default function EditDay({
  username,
  tripId,
  day,
  onClose,
}: {
  username: string;
  tripId: string;
  day: Day;
  onClose: () => void;
}) {
  const { t, formatLongDate } = useI18n();
  const [date, setDate] = useState(day.date);
  const [drafts, setDrafts] = useState<Draft[]>(() => day.entries.map(draftOf));
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const set = (at: number, patch: Partial<Draft>) =>
    setDrafts((prev) =>
      prev.map((draft, i) => (i === at ? { ...draft, ...patch } : draft)),
    );

  /** What this update would send — only the fields whose value actually moved,
   *  so an untouched day writes nothing and an untouched field is not
   *  rewritten into the file it came from. */
  function changesFor(at: number): Record<string, unknown> {
    const was = draftOf(day.entries[at]);
    const now = drafts[at];
    const patch: Record<string, unknown> = {};
    if (now.title !== was.title) patch.title = now.title;
    if (now.time !== was.time) patch.time = now.time;
    if (now.location !== was.location) patch.location = now.location;
    if (now.content !== was.content) patch.content = now.content;
    // `visibility: null` is how the writer is told "back to whatever the trip
    // says" — an empty string would be a value, and there is no empty one.
    if (now.visibility !== was.visibility)
      patch.visibility = now.visibility || null;
    if (JSON.stringify(now.translations) !== JSON.stringify(was.translations)) {
      patch.translations = now.translations;
    }
    // The date belongs to the day rather than to one update, so a change to it
    // goes to every update of the day — otherwise half a day moves.
    if (date !== day.date) patch.date = date;
    return patch;
  }

  async function save() {
    setFailed(null);
    setBusy(true);
    for (const [at, entry] of day.entries.entries()) {
      const patch = changesFor(at);
      if (Object.keys(patch).length === 0) continue;
      const response = await fetch(
        `/${encodeURIComponent(username)}/trips/${encodeURIComponent(tripId)}/day/${encodeURIComponent(entry.slug)}/edit`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(patch),
        },
      ).catch(() => null);
      if (!response?.ok) {
        setBusy(false);
        setFailed(entry.slug);
        return;
      }
    }
    // The day on screen came from `/<user>/story.json`, which this page fetched
    // and holds in state; there is no server render to revalidate. Rather than
    // teach the pager to re-fetch one day, ask the browser for the page again —
    // it happens once, after a deliberate press, and it is the one thing that
    // cannot show a stale day.
    window.location.reload();
  }

  return (
    <section
      aria-label={t("edit.heading")}
      className="mt-3 rounded-xl border border-navy-200 bg-white p-3"
    >
      <p className="font-display text-sm font-semibold text-navy-900">
        {t("edit.heading")}
      </p>
      <p className="mt-0.5 text-xs leading-5 text-navy-600">{t("edit.body")}</p>

      <label className="mt-3 block">
        <span className="text-xs font-semibold text-navy-700">
          {t("edit.date")}
        </span>
        <input
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
          className={`mt-1 ${FIELD}`}
        />
      </label>

      {drafts.map((draft, at) => (
        <div
          key={day.entries[at].slug}
          className="mt-4 border-t border-navy-200 pt-3"
        >
          {day.entries.length > 1 && (
            <p className="text-xs font-semibold text-navy-500">
              {formatLongDate(day.date)} · {at + 1}/{day.entries.length}
            </p>
          )}

          <label className="mt-2 block">
            <span className="text-xs font-semibold text-navy-700">
              {t("edit.title")}
            </span>
            <input
              value={draft.title}
              onChange={(event) => set(at, { title: event.target.value })}
              className={`mt-1 ${FIELD}`}
            />
          </label>

          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <label className="block">
              <span className="text-xs font-semibold text-navy-700">
                {t("edit.time")}
              </span>
              <input
                value={draft.time}
                placeholder="14:00"
                onChange={(event) => set(at, { time: event.target.value })}
                className={`mt-1 ${FIELD}`}
              />
            </label>
            <label className="block">
              <span className="text-xs font-semibold text-navy-700">
                {t("edit.place")}
              </span>
              <input
                value={draft.location}
                onChange={(event) => set(at, { location: event.target.value })}
                className={`mt-1 ${FIELD}`}
              />
            </label>
          </div>

          <label className="mt-2 block">
            <span className="text-xs font-semibold text-navy-700">
              {t("edit.text")}
            </span>
            <textarea
              rows={10}
              value={draft.content}
              onChange={(event) => set(at, { content: event.target.value })}
              className={`mt-1 ${FIELD} font-mono leading-6`}
            />
          </label>

          {Object.entries(draft.translations).map(([code, said]) => (
            <div key={code} className="mt-2 rounded-lg bg-cream-100 p-2">
              <p className="text-xs font-semibold text-navy-700">
                {t("edit.inLanguage", { language: code.toUpperCase() })}
              </p>
              <input
                value={said.title}
                onChange={(event) =>
                  set(at, {
                    translations: {
                      ...draft.translations,
                      [code]: { ...said, title: event.target.value },
                    },
                  })
                }
                className={`mt-1 ${FIELD}`}
              />
              <textarea
                rows={6}
                value={said.content}
                onChange={(event) =>
                  set(at, {
                    translations: {
                      ...draft.translations,
                      [code]: { ...said, content: event.target.value },
                    },
                  })
                }
                className={`mt-1 ${FIELD} font-mono leading-6`}
              />
            </div>
          ))}

          {/* A label narrows and never widens — B632. There is no "public"
              here for that reason: the trip's own visibility is the ceiling
              and this can only sit under it. */}
          <label className="mt-2 block">
            <span className="text-xs font-semibold text-navy-700">
              {t("edit.whoSees")}
            </span>
            <select
              value={draft.visibility}
              onChange={(event) =>
                set(at, {
                  visibility: event.target.value as Draft["visibility"],
                })
              }
              className={`mt-1 ${FIELD}`}
            >
              <option value="">{t("edit.seenAsTrip")}</option>
              <option value="guest">{t("agent.tool.visibilityGuest")}</option>
              <option value="private">
                {t("agent.tool.visibilityPrivate")}
              </option>
            </select>
          </label>
        </div>
      ))}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <BusyButton
          busy={busy}
          type="button"
          onClick={save}
          className="min-h-11 rounded-full bg-yellow-400 px-4 text-xs font-semibold text-yellow-950 transition-colors hover:bg-yellow-300 disabled:opacity-50"
        >
          {t("edit.save")}
        </BusyButton>
        <BusyButton
          busy={busy}
          type="button"
          onClick={onClose}
          className="min-h-11 rounded-full border border-navy-300 px-4 text-xs font-semibold text-navy-700 transition-colors hover:bg-cream-100 disabled:opacity-50"
        >
          {t("edit.cancel")}
        </BusyButton>
      </div>

      {failed && (
        <p role="alert" className="mt-2 text-xs text-coral-700">
          {t("edit.failed")}
        </p>
      )}
    </section>
  );
}
