"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

const LIBRARY_PREVIEW_FIGURES = 6;
const LIBRARY_PREVIEW_TRIPS = 3;
import BusyButton from "@/components/BusyButton";
import ConfirmPanel from "@/components/ConfirmPanel";
import { useI18n } from "@/components/LocaleProvider";
import FigureCreator from "@/components/studio/figures/FigureCreator";
import StepPrimary from "@/components/studio/StepPrimary";
import SubmitError from "@/components/studio/SubmitError";
import type { FigureDoc } from "@/lib/api/v2/schemas/figures";
import type { FigureTripRow } from "@/lib/figures";
import { moveFigureInSet } from "@/lib/figures/order";
import type { TranslationKey } from "@/lib/i18n";

type Contact = { name: string; email: string };

type ReferencedBy = { journal: boolean; trips: string[] };

/** Which screen the page shows — one at a time, the same "one screen owns
 *  the moment" shape every other studio flow here uses. `returnTo` is only
 *  ever `"library"` or `"trip"`: the trip picker's own "+ New figure" (for a
 *  person on the trip with none yet) has to land back on that trip, not on
 *  the library, once the creator's `onSaved` fires. */
type View =
  | { kind: "library" }
  | { kind: "newWho"; returnTo: "library" | { tripId: string } }
  | { kind: "create"; person: { name: string; email?: string }; returnTo: "library" | { tripId: string } }
  | { kind: "edit"; id: string }
  | { kind: "editCreate"; id: string }
  | { kind: "trip"; tripId: string };

function previewSrc(username: string, figure: Partial<FigureDoc>, size: number): string {
  const { id: _id, name: _name, person: _person, ...appearance } = figure;
  return `/api/v2/${encodeURIComponent(username)}/figures/preview?figure=${encodeURIComponent(
    JSON.stringify(appearance),
  )}&size=${size}`;
}

/** 44×70 — the grid's own preview size (fix: previews were unspecified and
 *  inconsistent). `size` (the render request) is roughly double the
 *  displayed pixels, for a sharp image on a retina screen. */
function GridPreview({ username, figure }: { username: string; figure: Partial<FigureDoc> }) {
  return (
    <img
      src={previewSrc(username, figure, 88)}
      alt=""
      width={44}
      height={70}
      className="pointer-events-none"
    />
  );
}

/** 28×45 — the smaller preview every list (the journal's set, a trip's
 *  party) uses beside a name, never the grid's own 44×70. */
function SmallPreview({ username, figure, alt = "" }: { username: string; figure: Partial<FigureDoc>; alt?: string }) {
  return <img src={previewSrc(username, figure, 56)} alt={alt} width={28} height={45} aria-hidden={alt === ""} />;
}

const chipClass = (active: boolean) =>
  `inline-flex min-h-11 items-center gap-1 rounded-full border px-3 text-sm font-semibold ${
    active ? "border-ink-strong bg-ink-strong text-on-action" : "border-line-strong text-ink-secondary"
  }`;

/** An icon-only chip — the reorder arrows — at least 44×44, not merely
 *  44 tall (a square arrow button is easy to miss the width of when only
 *  height is guaranteed). */
const arrowChipClass =
  "flex min-h-11 min-w-11 items-center justify-center rounded-full border border-line-strong text-ink-secondary disabled:opacity-40";

const secondaryButtonClass =
  "min-h-11 rounded-full border border-line-strong px-5 text-base font-semibold text-ink-body hover:bg-surface-subtle";

const primaryButtonClass =
  "min-h-11 rounded-full bg-action-strong px-5 text-base font-semibold text-on-action hover:bg-action-strong-hover disabled:opacity-50";

const backLinkClass = "flex min-h-11 items-center text-sm font-semibold text-ink-secondary";

function statusKey(status: FigureTripRow["status"]): TranslationKey {
  if (status === "current") return "trips.now";
  if (status === "upcoming") return "trips.upcoming";
  return "trips.past";
}

/**
 * `/[user]/studio/figures` — B2022. The library (make, rename, who-this-is,
 * delete), the journal's default set (toggle + order), and, per trip, the
 * journal's set / nobody / its own party.
 *
 * Every write goes through one of the three owner-cookie web doors this
 * ticket adds: `PUT`/`DELETE .../figures/{id}` (existing, from B2021, now
 * with a delete), `PATCH .../figures/set` (the journal's own set) and
 * `PATCH .../trips/{trip}/figures` (one trip's own party). Nothing here
 * calls `/api/v2/**` directly — the same boundary every other studio
 * component keeps (AGENTS.md: "agent bearer tokens reach `/api/**`, not
 * rendered owner pages").
 *
 * Fixed width: `StudioPage`'s `max-w-xl` column and `px-4` gutter (B2068),
 * like every studio page — not a full-bleed grid, which had no page gutter
 * on a phone (review finding).
 */
export default function FigureLibrary({
  username,
  initialFigures,
  contacts,
  initialJournalSet,
  trips: initialTrips,
  photoConsent,
  photoCredits,
}: {
  username: string;
  initialFigures: FigureDoc[];
  contacts: Contact[];
  /** The journal's own default set, in walking order — empty for "nobody
   *  walks by default", the same reading a missing/`{mode:"off"}` config
   *  gets (`app/[user]/studio/figures/page.tsx`). */
  initialJournalSet: string[];
  trips: FigureTripRow[];
  photoConsent: boolean;
  photoCredits: number;
}) {
  const { t, tn } = useI18n();
  const [figures, setFigures] = useState<FigureDoc[]>(initialFigures);
  const [journalSet, setJournalSet] = useState<string[]>(initialJournalSet);
  const [trips, setTrips] = useState<FigureTripRow[]>(initialTrips);
  const [view, setView] = useState<View>({ kind: "library" });
  // The library leads with the latest few; the rest wait behind one button.
  const [allFigures, setAllFigures] = useState(false);
  const [allTrips, setAllTrips] = useState(false);
  const shownFigures = allFigures ? figures : figures.slice(0, LIBRARY_PREVIEW_FIGURES);
  const shownTrips = allTrips ? trips : trips.slice(0, LIBRARY_PREVIEW_TRIPS);

  const byId = useMemo(() => new Map(figures.map((f) => [f.id, f])), [figures]);
  const contactByEmail = useMemo(() => new Map(contacts.map((c) => [c.email, c])), [contacts]);

  function personLabel(figure: FigureDoc): string {
    if (!figure.person) return t("studio.figures.library.noPerson");
    return contactByEmail.get(figure.person)?.name ?? "";
  }

  // Newest first, the same order the page's server read uses — so what was
  // just made or changed leads the grid instead of sorting past "Show all".
  function upsertFigure(doc: FigureDoc) {
    setFigures((prev) => [doc, ...prev.filter((f) => f.id !== doc.id)]);
  }

  // B2089: after the creator saves, the library says so and brings the new
  // figure into view.
  const [justSaved, setJustSaved] = useState<FigureDoc | null>(null);
  useEffect(() => {
    if (!justSaved || view.kind !== "library") return;
    document.getElementById(`figure-${justSaved.id}`)?.scrollIntoView?.({ block: "center" });
  }, [justSaved, view.kind]);

  // ── the journal's set ────────────────────────────────────────────────
  const [setSaving, setSetSaving] = useState(false);
  const [setSaved, setSetSaved] = useState(false);
  const [setError, setSetError] = useState<string | null>(null);

  async function saveJournalSet(next: string[]) {
    setJournalSet(next);
    setSetSaving(true);
    setSetSaved(false);
    setSetError(null);
    try {
      const body =
        next.length > 0 ? { figures: { mode: "set", figures: next } } : { figures: { mode: "off" } };
      const res = await fetch(`/api/web/${encodeURIComponent(username)}/figures/set`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) setSetSaved(true);
      else setSetError(t("studio.figures.set.error"));
    } catch {
      setSetError(t("studio.figures.set.error"));
    } finally {
      setSetSaving(false);
    }
  }

  function toggleInSet(id: string) {
    const included = journalSet.includes(id);
    void saveJournalSet(included ? journalSet.filter((x) => x !== id) : [...journalSet, id]);
  }

  function moveInSet(id: string, direction: "up" | "down") {
    void saveJournalSet(moveFigureInSet(journalSet, id, direction));
  }

  // ── delete ───────────────────────────────────────────────────────────
  const [deleteConfirming, setDeleteConfirming] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteRefusal, setDeleteRefusal] = useState<ReferencedBy | null>(null);

  async function confirmDelete(id: string) {
    setDeleteBusy(true);
    setDeleteRefusal(null);
    try {
      const res = await fetch(`/api/web/${encodeURIComponent(username)}/figures/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      const json = (await res.json().catch(() => null)) as
        | { deleted?: string; error?: string; details?: ReferencedBy }
        | null;
      if (res.ok) {
        setFigures((prev) => prev.filter((f) => f.id !== id));
        setJournalSet((prev) => prev.filter((x) => x !== id));
        setDeleteConfirming(false);
        setView({ kind: "library" });
        return;
      }
      if (json?.error === "figure_referenced" && json.details) {
        setDeleteRefusal(json.details);
        return;
      }
    } finally {
      setDeleteBusy(false);
    }
  }

  // ── per-trip party ───────────────────────────────────────────────────
  const [tripSaving, setTripSaving] = useState(false);
  const [tripError, setTripError] = useState<string | null>(null);

  async function saveTrip(tripId: string, mode: "journal" | "off" | "custom", ids: string[]) {
    setTripSaving(true);
    setTripError(null);
    try {
      const figuresField = mode === "custom" ? { mode: "custom", figures: ids } : { mode };
      const res = await fetch(
        `/api/web/${encodeURIComponent(username)}/trips/${encodeURIComponent(tripId)}/figures`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ figures: figuresField }),
        },
      );
      if (!res.ok) {
        setTripError(t("studio.figures.trip.error"));
        return;
      }
      setTrips((prev) =>
        prev.map((row) =>
          row.id === tripId ? { ...row, answer: mode, figures: mode === "custom" ? ids : [] } : row,
        ),
      );
      setView({ kind: "library" });
    } finally {
      setTripSaving(false);
    }
  }

  function referencedBy(figureId: string): ReferencedBy {
    return {
      journal: journalSet.includes(figureId),
      trips: trips.filter((row) => row.answer === "custom" && row.figures.includes(figureId)).map((row) => row.id),
    };
  }

  if (view.kind === "newWho") {
    return (
      <>
        <NewWhoScreen
          contacts={contacts}
          onCancel={() => setView(view.returnTo === "library" ? { kind: "library" } : { kind: "trip", tripId: view.returnTo.tripId })}
          onContinue={(person) => setView({ kind: "create", person, returnTo: view.returnTo })}
        />
      </>
    );
  }

  if (view.kind === "create") {
    return (
      <>
        <FigureCreator
          username={username}
          initial={null}
          person={view.person}
          photoConsent={photoConsent}
          photoCredits={photoCredits}
          existingIds={figures.map((f) => f.id)}
          onSaved={(doc) => {
            upsertFigure(doc);
            setJustSaved(doc);
            setView(view.returnTo === "library" ? { kind: "library" } : { kind: "trip", tripId: view.returnTo.tripId });
          }}
          onCancel={() => setView(view.returnTo === "library" ? { kind: "library" } : { kind: "trip", tripId: view.returnTo.tripId })}
        />
      </>
    );
  }

  if (view.kind === "editCreate") {
    const figure = byId.get(view.id);
    if (!figure) {
      setView({ kind: "library" });
      return null;
    }
    return (
      <>
        <FigureCreator
          username={username}
          initial={figure}
          person={null}
          photoConsent={photoConsent}
          photoCredits={photoCredits}
          existingIds={figures.map((f) => f.id)}
          onSaved={(doc) => {
            upsertFigure(doc);
            setView({ kind: "edit", id: doc.id });
          }}
          onCancel={() => setView({ kind: "edit", id: view.id })}
        />
      </>
    );
  }

  if (view.kind === "edit") {
    const figure = byId.get(view.id);
    if (!figure) {
      setView({ kind: "library" });
      return null;
    }
    return (
      <>
        <EditScreen
          username={username}
          figure={figure}
          contacts={contacts}
          trips={trips}
          referencedBy={referencedBy(figure.id)}
          onSaved={(doc) => upsertFigure(doc)}
          onChangeLooks={() => setView({ kind: "editCreate", id: figure.id })}
          onBack={() => {
            setDeleteConfirming(false);
            setDeleteRefusal(null);
            setView({ kind: "library" });
          }}
          deleteConfirming={deleteConfirming}
          deleteBusy={deleteBusy}
          deleteRefusal={deleteRefusal}
          onAskDelete={() => {
            setDeleteRefusal(null);
            setDeleteConfirming(true);
          }}
          onCancelDelete={() => {
            setDeleteConfirming(false);
            setDeleteRefusal(null);
          }}
          onConfirmDelete={() => void confirmDelete(figure.id)}
        />
      </>
    );
  }

  if (view.kind === "trip") {
    const trip = trips.find((row) => row.id === view.tripId);
    if (!trip) {
      setView({ kind: "library" });
      return null;
    }
    return (
      <>
        <TripScreen
          username={username}
          trip={trip}
          figures={figures}
          saving={tripSaving}
          error={tripError}
          onBack={() => setView({ kind: "library" })}
          onSave={(mode, ids) => void saveTrip(trip.id, mode, ids)}
          onNewFigureFor={(person) => setView({ kind: "create", person, returnTo: { tripId: trip.id } })}
        />
      </>
    );
  }

  // ── library ────────────────────────────────────────────────────────
  const walkingCount = journalSet.length;
  const notInSet = figures.filter((f) => !journalSet.includes(f.id));

  return (
    <>
      <p className="mt-2 text-sm text-ink-secondary">
        {tn("studio.figures.library.subtitle", figures.length, {
          count: String(figures.length),
          walking: String(walkingCount),
        })}
      </p>
      {justSaved && (
        <p role="status" className="mt-2 text-sm font-semibold text-ink-strong">
          {t("studio.figures.library.saved", { name: justSaved.name ?? justSaved.id })}
        </p>
      )}

      <div className="mt-3 grid grid-cols-3 gap-2">
        {shownFigures.map((figure) => (
          <button
            key={figure.id}
            id={`figure-${figure.id}`}
            type="button"
            onClick={() => {
              setJustSaved(null);
              setView({ kind: "edit", id: figure.id });
            }}
            className={`flex min-h-11 flex-col items-center gap-1 rounded-xl border px-1 py-2 text-center ${
              journalSet.includes(figure.id) ? "border-ink-strong" : "border-line-strong"
            } ${justSaved?.id === figure.id ? "ring-2 ring-ink-strong" : ""}`}
          >
            <GridPreview username={username} figure={figure} />
            {/* B2139 — a name gets two lines before it is cut, and the
                subtitle is a contact's name, never their address. */}
            <span className="line-clamp-2 w-full break-words text-xs font-semibold text-ink-strong">{figure.name ?? figure.id}</span>
            {personLabel(figure) && <span className="line-clamp-2 w-full break-words text-xs text-ink-secondary">{personLabel(figure)}</span>}
            {journalSet.includes(figure.id) && (
              <span className="rounded-full bg-ink-strong px-1.5 py-0.5 text-[10px] font-semibold text-on-action">
                {t("studio.figures.library.walks")}
              </span>
            )}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setView({ kind: "newWho", returnTo: "library" })}
          className="flex min-h-11 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-line-strong px-1 py-2 text-center"
        >
          <span className="text-xl" aria-hidden="true">
            +
          </span>
          <span className="text-xs text-ink-secondary">{t("studio.figures.library.new")}</span>
        </button>
      </div>
      {figures.length > LIBRARY_PREVIEW_FIGURES && (
        <button
          type="button"
          onClick={() => setAllFigures((v) => !v)}
          className="mt-2 min-h-11 rounded-full border border-line-strong px-4 text-sm font-semibold text-ink-strong"
        >
          {allFigures ? t("studio.figures.showFewer") : t("studio.figures.showAll", { count: String(figures.length) })}
        </button>
      )}

      <div className="mt-4 rounded-2xl border border-line-quiet p-4">
        <h2 className="text-sm font-semibold text-ink-strong">{t("studio.figures.set.heading")}</h2>
        <p className="mt-1 text-xs text-ink-secondary">{t("studio.figures.set.hint")}</p>

        {journalSet.length > 0 && (
          <ul className="mt-2 flex flex-col gap-2">
            {journalSet.map((id, index) => {
              const figure = byId.get(id);
              if (!figure) return null;
              return (
                <li key={id} className="flex flex-wrap items-center gap-2">
                  <SmallPreview username={username} figure={figure} />
                  <span className="text-sm font-semibold text-ink-strong">{figure.name ?? id}</span>
                  <button
                    type="button"
                    disabled={index === 0 || setSaving}
                    onClick={() => moveInSet(id, "up")}
                    aria-label={t("studio.figures.set.moveUp", { name: figure.name ?? id })}
                    className={arrowChipClass}
                  >
                    ▲
                  </button>
                  <button
                    type="button"
                    disabled={index === journalSet.length - 1 || setSaving}
                    onClick={() => moveInSet(id, "down")}
                    aria-label={t("studio.figures.set.moveDown", { name: figure.name ?? id })}
                    className={arrowChipClass}
                  >
                    ▼
                  </button>
                  <button
                    type="button"
                    disabled={setSaving}
                    onClick={() => toggleInSet(id)}
                    className={`${chipClass(false)} ml-auto`}
                  >
                    {t("studio.figures.set.remove", { name: figure.name ?? id })}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {notInSet.length > 0 && (
            <details className="w-full">
              <summary className="inline-flex min-h-11 cursor-pointer list-none items-center gap-1 rounded-full border border-line-strong px-3 text-sm font-semibold text-ink-body">
                {t("studio.figures.set.addDisclosure")} ({notInSet.length})
              </summary>
              <div className="mt-2 flex flex-wrap gap-2">
                {notInSet.map((figure) => (
                  <button
                    key={figure.id}
                    type="button"
                    disabled={setSaving}
                    onClick={(e) => {
                      toggleInSet(figure.id);
                      // The picker has done its job — fold it shut.
                      e.currentTarget.closest("details")?.removeAttribute("open");
                    }}
                    className={chipClass(false)}
                  >
                    {t("studio.figures.set.add", { name: figure.name ?? figure.id })}
                  </button>
                ))}
              </div>
            </details>
          )}

          {/* "Nobody walks by default" — a visible action beside the set at
           *  all times, not a message shown only once the set happens to be
           *  empty (the review's own finding). Active (highlighted) exactly
           *  when that already is the answer. */}
          <button
            type="button"
            disabled={setSaving || journalSet.length === 0}
            onClick={() => void saveJournalSet([])}
            aria-pressed={journalSet.length === 0} className={chipClass(journalSet.length === 0)}
          >
            {t("studio.figures.set.none")}
          </button>
        </div>

        {setSaved && !setError && <p className="mt-2 text-sm text-ink-secondary">{t("studio.figures.set.saved")}</p>}
        {setError && (
          <p role="alert" className="mt-2 text-sm text-coral-600">
            {setError}
          </p>
        )}
      </div>

      <div className="mt-4">
        <h2 className="text-sm font-semibold text-ink-strong">{t("studio.figures.trip.heading")}</h2>
        <ul className="mt-2 flex flex-col gap-2">
          {shownTrips.map((trip) => (
            <li key={trip.id}>
              <button
                type="button"
                onClick={() => setView({ kind: "trip", tripId: trip.id })}
                className="flex min-h-11 w-full flex-col gap-1 rounded-xl border border-line-strong px-3 py-2 text-left"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-ink-strong">{trip.title}</span>
                  <span className={`${chipClass(false)} shrink-0`}>{tripAnswerLabel(t, trip)}</span>
                </span>
                <TripDates trip={trip} />
                {trip.answer === "custom" && trip.figures.length > 0 && (
                  <span className="mt-1 flex flex-wrap gap-1">
                    {trip.figures.map((id) => {
                      const figure = byId.get(id);
                      return figure ? <SmallPreview key={id} username={username} figure={figure} /> : null;
                    })}
                  </span>
                )}
                {trip.answer === "declined" && (
                  <span className="text-xs text-ink-secondary">
                    {trip.declinedReason
                      ? t("studio.figures.trip.declinedHint", { reason: trip.declinedReason })
                      : t("studio.figures.trip.declinedHintGeneric")}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
        {trips.length > LIBRARY_PREVIEW_TRIPS && (
          <button
            type="button"
            onClick={() => setAllTrips((v) => !v)}
            className="mt-2 min-h-11 rounded-full border border-line-strong px-4 text-sm font-semibold text-ink-strong"
          >
            {allTrips ? t("studio.figures.showFewer") : t("studio.figures.showAll", { count: String(trips.length) })}
          </button>
        )}
      </div>
    </>
  );
}

function TripDates({ trip }: { trip: FigureTripRow }) {
  const { t, formatShortDate } = useI18n();
  const startYear = trip.start.slice(0, 4);
  const endYear = trip.end.slice(0, 4);
  const years = startYear === endYear ? startYear : `${startYear}–${endYear}`;
  return (
    <span className="text-xs text-ink-secondary">
      {formatShortDate(trip.start)} – {formatShortDate(trip.end)}, {years} · {t(statusKey(trip.status))}
    </span>
  );
}

function tripAnswerLabel(t: (key: TranslationKey) => string, trip: FigureTripRow): string {
  switch (trip.answer) {
    case "journal":
      return t("studio.figures.trip.answer.journal");
    case "off":
      return t("studio.figures.trip.answer.off");
    case "custom":
      return t("studio.figures.trip.answer.custom");
    default:
      // B2139 — a trip that gave a reason said no; only one without has not answered.
      return t(trip.declinedReason ? "studio.figures.trip.answer.saidNo" : "studio.figures.trip.answer.declined");
  }
}

// ── "who is this figure for" — asked once, before a brand-new figure is
// drawn, since the creator itself has nowhere to type a name ────────────
function NewWhoScreen({
  contacts,
  onCancel,
  onContinue,
}: {
  contacts: Contact[];
  onCancel: () => void;
  onContinue: (person: { name: string; email?: string }) => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [email, setEmail] = useState<string | undefined>(undefined);

  return (
    <div>
      <h2 className="font-display text-lg font-semibold text-ink-strong">{t("studio.figures.newWho.heading")}</h2>
      <p className="mt-1 text-sm text-ink-secondary">{t("studio.figures.newWho.hint")}</p>

      {contacts.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {contacts.map((contact) => (
            <button
              key={contact.email}
              type="button"
              onClick={() => {
                setName(contact.name);
                setEmail(contact.email);
              }}
              aria-pressed={email === contact.email} className={chipClass(email === contact.email)}
            >
              {contact.name}
            </button>
          ))}
          <button type="button" onClick={() => setEmail(undefined)} aria-pressed={email === undefined} className={chipClass(email === undefined)}>
            {t("studio.figures.newWho.nobody")}
          </button>
        </div>
      )}

      <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-ink-secondary" htmlFor="figure-new-name">
        {t("studio.figures.newWho.name")}
      </label>
      <input
        id="figure-new-name"
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="mt-1 min-h-11 w-full rounded-xl border border-line-strong px-3 text-base"
      />

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={name.trim().length === 0}
          onClick={() => onContinue({ name: name.trim(), email })}
          className={primaryButtonClass}
        >
          {t("studio.figures.newWho.continue")}
        </button>
        <button type="button" onClick={onCancel} className={secondaryButtonClass}>
          {t("studio.figures.start.cancel")}
        </button>
      </div>
    </div>
  );
}

// ── one figure opened: rename, who this is, change looks, save, delete ──
function EditScreen({
  username,
  figure,
  contacts,
  trips,
  referencedBy,
  onSaved,
  onChangeLooks,
  onBack,
  deleteConfirming,
  deleteBusy,
  deleteRefusal,
  onAskDelete,
  onCancelDelete,
  onConfirmDelete,
}: {
  username: string;
  figure: FigureDoc;
  contacts: Contact[];
  trips: FigureTripRow[];
  /** Who still names this figure, right now — computed client-side from the
   *  journal's set and every trip's own party (both already held by the
   *  parent), so it is visible the moment the figure opens, not only after
   *  a refused delete (review finding). */
  referencedBy: ReferencedBy;
  onSaved: (doc: FigureDoc) => void;
  onChangeLooks: () => void;
  onBack: () => void;
  deleteConfirming: boolean;
  deleteBusy: boolean;
  deleteRefusal: ReferencedBy | null;
  onAskDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState(figure.name ?? "");
  const [person, setPerson] = useState<string | undefined>(figure.person);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function save() {
    setSaving(true);
    setSaveError(null);
    setSaved(false);
    try {
      const body: Record<string, unknown> = { ...figure, name: name.trim() || undefined, person };
      const res = await fetch(
        `/api/web/${encodeURIComponent(username)}/figures/${encodeURIComponent(figure.id)}`,
        {
          method: "PUT",
          headers: { "content-type": "application/json", "if-match": "*" },
          body: JSON.stringify(body),
        },
      );
      const json = (await res.json().catch(() => null)) as FigureDoc | { error?: string } | null;
      if (!res.ok || !json || "error" in json) {
        setSaveError(t("studio.figures.edit.error"));
        return;
      }
      onSaved(json as FigureDoc);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  const tripNames = new Map(trips.map((t2) => [t2.id, t2.title]));
  const usedByNothing = !referencedBy.journal && referencedBy.trips.length === 0;

  return (
    <div>
      <button type="button" onClick={onBack} className={backLinkClass}>
        {t("studio.figures.edit.back")}
      </button>

      <div className="mt-2 flex items-center gap-3 rounded-xl bg-ink-strong px-3 py-3">
        <img src={previewSrc(username, figure, 180)} alt={figure.name ?? figure.id} width={56} height={90} />
        <span className="flex flex-col gap-0.5">
          <span className="font-semibold text-on-action">{figure.name ?? figure.id}</span>
          <span className="text-xs text-on-action/80">
            {figure.person ?? t("studio.figures.library.noPerson")}
          </span>
        </span>
      </div>

      {/* "Used by" — always shown, not only after a refused delete. */}
      <p className="mt-2 text-xs text-ink-secondary">
        {t("studio.figures.edit.usedBy")}{" "}
        {usedByNothing ? (
          t("studio.figures.edit.usedByNone")
        ) : (
          <>
            {referencedBy.trips.map((tripId, i) => (
              <span key={tripId}>
                {i > 0 && ", "}
                <Link href={`/${username}/trips/${tripId}`} className="underline">
                  {tripNames.get(tripId) ?? tripId}
                </Link>
              </span>
            ))}
            {referencedBy.journal && (
              <span>
                {referencedBy.trips.length > 0 && ", "}
                {t("studio.figures.edit.usedByJournal")}
              </span>
            )}
          </>
        )}
      </p>

      <label className="mt-4 block text-xs font-semibold uppercase tracking-wide text-ink-secondary" htmlFor="figure-edit-name">
        {t("studio.figures.edit.name")}
      </label>
      <input
        id="figure-edit-name"
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="mt-1 min-h-11 w-full rounded-xl border border-line-strong px-3 text-base"
      />

      <div className="mt-4">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">{t("studio.figures.edit.who")}</h3>
        <p className="mt-1 text-xs text-ink-secondary">{t("studio.figures.edit.whoHint")}</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {contacts.map((contact) => (
            <button
              key={contact.email}
              type="button"
              onClick={() => setPerson(contact.email)}
              aria-pressed={person === contact.email} className={chipClass(person === contact.email)}
            >
              {contact.name}
            </button>
          ))}
          <button type="button" onClick={() => setPerson(undefined)} aria-pressed={person === undefined} className={chipClass(person === undefined)}>
            {t("studio.figures.newWho.nobody")}
          </button>
        </div>
      </div>

      <div className="mt-4">
        <button type="button" onClick={onChangeLooks} className={secondaryButtonClass}>
          {t("studio.figures.edit.changeLooks", { name: figure.name ?? figure.id })}
        </button>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
        <BusyButton type="button" busy={saving} onClick={() => void save()} className={primaryButtonClass}>
          {t("studio.figures.edit.save")}
        </BusyButton>
        {!deleteConfirming && (
          <button
            type="button"
            onClick={onAskDelete}
            className="flex min-h-11 items-center text-sm font-semibold text-coral-600"
          >
            {t("studio.figures.edit.delete")}
          </button>
        )}
      </div>
      {saved && !saveError && <p className="mt-2 text-sm text-ink-secondary">{t("studio.figures.edit.saved")}</p>}
      {saveError && <p role="alert" className="mt-2 text-sm text-coral-600">{saveError}</p>}

      {deleteConfirming && !deleteRefusal && (
        <div className="mt-4">
          <ConfirmPanel
            label={t("studio.figures.edit.delete")}
            question={t("studio.figures.edit.deleteQuestion", { name: figure.name ?? figure.id })}
            confirmLabel={t("studio.figures.edit.deleteConfirm")}
            tone="destructive"
            busyLabel={t("studio.figures.edit.deleteBusy")}
            busy={deleteBusy}
            onConfirm={onConfirmDelete}
            onCancel={onCancelDelete}
          />
        </div>
      )}

      {deleteRefusal && (
        <div className="mt-4 rounded-2xl border border-coral-600 p-4">
          <p role="alert" className="text-sm font-semibold text-coral-600">{t("studio.figures.edit.cannotDelete")}</p>
          <p className="mt-1 text-sm text-ink-body">{t("studio.figures.edit.cannotDeleteHint")}</p>
          <ul className="mt-2 list-disc pl-5 text-sm text-ink-body">
            {deleteRefusal.journal && <li>{t("studio.figures.edit.usedByJournal")}</li>}
            {deleteRefusal.trips.map((tripId) => (
              <li key={tripId}>
                <Link href={`/${username}/trips/${tripId}`} className="underline">
                  {tripNames.get(tripId) ?? tripId}
                </Link>
              </li>
            ))}
          </ul>
          <button type="button" onClick={onCancelDelete} className={`${secondaryButtonClass} mt-3`}>
            {t("me.cancel")}
          </button>
        </div>
      )}
    </div>
  );
}

// ── per-trip party picker ────────────────────────────────────────────
function TripScreen({
  username,
  trip,
  figures,
  saving,
  error,
  onBack,
  onSave,
  onNewFigureFor,
}: {
  username: string;
  trip: FigureTripRow;
  figures: FigureDoc[];
  saving: boolean;
  error: string | null;
  onBack: () => void;
  onSave: (mode: "journal" | "off" | "custom", ids: string[]) => void;
  onNewFigureFor: (person: { name: string; email: string }) => void;
}) {
  const { t } = useI18n();
  const [mode, setMode] = useState<"journal" | "off" | "custom">(
    trip.answer === "declined" ? "journal" : trip.answer,
  );
  const [selected, setSelected] = useState<string[]>(trip.figures);

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  const figuresByPerson = new Map(figures.filter((f) => f.person).map((f) => [f.person as string, f]));
  const missing = trip.people.filter((p) => !figuresByPerson.has(p.email));

  return (
    <div>
      <button type="button" onClick={onBack} className={backLinkClass}>
        {t("studio.figures.trip.back")}
      </button>
      <h2 className="mt-2 font-display text-lg font-semibold text-ink-strong">{trip.title}</h2>
      <p className="mt-1 text-sm text-ink-secondary">{t("studio.figures.trip.hint")}</p>

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={() => setMode("journal")} aria-pressed={mode === "journal"} className={chipClass(mode === "journal")}>
          {t("studio.figures.trip.answer.journal")}
        </button>
        <button type="button" onClick={() => setMode("off")} aria-pressed={mode === "off"} className={chipClass(mode === "off")}>
          {t("studio.figures.trip.answer.off")}
        </button>
        <button type="button" onClick={() => setMode("custom")} aria-pressed={mode === "custom"} className={chipClass(mode === "custom")}>
          {t("studio.figures.trip.answer.custom")}
        </button>
      </div>

      {mode === "custom" && (
        <div className="mt-3 rounded-2xl border border-line-quiet p-4">
          <h3 className="text-sm font-semibold text-ink-strong">{t("studio.figures.trip.party")}</h3>
          <div className="mt-2 flex flex-col gap-2">
            {figures.map((figure) => {
              const walks = selected.includes(figure.id);
              return (
                <button
                  key={figure.id}
                  type="button"
                  aria-pressed={walks}
                  onClick={() => toggle(figure.id)}
                  className="flex min-h-11 items-center gap-2"
                >
                  <SmallPreview username={username} figure={figure} />
                  <span className="text-left text-sm text-ink-strong">{figure.name ?? figure.id}</span>
                  <span className={`${chipClass(walks)} ml-auto shrink-0 whitespace-nowrap`}>
                    {walks ? t("studio.figures.trip.walks") : t("studio.figures.trip.doesNotWalk")}
                  </span>
                </button>
              );
            })}
          </div>

          <p className="mt-3 text-xs text-ink-secondary">
            {t("studio.figures.trip.missing", {
              names: missing.length > 0 ? missing.map((p) => p.name).join(", ") : t("studio.figures.trip.missingNone"),
            })}
            {missing.length > 0 && (
              <>
                {" "}
                <button
                  type="button"
                  onClick={() => onNewFigureFor(missing[0])}
                  className="min-h-11 font-semibold text-ink-body underline"
                >
                  + {t("studio.figures.library.new")}
                </button>
              </>
            )}
          </p>
        </div>
      )}

      <StepPrimary
        busy={saving}
        disabled={mode === "custom" && selected.length === 0}
        onClick={() => onSave(mode, selected)}
        label={t("studio.figures.trip.save")}
        tone="bg-yellow-400 text-yellow-950 hover:bg-yellow-300"
      />
      <SubmitError message={error} />
    </div>
  );
}
