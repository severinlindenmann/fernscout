"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import ConfirmPanel from "@/components/ConfirmPanel";
import DeleteTrip from "@/components/DeleteTrip";
import StepPrimary from "@/components/studio/StepPrimary";
import SubmitError from "@/components/studio/SubmitError";
import TripPicker from "@/components/studio/trip/TripPicker";
import RouteRecordSection from "@/components/studio/trip/RouteRecordSection";
import { PlanReadersChoice } from "@/components/studio/trip/TripPlanReadersFlow";
import { useI18n } from "@/components/LocaleProvider";
import type { TranslationKey } from "@/lib/i18n";
import type { PlanReaders } from "@/lib/types";
import type { TripEditPanel } from "@/lib/studio/tripEdit";
import { slugify } from "@/lib/tripId";
import DateField from "@/components/studio/DateField";

const INPUT = "mt-1 block w-full rounded-xl border border-line-prominent bg-surface-raised px-3 py-2.5 text-base text-ink-strong";
const EYEBROW = "font-mono text-xs uppercase tracking-wide text-ink-secondary";

/**
 * The trip's address — B2015's rename, a section of Edit a trip since B2072
 * (`/studio/trip/rename` redirects here). A separate, outward-facing write —
 * every link to the trip changes — so it keeps its own ConfirmPanel-backed
 * "Rename it" rather than riding on the page's Save.
 */
function AddressSection({
  username,
  trip,
  trips,
}: {
  username: string;
  trip: { id: string; title: string };
  trips: { id: string }[];
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [newId, setNewId] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [renamedTo, setRenamedTo] = useState<string | null>(null);

  // B2139 — whatever is typed becomes a slug suggestion rather than a
  // refusal ("Ungarn 2026!" → ungarn-2026); the server still checks it.
  const trimmed = slugify(newId);
  const valid = trimmed.length > 0 && trimmed !== trip.id;
  const path = (id: string) => `/${username}/trips/${id}`;
  const taken = trips.some((other) => other.id === trimmed);

  async function commit() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/web/${encodeURIComponent(username)}/trips/${encodeURIComponent(trip.id)}/rename`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: trimmed }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setError(t("studio.tripRename.writeFailed.message"));
      return;
    }
    const body = (await res.json().catch(() => ({}))) as { id?: string };
    const id = body.id ?? trimmed;
    setRenamedTo(id);
    setConfirming(false);
    setNewId("");
    // The page's other sections now address the trip by its new id.
    router.replace(`/${username}/studio/trip?trip=${encodeURIComponent(id)}&section=address`, { scroll: false });
  }

  if (renamedTo) {
    return (
      <div role="status" className="mt-3 rounded-2xl border border-green-500/40 bg-green-100 px-4 py-3 text-sm text-ink-strong">
        {t("studio.tripRename.done.banner", { title: trip.title, path: path(renamedTo) })}{" "}
        <a href={`/${username}/trips/${renamedTo}`} className="font-semibold underline underline-offset-2">
          {t("studio.tripRename.done.openTrip")}
        </a>
      </div>
    );
  }

  return (
    <div className="mt-3">
      <p className="text-sm text-ink-secondary">{t("studio.tripRename.currentId", { path: path(trip.id) })}</p>
      <label className="mt-3 block text-sm font-semibold text-ink-strong" htmlFor="new-trip-id">
        {t("studio.tripRename.newIdLabel")}
      </label>
      <input
        id="new-trip-id"
        type="text"
        value={newId}
        disabled={confirming}
        onChange={(e) => setNewId(e.target.value)}
        placeholder={trip.id}
        className={INPUT}
      />
      {newId.trim().length > 0 && (
        <p className="mt-2 break-words text-sm text-ink-secondary">
          {taken
            ? t("studio.tripRename.taken", { path: path(trimmed) })
            : valid
              ? t(trimmed === newId.trim() ? "studio.tripRename.preview" : "studio.tripRename.suggested", { path: path(trimmed) })
              : t(trimmed === trip.id ? "studio.tripRename.same" : "studio.tripRename.invalid")}
        </p>
      )}
      <p className="mt-2 text-xs text-ink-secondary">{t("studio.tripRename.redirectNote")}</p>
      {confirming ? (
        <div className="mt-3">
          <ConfirmPanel
            label={t("studio.tripRename.confirm.label")}
            question={t("studio.tripRename.confirm.question", { from: trip.id, to: trimmed })}
            details={t("studio.tripRename.confirm.details")}
            confirmLabel={t("studio.tripRename.confirm.confirmLabel")}
            busyLabel={t("studio.tripRename.confirm.busyLabel")}
            busy={busy}
            error={error ?? undefined}
            onConfirm={commit}
            onCancel={() => setConfirming(false)}
          />
        </div>
      ) : (
        <button
          type="button"
          disabled={!valid || taken}
          onClick={() => setConfirming(true)}
          className="mt-3 min-h-11 rounded-full border border-line-strong px-5 text-base font-semibold text-ink-strong hover:bg-surface-subtle disabled:opacity-50"
        >
          {t("studio.tripRename.showMe")}
        </button>
      )}
    </div>
  );
}

/**
 * `/[user]/studio/trip?trip=<id>` — B2018, one page since B2072. Every
 * section that changes one trip, in order: title and subtitle, dates, who may
 * read it (a link to its own page, with the current answer shown), who sees
 * the plan (plannable trips only), the address, and — last — deleting it.
 *
 * One Save in the bar covers the sections above it (title, subtitle, dates,
 * plan readers). The address and the delete are separate, irreversible
 * writes, each behind its own ConfirmPanel. Without `?trip=` on a multi-trip
 * journal only the picker shows; once a trip is chosen, the picker collapses
 * to one "choose another trip" link. The frame and title are `StudioPage`'s.
 */
export default function TripEditFlow({
  username,
  trips,
  trip,
  section,
  routeRecordingAvailable,
  homeZoneReady,
}: {
  username: string;
  trips: { id: string; title: string }[];
  /** Absent when the journal has more than one trip and none was named in
   *  `?trip=` — the picker alone is shown. */
  trip?: TripEditPanel;
  /** `?section=` — the one to scroll to on arrival (`address` from the old
   *  rename route). */
  section?: string;
  /** `isEnabled("routeRecording", user)`, read server-side — B2198. The
   *  section itself also checks `useNativeShell()`, so a browser never sees
   *  it, capability on or off. */
  routeRecordingAvailable?: boolean;
  /** `hasHomeZoneOrDeclined(user)` — B2203's arming question. */
  homeZoneReady?: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [title, setTitle] = useState(trip?.title ?? "");
  const [tagline, setTagline] = useState(trip?.tagline ?? "");
  const [start, setStart] = useState(trip?.start ?? "");
  const [end, setEnd] = useState(trip?.end ?? "");
  const [readers, setReaders] = useState<PlanReaders>(trip?.planReaders ?? "map");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Choosing a trip lands at the top of it, not wherever the picker was.
  useEffect(() => {
    if (!trip) return;
    const target = section ? document.getElementById(`section-${section}`) : null;
    if (target) target.scrollIntoView();
    else window.scrollTo(0, 0);
    // Only on arriving at a trip; a rename keeps the same place on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!trip) return <TripPicker base={`/${username}/studio/trip`} trips={trips} />;

  const detailsDirty = title.trim() !== trip.title || tagline.trim() !== trip.tagline || start !== trip.start || end !== trip.end;
  const readersDirty = trip.hasPlan && readers !== trip.planReaders;

  async function save() {
    if (!trip) return;
    setBusy(true);
    setProblem(null);
    setSaved(false);
    const base = `/api/web/${encodeURIComponent(username)}/trips/${encodeURIComponent(trip.id)}`;
    const patch = (url: string, body: unknown) =>
      fetch(url, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);
    // v2 carries a trip's dates as one object (`dates: {from, to}`).
    const sent: (Response | null)[] = [];
    if (detailsDirty) sent.push(await patch(base, { title, tagline, dates: { from: start, to: end } }));
    if (readersDirty && sent.every((r) => r?.ok)) sent.push(await patch(`${base}/plan-readers`, { readers }));
    setBusy(false);
    const failed = sent.find((r) => !r?.ok);
    if (failed !== undefined) {
      const said = (await failed?.json().catch(() => null)) as { message?: string } | null;
      setProblem(said?.message ?? t("me.journalFailed"));
      return;
    }
    setSaved(true);
    router.refresh();
  }

  return (
    <div>
      {trips.length > 1 && (
        <p className="mt-2 text-sm text-ink-secondary">
          /{trip.id} ·{" "}
          <Link href={`/${username}/studio/trip`} className="font-semibold text-ink-strong underline underline-offset-2">
            {t("studio.tripEdit.otherTrip")}
          </Link>
        </p>
      )}

      <section className="mt-6">
        <h2 className={EYEBROW}>{t("studio.tripEdit.section.details")}</h2>
        <label className="mt-3 block">
          <span className="text-sm font-semibold text-ink-strong">{t("me.tripTitle")}</span>
          <input type="text" value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} className={INPUT} />
        </label>
        <label className="mt-3 block">
          <span className="text-sm font-semibold text-ink-strong">{t("me.tripTagline")}</span>
          <input type="text" value={tagline} maxLength={300} onChange={(e) => setTagline(e.target.value)} className={INPUT} />
        </label>
      </section>

      <section className="mt-6 border-t border-line-quiet pt-6">
        <h2 className={EYEBROW}>{t("studio.tripEdit.section.dates")}</h2>
        <DateField
          labelClassName="block text-sm font-semibold text-ink-strong"
          range={{
            start,
            end,
            onChange: (first, last) => {
              setStart(first);
              setEnd(last);
            },
            startLabel: t("studio.newTrip.gather1.startLabel"),
            endLabel: t("studio.newTrip.gather1.endLabel"),
            endError: start && end && end < start ? t("studio.newTrip.gather1.endBeforeStart") : undefined,
          }}
        />
      </section>

      <section id="section-readers" className="mt-6 border-t border-line-quiet pt-6">
        <h2 className={EYEBROW}>{t("me.tripWho")}</h2>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <span className="inline-flex min-h-8 items-center rounded-full border border-line-strong bg-surface-subtle px-3 text-sm font-semibold text-ink-strong">
            {t(`studio.visibility.${trip.visibility}.title` as TranslationKey)}
          </span>
          <Link
            href={`/${username}/studio/trip/visibility?trip=${encodeURIComponent(trip.id)}`}
            className="text-sm font-semibold text-ink-strong underline underline-offset-2"
          >
            {t("studio.tripEdit.readers.change")}
          </Link>
        </div>
      </section>

      {trip.hasPlan && (
        <section id="section-plan" className="mt-6 border-t border-line-quiet pt-6">
          <h2 className={`${EYEBROW} mb-3`}>{t("studio.hub.item.planReaders.title")}</h2>
          <PlanReadersChoice
            levels={trip.planLevels}
            current={trip.planReaders}
            chosen={readers}
            costsPublic={trip.costsPublic}
            onChoose={setReaders}
          />
        </section>
      )}

      <div className="mt-6">
        <StepPrimary
          disabled={!(detailsDirty || readersDirty) || title.trim() === ""}
          busy={busy}
          onClick={() => void save()}
          label={t("me.journalSave")}
          tone="bg-yellow-400 text-yellow-950 hover:bg-yellow-300"
        />
        {saved && !problem && (
          <p role="status" className="mt-2 text-sm text-ink-secondary">
            {t("studio.planReaders.saved")}
          </p>
        )}
      </div>

      {routeRecordingAvailable && (
        <RouteRecordSection
          username={username}
          trip={{ id: trip.id, title: trip.title, start: trip.start, end: trip.end }}
          homeZoneReady={homeZoneReady ?? false}
        />
      )}

      <section id="section-address" className="mt-8 border-t border-line-quiet pt-6">
        <h2 className={EYEBROW}>{t("studio.tripEdit.section.address")}</h2>
        <AddressSection username={username} trip={{ id: trip.id, title: trip.title }} trips={trips} />
      </section>

      <section id="section-delete" className="mt-8 border-t border-line-quiet pt-6">
        <h2 className={EYEBROW}>{t("studio.tripEdit.section.delete")}</h2>
        <DeleteTrip username={username} tripId={trip.id} />
      </section>
      <SubmitError message={problem} />
    </div>
  );
}
