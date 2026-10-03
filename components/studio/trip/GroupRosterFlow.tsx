"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ConfirmPanel from "@/components/ConfirmPanel";
import StepPrimary from "@/components/studio/StepPrimary";
import SubmitError from "@/components/studio/SubmitError";
import { useI18n } from "@/components/LocaleProvider";
import { journalPath } from "@/lib/journalPath";
import { tripDays } from "@/lib/tripDays";
import type { Roster } from "@/lib/groupRoster";

const INPUT = "mt-1 block w-full rounded-xl border border-line-prominent bg-surface-raised px-3 py-2.5 text-base text-ink-strong";
const EYEBROW = "font-mono text-xs uppercase tracking-wide text-ink-secondary";
const LINK = "text-sm font-semibold text-ink-strong underline underline-offset-2";

/**
 * B2435 slice 1 — the teacher's roster and day-first duty plan. The whole
 * roster is one document saved with one PUT; nothing here is sent to anyone.
 */
export default function GroupRosterFlow({
  username,
  trip,
  initial,
}: {
  username: string;
  trip: { id: string; title: string; start: string; end: string };
  initial: Roster;
}) {
  const { t, tn, locale } = useI18n();
  const router = useRouter();
  const [roster, setRoster] = useState<Roster>(initial);
  const [saved, setSaved] = useState(JSON.stringify(initial));
  const [name, setName] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [didSave, setDidSave] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const days = tripDays(trip.start, trip.end);
  const outside = Object.keys(roster.duty).filter((d) => !days.includes(d)).sort();
  const nameOf = (id: string) => roster.students.find((s) => s.id === id)?.name ?? "";
  const who = (date: string) => (roster.duty[date] ?? []).map(nameOf).join(", ");
  const dayLabel = (date: string) =>
    new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${date}T00:00:00Z`));
  const dirty = JSON.stringify(roster) !== saved;
  const trimmed = name.trim();
  const duplicate = roster.students.some((s) => s.name.toLowerCase() === trimmed.toLowerCase());
  const plannedDays = days.filter((d) => roster.duty[d]?.length).length;

  const setDuty = (date: string, ids: string[]) => {
    const duty = { ...roster.duty };
    if (ids.length) duty[date] = ids;
    else delete duty[date];
    setRoster({ ...roster, duty });
  };
  const add = () => {
    if (!trimmed || duplicate) return;
    setRoster({ ...roster, students: [...roster.students, { id: crypto.randomUUID().replace(/-/g, "").slice(0, 8), name: trimmed }] });
    setName("");
  };
  const remove = (id: string) => {
    const duty: Roster["duty"] = {};
    for (const [d, ids] of Object.entries(roster.duty)) if (ids.some((i) => i !== id)) duty[d] = ids.filter((i) => i !== id);
    setRoster({ students: roster.students.filter((s) => s.id !== id), duty });
    setRemoving(null);
  };
  const dutyOf = (id: string) => Object.keys(roster.duty).filter((d) => roster.duty[d].includes(id)).sort();

  async function save() {
    setBusy(true);
    setProblem(null);
    const res = await fetch(`/api/web/${encodeURIComponent(username)}/trips/${encodeURIComponent(trip.id)}/roster`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(roster),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setProblem(t("studio.groupTrip.saveFailed"));
      return;
    }
    setSaved(JSON.stringify(roster));
    setDidSave(true);
    router.refresh();
  }

  const removingStudent = roster.students.find((s) => s.id === removing);
  const removingDays = removing ? dutyOf(removing) : [];

  return (
    <div>
      <p className="mt-2 text-sm text-ink-secondary">
        <Link href={`${journalPath(username)}/studio/trip?trip=${encodeURIComponent(trip.id)}`} className={LINK}>
          {"‹ "}
          {trip.title}
        </Link>
      </p>
      <p className="mt-4 rounded-xl border border-dashed border-line-strong px-3 py-3 text-sm text-ink-body">{t("studio.groupTrip.notice")}</p>

      <section className="mt-6">
        <h2 className={EYEBROW}>{tn("studio.groupTrip.students", roster.students.length, { count: String(roster.students.length) })}</h2>
        <form
          className="mt-3 flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <label className="block flex-1">
            <span className="text-sm font-semibold text-ink-strong">{t("studio.groupTrip.nameLabel")}</span>
            <input type="text" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} className={INPUT} />
          </label>
          <button
            type="submit"
            disabled={!trimmed || duplicate || roster.students.length >= 60}
            className="min-h-11 rounded-xl bg-yellow-400 px-4 text-sm font-semibold text-yellow-950 disabled:cursor-not-allowed disabled:bg-surface-neutral-strong disabled:text-ink-secondary"
          >
            {t("studio.groupTrip.add")}
          </button>
        </form>
        <p className="mt-1.5 text-sm text-ink-secondary">{duplicate ? t("studio.groupTrip.duplicate", { name: trimmed }) : t("studio.groupTrip.nameHint")}</p>
        <ul className="mt-3">
          {roster.students.map((s) => {
            const d = dutyOf(s.id);
            return (
              <li key={s.id} className="flex min-h-12 items-center justify-between gap-3 border-t border-line-quiet">
                <span className="text-ink-body">
                  <b className="text-ink-strong">{s.name}</b>{" "}
                  <span className="text-sm text-ink-secondary">
                    {"· "}
                    {d.length ? t("studio.groupTrip.writes", { days: d.map(dayLabel).join(", ") }) : t("studio.groupTrip.writesNothing")}
                  </span>
                </span>
                <button
                  type="button"
                  aria-label={t("studio.groupTrip.removeAria", { name: s.name })}
                  onClick={() => (d.length ? setRemoving(s.id) : remove(s.id))}
                  className="min-h-10 shrink-0 rounded-full border border-line-strong px-3 text-sm font-semibold text-ink-secondary"
                >
                  {t("studio.groupTrip.remove")}
                </button>
              </li>
            );
          })}
        </ul>
        {removingStudent && (
          <div className="mt-3">
            <ConfirmPanel
              label={t("studio.groupTrip.remove")}
              question={t("studio.groupTrip.removeQuestion", { name: removingStudent.name, days: removingDays.map(dayLabel).join(", ") })}
              confirmLabel={t("studio.groupTrip.removeConfirm", { name: removingStudent.name })}
              tone="destructive"
              onConfirm={() => remove(removingStudent.id)}
              onCancel={() => setRemoving(null)}
            />
          </div>
        )}
      </section>

      <section className="mt-6 border-t border-line-quiet pt-6">
        <h2 className={EYEBROW}>{tn("studio.groupTrip.plan", days.length, { planned: String(plannedDays), days: String(days.length) })}</h2>
        {roster.students.length === 0 ? (
          <p className="mt-3 text-sm text-ink-secondary">{t("studio.groupTrip.addFirst")}</p>
        ) : (
          <ul className="mt-3 grid gap-2">
            {days.map((date) => {
              const isOpen = open === date;
              return (
                <li key={date} className={`rounded-2xl bg-surface-raised px-4 py-3 ${isOpen ? "border-2 border-ink-strong" : "border border-line-strong"}`}>
                  <b className="block text-ink-strong">{dayLabel(date)}</b>
                  <span className="block text-sm text-ink-secondary">{who(date) || t("studio.groupTrip.nobody")}</span>
                  {isOpen ? (
                    <fieldset className="mt-2.5">
                      <legend className="text-sm font-semibold text-ink-strong">{t("studio.groupTrip.whoWrites", { day: dayLabel(date) })}</legend>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {roster.students.map((s) => {
                          const on = roster.duty[date]?.includes(s.id) ?? false;
                          return (
                            <label
                              key={s.id}
                              className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-3.5 text-sm font-semibold text-ink-strong ${
                                on ? "border-2 border-ink-strong bg-surface-subtle" : "border-line-strong bg-surface-raised"
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={on}
                                className="h-4 w-4"
                                onChange={() => setDuty(date, on ? roster.duty[date].filter((i) => i !== s.id) : [...(roster.duty[date] ?? []), s.id])}
                              />
                              {s.name}
                            </label>
                          );
                        })}
                      </div>
                      <button type="button" onClick={() => setOpen(null)} className={`${LINK} mt-2 min-h-11`}>
                        {t("studio.groupTrip.done")}
                      </button>
                    </fieldset>
                  ) : (
                    <button type="button" onClick={() => setOpen(date)} className={`${LINK} mt-1 min-h-11`}>
                      {t(roster.duty[date]?.length ? "studio.groupTrip.change" : "studio.groupTrip.choose")}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {outside.length > 0 && (
        <section className="mt-6 border-t border-line-quiet pt-6">
          <h2 className={EYEBROW}>{t("studio.groupTrip.outside")}</h2>
          <p className="mt-1 text-sm text-ink-secondary">{t("studio.groupTrip.outsideHint")}</p>
          <ul className="mt-3">
            {outside.map((date) => (
              <li key={date} className="flex min-h-12 items-center justify-between gap-3 border-t border-line-quiet">
                <span className="text-ink-body">
                  <b className="text-ink-strong">{dayLabel(date)}</b> <span className="text-sm text-ink-secondary">· {who(date)}</span>
                </span>
                <button type="button" onClick={() => setDuty(date, [])} className="min-h-10 rounded-full border border-line-strong px-3 text-sm font-semibold text-ink-secondary">
                  {t("studio.groupTrip.remove")}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="mt-6">
        <StepPrimary disabled={!dirty} busy={busy} shake={problem} onClick={() => void save()} label={t("me.journalSave")} tone="bg-yellow-400 text-yellow-950 hover:bg-yellow-300" />
        {!dirty && didSave && (
          <p role="status" className="mt-2 text-sm text-ink-secondary">
            {t("studio.planReaders.saved")}
          </p>
        )}
      </div>
      <SubmitError message={problem} />
    </div>
  );
}
