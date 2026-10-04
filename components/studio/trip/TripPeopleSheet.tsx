"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useI18n } from "@/components/LocaleProvider";
import GroupPhotoFigures from "@/components/studio/trip/GroupPhotoFigures";
import FigureCreator, { SHEET_FOOTER } from "@/components/studio/figures/FigureCreator";
import { journalPath } from "@/lib/journalPath";
import type { FigureDoc } from "@/lib/api/v2/schemas/figures";

type SheetPerson = { name: string; email?: string };

/**
 * "Who's on this trip?" — B-2847. One list of the people travelling, the
 * owner first. A name is a name (or a contact copied onto the trip); adding
 * one writes the trip's `people:` byline and nothing else: no invitation, no
 * grant, no mail. A person can have a walking figure, made by the existing
 * `FigureCreator`; the kept figure joins the trip's own figure set and
 * carries `person` only when the person has an address.
 *
 * A native `<dialog>` opened with `showModal()`: focus is trapped, Escape
 * closes, and it is labelled by its own heading.
 */
function TripPeopleSheet({
  username,
  tripId,
  owner,
  initialPeople,
  contacts,
  initialFigures,
  figureSet,
  photoConsent: photoConsentIn,
  photoAsk,
  onClose,
}: {
  username: string;
  tripId: string;
  owner: { name: string; email?: string; nickname?: string };
  /** The people on the trip other than the owner. */
  initialPeople: SheetPerson[];
  contacts: { name: string; email: string }[];
  initialFigures: FigureDoc[];
  /** The ids of the figures that walk this trip right now. */
  figureSet: string[];
  photoConsent: boolean;
  /** See `TripPeopleSheetData.photoAsk`. */
  photoAsk?: { provider: string; declined: boolean };
  onClose: () => void;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [people, setPeople] = useState<SheetPerson[]>(initialPeople);
  const [figures, setFigures] = useState<FigureDoc[]>(initialFigures);
  const [set, setSet] = useState<string[]>(figureSet);
  const [typed, setTyped] = useState("");
  const [creating, setCreating] = useState<SheetPerson | null>(null);
  const [fromPhoto, setFromPhoto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [photoConsent, setPhotoConsent] = useState(photoConsentIn);
  const [askHidden, setAskHidden] = useState(false);

  async function agreePhotos() {
    // no-refresh: the consent is held in photoConsent right here; the sheet stays open.
    const res = await fetch(`/api/helper/${encodeURIComponent(username)}/consent`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope: "photos" }),
    }).catch(() => null);
    if (res?.ok) setPhotoConsent(true);
    else setError(t("studio.tripPeople.error"));
  }

  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
  }, []);

  const ownerPerson: SheetPerson = { name: owner.name, ...(owner.email ? { email: owner.email } : {}) };
  const figureOf = (p: SheetPerson) =>
    figures.find((f) => (p.email ? f.person === p.email : !f.person && f.name === p.name));

  const suggestions = contacts.filter(
    (c) => !people.some((p) => p.email === c.email) && c.email !== owner.email,
  );

  async function writePeople(next: SheetPerson[]): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      // An owner without an address is always credited anyway, so they are
      // written only when they have one, or when nobody else is listed (a trip
      // needs at least one person).
      const byline =
        owner.email || next.length === 0
          ? [{ name: owner.name, ...(owner.email ? { email: owner.email } : {}), ...(owner.nickname ? { nickname: owner.nickname } : {}) }, ...next]
          : next;
      const res = await fetch(`/api/web/${encodeURIComponent(username)}/trips/${encodeURIComponent(tripId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ people: byline }),
      });
      if (!res.ok) {
        setError(t("studio.tripPeople.error"));
        return false;
      }
      setPeople(next);
      router.refresh();
      return true;
    } catch {
      setError(t("studio.tripPeople.error"));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function add(person: SheetPerson) {
    const name = person.name.trim();
    if (!name || busy) return;
    if (people.some((p) => (person.email ? p.email === person.email : !p.email && p.name === name))) return;
    if (await writePeople([...people, { name, ...(person.email ? { email: person.email } : {}) }])) setTyped("");
  }

  async function keepFigure(doc: FigureDoc) {
    setCreating(null);
    await keepFigures([doc]);
  }

  /** Kept figures join the trip's figure set; people the owner named are added
   *  to the byline the same way a typed name or contact is (no invite). */
  async function keepFigures(docs: FigureDoc[], named: SheetPerson[] = []) {
    setFigures((prev) => [...prev.filter((f) => !docs.some((d) => d.id === f.id)), ...docs]);
    setFromPhoto(false);
    const fresh = named.filter(
      (n) => !people.some((p) => (n.email ? p.email === n.email : !p.email && p.name === n.name)),
    );
    if (fresh.length) await writePeople([...people, ...fresh]);
    const next = [...set, ...docs.map((d) => d.id).filter((id) => !set.includes(id))];
    try {
      const res = await fetch(`/api/web/${encodeURIComponent(username)}/trips/${encodeURIComponent(tripId)}/figures`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ figures: { mode: "custom", figures: next } }),
      });
      if (!res.ok) {
        setError(t("studio.tripPeople.error"));
        return;
      }
      setSet(next);
      router.refresh();
    } catch {
      setError(t("studio.tripPeople.error"));
    }
  }

  function row(p: SheetPerson, label: string, removable: boolean) {
    const figure = figureOf(p);
    return (
      <li key={p.email ?? `name:${p.name}`} className="flex min-h-14 items-center gap-3 py-2">
        <span className="flex h-12 w-8 flex-none items-center justify-center" aria-hidden={!figure}>
          {figure && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/v2/${encodeURIComponent(username)}/figures/preview?figure=${encodeURIComponent(JSON.stringify(figure))}&size=96`}
              alt={t("studio.tripPeople.figureAlt", { name: p.name })}
              width={28}
              height={45}
            />
          )}
        </span>
        <span className="min-w-0 flex-1 truncate text-ink-strong">{label}</span>
        <button
          type="button"
          onClick={() => setCreating(p)}
          className="min-h-11 shrink-0 px-2 text-sm font-semibold text-ink-strong underline underline-offset-2"
        >
          {figure ? t("studio.tripPeople.figure.edit") : t("studio.tripPeople.figure.add")}
        </button>
        {removable && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void writePeople(people.filter((x) => x !== p))}
            aria-label={t("studio.tripPeople.remove", { name: p.name })}
            className="min-h-11 min-w-11 shrink-0 text-lg text-ink-secondary"
          >
            ×
          </button>
        )}
      </li>
    );
  }

  return (
    <dialog
      ref={dialog}
      aria-labelledby="trip-people-title"
      onClose={onClose}
      className="mx-0 mb-0 mt-auto w-full max-w-none max-h-[90dvh] overflow-y-auto rounded-t-2xl border sm:m-auto sm:w-[min(32rem,calc(100vw-2rem))] sm:rounded-2xl border border-line-quiet bg-surface-raised p-5 text-ink-body backdrop:bg-black/40"
    >
      {fromPhoto ? (
        <GroupPhotoFigures
          username={username}
          owner={ownerPerson}
          contacts={contacts}
          existingIds={figures.map((f) => f.id)}
          onKept={(docs, named) => void keepFigures(docs, named)}
          onCancel={() => setFromPhoto(false)}
        />
      ) : creating ? (
        <FigureCreator
          username={username}
          initial={figureOf(creating) ?? null}
          person={creating}
          photoConsent={photoConsent}
          existingIds={figures.map((f) => f.id)}
          onSaved={(doc) => void keepFigure(doc)}
          onCancel={() => setCreating(null)}
          inline
        />
      ) : (
        <>
          <h2 id="trip-people-title" className="font-display text-lg font-semibold text-ink-strong">
            {t("studio.tripPeople.title")}
          </h2>
          <p className="mt-1 text-sm text-ink-secondary">{t("studio.tripPeople.note")}</p>
          <ul className="mt-3 divide-y divide-line-quiet">
            {row(ownerPerson, t("studio.tripPeople.you", { name: owner.name }), false)}
            {people.map((p) => row(p, p.name, true))}
          </ul>
          <form
            className="mt-3"
            onSubmit={(e) => {
              e.preventDefault();
              const match = contacts.find((c) => c.email === typed.trim().toLowerCase() || c.name === typed.trim());
              void add(match ? { name: match.name, email: match.email } : { name: typed });
            }}
          >
            <label htmlFor="trip-people-add" className="block text-sm font-semibold text-ink-strong">
              {t("studio.tripPeople.add.label")}
            </label>
            <div className="mt-1 flex gap-2">
              <input
                id="trip-people-add"
                list="trip-people-contacts"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                className="min-h-11 min-w-0 flex-1 rounded-lg border border-line-strong bg-surface-base px-3 text-ink-strong"
              />
              <datalist id="trip-people-contacts">
                {suggestions.map((c) => (
                  <option key={c.email} value={c.name} />
                ))}
              </datalist>
              <button
                type="submit"
                disabled={busy || !typed.trim()}
                className="min-h-11 rounded-full border border-line-strong px-4 font-semibold text-ink-strong disabled:opacity-50"
              >
                {t("studio.tripPeople.add.button")}
              </button>
            </div>
          </form>
          <div className="mt-3">
            {photoConsent ? (
              <button
                type="button"
                onClick={() => setFromPhoto(true)}
                className="min-h-11 rounded-full border border-line-strong px-4 text-sm font-semibold text-ink-strong"
              >
                {t("studio.tripPeople.photo.button")}
              </button>
            ) : !photoAsk ? (
              <p className="text-sm text-ink-secondary">{t("studio.tripPeople.photo.unavailable")}</p>
            ) : photoAsk.declined ? (
              <Link href={`${journalPath(username)}/studio/agent`} className="text-sm text-ink-secondary underline underline-offset-2">
                {t("studio.tripPeople.photo.declined")}
              </Link>
            ) : askHidden ? null : (
              <div data-photo-ask className="rounded-xl border border-line-quiet bg-surface-raised p-3">
                <p className="text-sm text-ink-strong">{t("studio.tripPeople.photo.consent")}</p>
                <p className="mt-1 text-xs text-ink-secondary">{t("me.consentProvider", { provider: photoAsk.provider })}</p>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => void agreePhotos()}
                    className="min-h-11 rounded-full border border-line-strong px-4 text-sm font-semibold text-ink-strong"
                  >
                    {t("studio.tripPeople.photo.ask.yes")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setAskHidden(true)}
                    className="min-h-11 rounded-full px-4 text-sm text-ink-secondary"
                  >
                    {t("studio.tripPeople.photo.ask.no")}
                  </button>
                </div>
              </div>
            )}
          </div>
          {error && (
            <p role="alert" className="mt-2 text-sm text-coral-600">
              {error}
            </p>
          )}
          <div className={SHEET_FOOTER}>
            <button
              type="button"
              onClick={() => dialog.current?.close()}
              className="min-h-11 rounded-full bg-yellow-400 px-5 font-semibold text-yellow-950 hover:bg-yellow-300"
            >
              {t("studio.tripPeople.done")}
            </button>
          </div>
        </>
      )}
    </dialog>
  );
}

/** The row "Who's on this trip? · Add" and the sheet it opens. `defaultOpen`
 *  is only the first render: on the done screen right after Create it opens
 *  the sheet once by itself; closing it leaves the row to reopen it. */
export function TripPeopleRow({
  defaultOpen = false,
  ...sheet
}: Omit<React.ComponentProps<typeof TripPeopleSheet>, "onClose"> & { defaultOpen?: boolean }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(defaultOpen);
  return (
    <li className="flex min-h-11 items-center justify-between gap-3 px-4 py-2 text-sm">
      <span className="text-ink-body">{t("studio.tripPeople.row.title")}</span>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="shrink-0 font-semibold text-ink-strong underline underline-offset-2"
      >
        {t("studio.tripPeople.row.cta")}
      </button>
      {open && <TripPeopleSheet {...sheet} onClose={() => setOpen(false)} />}
    </li>
  );
}
