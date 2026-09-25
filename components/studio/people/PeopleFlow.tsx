"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useI18n } from "@/components/LocaleProvider";
import WhatStep from "@/components/studio/WhatStep";
import StepPrimary from "@/components/studio/StepPrimary";
import SubmitError from "@/components/studio/SubmitError";
import StepIndicator from "@/components/extract/StepIndicator";
import DoneScreen from "@/components/studio/DoneScreen";
import { PhotoPicker } from "@/components/PhotoPicker";
import FigureCreator from "@/components/studio/figures/FigureCreator";
import type { FigureDoc } from "@/lib/api/v2/schemas/figures";
import type { TranslationKey } from "@/lib/i18n";
import { haptic } from "@/components/nativeShell";
import { useStep } from "@/lib/studio/useStep";
import { useSkipIntro } from "@/lib/studio/fromHub";
import type { PersonRow } from "./types";
import StepBody from "@/components/studio/StepBody";
import PeopleYouHave, { type KnownPerson } from "./PeopleYouHave";

/** The screens a person counts, in `?step=` (B2079). "bring" is one step
 *  whichever door it opens — the upload with its read-back, or typing names
 *  in — so the count reads 1, 2, 3, 4 on either path. Drawing and done are
 *  outcomes of the write, not steps a reload or Back should land on. */
const STEPS = ["what", "get", "bring", "decide"] as const;
type Door = "upload" | "typeIn";
type Outcome = "draw" | "done";

type ContactsReadResponse = {
  ok?: true;
  people?: { name: string; email?: string; tel?: string }[];
  withEmail?: number;
  error?: string;
  message?: string;
};

type InboxItem = { id: string; filename: string };
type InboxUploadResponse = { ok?: true; items?: InboxItem[]; error?: string };

type ImportRowOutcome = { name: string; email: string; outcome: string };
type ImportResponse = { filed?: number; invalid?: number; results?: ImportRowOutcome[]; error?: string };

const READ_ERROR_KEYS: Record<string, TranslationKey> = {
  contacts_disabled: "studio.people.error.contactsDisabled",
  unreadable: "studio.people.error.unreadable",
  contract: "studio.people.error.unreadable",
  unknown_inbox_file: "studio.people.error.generic",
  no_file: "studio.people.error.generic",
};

/**
 * "Who was there" — B1823, spec §7.4. Bringing a few people into a journal
 * so a trip can say who was on it.
 *
 * **One flow, two doors (D5).** A vCard export is one way in; typing a name
 * and an email by hand is the other, and it is not a fallback bolted on
 * afterwards — the commonest real case is two friends, which never needed a
 * file. Both doors land on the same `decide` step.
 *
 * **Nothing is written before `decide`'s own button** (spec §4). Reading a
 * vCard (`/contacts/read`) never writes; only the final press calls
 * `POST /api/helper/[user]/contacts/import`, the same writer the `/agent`
 * card flow already uses, so a row filed from here and one filed from a
 * conversation land identically — `pending`, with its own confirmation mail.
 *
 * **D9 — no screenshots.** `getIt` names the exact menu path and the exact
 * filename per platform in prose; there is nothing here to go stale.
 */
export default function PeopleFlow({
  username,
  trips,
  defaultTripId,
  initialName,
  photoConsent,
  photoCredits,
  people,
}: {
  username: string;
  trips: { id: string; title: string }[];
  defaultTripId: string | null;
  /** A name already known before this flow opened — the inbox's own contact
   *  tile arriving with `?name=` (B1995). Jumps straight to "type it in" with
   *  the name already there, rather than making somebody type what a `.vcf`
   *  already told them. */
  initialName?: string;
  /** Whether the figure creator's "from a photo" door may exist at all
   *  (B2021) — the helper's own `photos` consent, read server-side so the
   *  door is absent from the DOM rather than merely disabled when it is
   *  off. */
  photoConsent: boolean;
  photoCredits: number;
  /** Who is already here (B2088) — the flow's own filed contacts and anyone
   *  on a trip, read server-side. Absent when contacts are off: there is
   *  nothing to list or edit then. */
  people?: KnownPerson[];
}) {
  const { t, tn } = useI18n();
  const [doorState, setDoor] = useState<Door>(initialName ? "typeIn" : "upload");
  // B2136 — the door is in the URL too (`?mode=type|file`), so a reload of
  // the type-in screen is the type-in screen whatever the draft holds.
  const mode = useSearchParams().get("mode");
  const door: Door = mode === "type" ? "typeIn" : mode === "file" ? "upload" : doorState;
  const [platform, setPlatform] = useState<"android" | "iphone" | "google">("android");

  const [file, setFile] = useState<File | null>(null);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState<TranslationKey | null>(null);

  const [cardPeople, setCardPeople] = useState<PersonRow[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const [typed, setTyped] = useState<{ name: string; email: string }[]>([
    { name: initialName ?? "", email: "" },
    { name: "", email: "" },
  ]);

  const [wasOnTrip, setWasOnTrip] = useState<Record<string, boolean>>({});
  const [tripId, setTripId] = useState(defaultTripId ?? trips[0]?.id ?? "");

  const [busy, setBusy] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResponse | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  // B2079 — what was typed or read rides in the session draft, so a reload
  // or the browser's Back keeps it. `set` trusts only the shapes it expects.
  const { step: urlStep, total, go, reset } = useStep(STEPS, {
    flowId: `people:${username}`,
    // B2136 — "bring" is answered once somebody is chosen to add.
    complete: (s) =>
      s !== "bring" || (door === "typeIn" ? typed.some((r) => r.name.trim() !== "" && r.email.trim() !== "") : selected.size > 0),
    draft: {
      get: () => ({ door, platform, typed, cardPeople, selected: [...selected], wasOnTrip, tripId }),
      set: (d) => {
        if (d.door === "upload" || d.door === "typeIn") setDoor(d.door);
        if (d.platform === "android" || d.platform === "iphone" || d.platform === "google") setPlatform(d.platform);
        const rows = (v: unknown) =>
          Array.isArray(v) ? v.filter((r): r is Record<string, unknown> => !!r && typeof r === "object" && typeof r.name === "string") : null;
        const typedRows = rows(d.typed);
        if (typedRows?.length) setTyped(typedRows.map((r) => ({ name: String(r.name), email: typeof r.email === "string" ? r.email : "" })));
        const card = rows(d.cardPeople);
        if (card)
          setCardPeople(
            card.map((r) => ({
              name: String(r.name),
              email: typeof r.email === "string" ? r.email : undefined,
              tel: typeof r.tel === "string" ? r.tel : undefined,
              source: "vcard" as const,
            })),
          );
        if (Array.isArray(d.selected)) setSelected(new Set(d.selected.filter((i): i is number => typeof i === "number")));
        if (d.wasOnTrip && typeof d.wasOnTrip === "object" && !Array.isArray(d.wasOnTrip)) setWasOnTrip(d.wasOnTrip as Record<string, boolean>);
        if (typeof d.tripId === "string" && trips.some((tr) => tr.id === d.tripId)) setTripId(d.tripId);
      },
    },
  });
  // B2141: from the hub, the flow opens on its first real step.
  const skipIntro = useSkipIntro();
  const step = urlStep === "what" && skipIntro ? "get" : urlStep;

  /** Who the decide step is about — derived from the door, never held twice. */
  const chosen: PersonRow[] =
    door === "typeIn"
      ? typed
          .filter((row) => row.name.trim() !== "" && row.email.trim() !== "")
          .map((row) => ({ name: row.name.trim(), email: row.email.trim().toLowerCase(), source: "typed" as const }))
      : cardPeople.filter((_, i) => selected.has(i));

  // ── figures (B2021): who already has one, and the drawing pass ─────
  const [figuresByEmail, setFiguresByEmail] = useState<Record<string, FigureDoc>>({});
  const [pendingDraw, setPendingDraw] = useState<PersonRow[]>([]);
  const [drawingPerson, setDrawingPerson] = useState<PersonRow | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/web/${encodeURIComponent(username)}/figures`)
      .then((res) => (res.ok ? res.json() : null))
      .then((json: { figures?: FigureDoc[] } | null) => {
        if (cancelled || !json?.figures) return;
        const byEmail: Record<string, FigureDoc> = {};
        for (const fig of json.figures) {
          if (fig.person) byEmail[fig.person] = fig;
        }
        setFiguresByEmail(byEmail);
      })
      .catch(() => {
        // Read-only lookup, purely cosmetic (a badge next to a name) — a
        // failed fetch leaves the decide step exactly as it looked before
        // this ticket, never blocks it.
      });
    return () => {
      cancelled = true;
    };
  }, [username]);

  // Once committed, everyone just added who has no figure yet gets one
  // offer to be drawn — one pass, after the mails are on their way, never
  // before (spec: "the drawing pass comes after People's decide-and-send").
  // The pass ends the moment nobody is left pending, decided at each of the
  // three places that can empty the queue (drawn, "not now", "skip all")
  // rather than in an effect watching for it (react-hooks/set-state-in-effect).
  function dropFromDraw(email: string | undefined) {
    const next = pendingDraw.filter((p) => p.email !== email);
    setPendingDraw(next);
    if (next.length === 0) setOutcome("done");
  }

  // ── get it → upload ──────────────────────────────────────────────────
  async function readCard() {
    if (!file) return;
    setUploadBusy(true);
    setUploadError(null);
    try {
      const form = new FormData();
      form.append("files", file, file.name);
      const staged = await fetch(`/api/helper/${encodeURIComponent(username)}/inbox`, {
        method: "POST",
        body: form,
      });
      const stagedJson = (await staged.json().catch(() => null)) as InboxUploadResponse | null;
      const item = stagedJson?.items?.[0];
      if (!staged.ok || !item) {
        setUploadError("studio.people.error.generic");
        return;
      }

      const read = await fetch(`/api/helper/${encodeURIComponent(username)}/contacts/read`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ inbox: item.id }),
      });
      const readJson = (await read.json().catch(() => null)) as ContactsReadResponse | null;
      if (!read.ok || !readJson?.ok) {
        setUploadError(mapReadError(readJson?.error));
        return;
      }

      const rows: PersonRow[] = (readJson.people ?? []).map((p) => ({
        name: p.name,
        email: p.email,
        tel: p.tel,
        source: "vcard",
      }));
      setCardPeople(rows);
      setSelected(new Set(rows.map((r, i) => (r.email ? i : -1)).filter((i) => i >= 0)));
    } finally {
      setUploadBusy(false);
    }
  }

  function toggleSelected(index: number) {
    void haptic("selection");
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  /** A door is its own history entry (`?mode=`), so Back from typing
   *  names in returns to the file picker it was opened from. */
  function openDoor(next: Door) {
    setDoor(next);
    go("bring", { mode: next === "typeIn" ? "type" : "file" });
  }

  // ── typing people in by hand ────────────────────────────────────────
  function updateTyped(index: number, field: "name" | "email", value: string) {
    setTyped((prev) => prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)));
  }
  function addTypedRow() {
    setTyped((prev) => [...prev, { name: "", email: "" }]);
  }
  function removeTypedRow(index: number) {
    setTyped((prev) => prev.filter((_, i) => i !== index));
  }

  // ── decide, and the write itself ────────────────────────────────────
  // B2139 — "was on the trip" starts on: the people brought in here are the
  // ones from the trip. Only an explicit false turns it off.
  const onTrip = (email: string) => wasOnTrip[email] !== false;
  function toggleWasOnTrip(email: string) {
    setWasOnTrip((prev) => ({ ...prev, [email]: prev[email] === false }));
  }

  async function commit() {
    setBusy(true);
    setCommitError(null);
    try {
      const body = JSON.stringify({
        vcard_rows: JSON.stringify(chosen.map((row) => ({ name: row.name, email: row.email, tel: row.tel }))),
        ...Object.fromEntries(chosen.map((_, i) => [`sel_${i}`, "1"])),
      });
      const res = await fetch(`/api/helper/${encodeURIComponent(username)}/contacts/import`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
      });
      const json = (await res.json().catch(() => null)) as ImportResponse | null;
      if (!res.ok || !json) {
        setCommitError(t("studio.people.decide.error"));
        return;
      }

      // Naming somebody on the trip's own byline is a second, separate call
      // — a contact request and a day's "who was there" are different
      // things (the storyboard's own warning: "two flows that must not
      // merge"). Best-effort: a trip-membership failure must not undo the
      // contact rows that were just filed.
      if (tripId) {
        for (const row of chosen) {
          if (!row.email || !onTrip(row.email)) continue;
          try {
            await fetch(`/api/helper/${encodeURIComponent(username)}/trip/people`, {
              method: "PATCH",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ trip: tripId, person: row.name, email: row.email }),
            });
          } catch {
            // The contact still filed; only the trip byline failed.
          }
        }
      }

      setResult(json);
      const withoutFigures = chosen.filter((row) => row.email && !figuresByEmail[row.email]);
      setPendingDraw(withoutFigures);
      setOutcome(withoutFigures.length > 0 ? "draw" : "done");
      reset();
    } catch {
      setCommitError(t("studio.people.decide.error"));
    } finally {
      setBusy(false);
    }
  }

  const tripTitle = trips.find((tr) => tr.id === tripId)?.title ?? tripId;
  const filed = result?.filed ?? 0;
  const withEmail = cardPeople.filter((row) => row.email).length;

  return (
    <StepBody step={step}>
      {!outcome && step === "what" && (
        <>
          <div className="mt-4">
            <StepIndicator total={total} current={1} label={t("studio.people.what.stepLabel")} />
          </div>
          <WhatStep
            inStudioBar
            title={t("studio.people.what.title")}
            // B1900 — the flow's own <h1> above already announces this screen.
            hideHeading
            consequence={t("studio.people.what.consequence")}
            promise={t("studio.people.what.promise")}
            cta={{ label: t("studio.people.what.cta"), onContinue: () => go("get") }}
          />
          {people && <PeopleYouHave username={username} people={people} />}
        </>
      )}

      {!outcome && step === "get" && (
        <div className="mt-4">
          <StepIndicator total={total} current={2} label={t("studio.people.getIt.stepLabel")} />
          <h2 className="font-display text-lg font-semibold text-ink-strong">{t("studio.people.getIt.heading")}</h2>
          <p className="mt-2 text-sm text-ink-body">{t("studio.people.getIt.intro")}</p>

          <div className="mt-3 flex gap-2">
            {(["android", "iphone", "google"] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPlatform(p)}
                aria-pressed={platform === p}
                className={`min-h-11 rounded-full border px-3 text-sm font-semibold ${
                  platform === p ? "border-ink-strong text-ink-strong" : "border-line-strong text-ink-secondary"
                }`}
              >
                {t(`studio.people.getIt.platform.${p}` as TranslationKey)}
              </button>
            ))}
          </div>

          <div className="mt-3 whitespace-pre-line rounded-xl border border-line-strong px-4 py-3 text-sm text-ink-body">
            {t(`studio.people.getIt.steps.${platform}` as TranslationKey)}
          </div>
          <p className="mt-2 text-xs text-ink-secondary">{t("studio.people.getIt.noEmailNote")}</p>

          <StepPrimary onClick={() => openDoor("upload")} label={t("studio.people.getIt.haveFile")} />
          <button
            type="button"
            onClick={() => openDoor("typeIn")}
            className="mt-4 block min-h-11 text-left text-sm font-semibold text-ink-body underline underline-offset-2"
          >
            {t("studio.people.getIt.typeInstead")}
          </button>
        </div>
      )}

      {!outcome && step === "bring" && door === "upload" && cardPeople.length === 0 && (
        <div className="mt-4">
          <StepIndicator total={total} current={3} label={t("studio.people.upload.stepLabel")} />
          <h2 className="font-display text-lg font-semibold text-ink-strong">{t("studio.people.upload.heading")}</h2>

          <PhotoPicker
            id="people-vcard"
            accept=".vcf,text/vcard"
            chosen={file ? [file] : []}
            showChosen={!!file}
            onPick={(files) => setFile(files?.[0] ?? null)}
          />
          <StepPrimary
            busy={uploadBusy}
            busyLabel={t("studio.people.upload.uploading")}
            disabled={!file}
            onClick={() => void readCard()}
            label={t("studio.people.upload.button")}
          />
          {uploadError && (
            <p role="alert" className="mt-2 text-sm text-coral-600">
              {t(uploadError)}
            </p>
          )}

          <button
            type="button"
            onClick={() => openDoor("typeIn")}
            className="mt-3 block min-h-11 text-left text-sm font-semibold text-ink-body underline underline-offset-2"
          >
            {t("studio.people.getIt.typeInstead")}
          </button>
        </div>
      )}

      {!outcome && step === "bring" && door === "upload" && cardPeople.length > 0 && withEmail > 0 && (
        <div className="mt-4">
          <StepIndicator total={total} current={3} label={t("studio.people.peek.stepLabel")} />
          <h2 className="font-display text-lg font-semibold text-ink-strong">
            {tn("studio.people.peek.heading", cardPeople.length, { count: String(cardPeople.length) })}
          </h2>
          <p className="mt-2 text-sm text-ink-secondary">{t("studio.people.peek.notWritten")}</p>

          <ul className="mt-3 divide-y divide-line-faint rounded-xl border border-line-strong">
            {cardPeople.map((row, i) => (
              <li key={i} className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="flex items-center gap-2 text-sm">
                  {row.email && (
                    <input type="checkbox" checked={selected.has(i)} onChange={() => toggleSelected(i)} />
                  )}
                  <span className={row.email ? "text-ink-strong" : "text-ink-secondary"}>{row.name}</span>
                </span>
                <span className={`text-right text-xs ${row.email ? "text-ink-body" : "italic text-ink-secondary"}`}>
                  {row.email ?? t("studio.people.peek.noEmail")}
                </span>
              </li>
            ))}
          </ul>

          <StepPrimary
            disabled={selected.size === 0}
            onClick={() => go("decide")}
            label={tn("studio.people.peek.cta", selected.size, { count: String(selected.size) })}
          />
          <button
            type="button"
            onClick={() => {
              setFile(null);
              setCardPeople([]);
            }}
            className="mt-4 block min-h-11 text-left text-sm font-semibold text-ink-body underline underline-offset-2"
          >
            {t("studio.people.peekEmpty.tryAnother")}
          </button>
        </div>
      )}

      {!outcome && step === "bring" && door === "upload" && cardPeople.length > 0 && withEmail === 0 && (
        <div className="mt-4">
          <StepIndicator total={total} current={3} label={t("studio.people.peek.stepLabel")} />
          <div className="rounded-xl border border-coral-300 bg-coral-50 px-4 py-3 text-sm text-ink-body">
            <p className="font-semibold text-ink-strong">{t("studio.people.peekEmpty.banner")}</p>
            <p className="mt-1">{tn("studio.people.peekEmpty.detail", cardPeople.length, { count: String(cardPeople.length) })}</p>
          </div>
          <ul className="mt-3 divide-y divide-line-faint rounded-xl border border-line-strong">
            {cardPeople.map((row, i) => (
              <li key={i} className="flex items-center justify-between px-4 py-2 text-sm">
                <span className="text-ink-secondary">{row.name}</span>
                <em className="text-ink-secondary">{t("studio.people.peekEmpty.phoneOnly")}</em>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-ink-body">{t("studio.people.peekEmpty.hint")}</p>
          <StepPrimary onClick={() => openDoor("typeIn")} label={t("studio.people.peekEmpty.typeIn")} />
          <button
            type="button"
            onClick={() => {
              setFile(null);
              setCardPeople([]);
            }}
            className="mt-4 block min-h-11 text-left text-sm font-semibold text-ink-body underline underline-offset-2"
          >
            {t("studio.people.peekEmpty.tryAnother")}
          </button>
        </div>
      )}

      {!outcome && step === "bring" && door === "typeIn" && (
        <div className="mt-4">
          <StepIndicator total={total} current={3} label={t("studio.people.typeIn.stepLabel")} />
          <h2 className="font-display text-lg font-semibold text-ink-strong">{t("studio.people.typeIn.heading")}</h2>
          <p className="mt-2 text-sm text-ink-body">{t("studio.people.typeIn.intro")}</p>

          <div className="mt-3 flex flex-col gap-3">
            {typed.map((row, i) => (
              <div key={i} className="rounded-xl border border-line-strong px-3 py-3">
                <label className="block text-xs font-semibold uppercase tracking-wide text-ink-secondary">
                  {t("studio.people.field.name")}
                  <input
                    type="text"
                    value={row.name}
                    onChange={(e) => updateTyped(i, "name", e.target.value)}
                    className="mt-1 block min-h-11 w-full rounded-xl border border-line-strong bg-surface-base px-3 text-sm text-ink-body"
                  />
                </label>
                <label className="mt-2 block text-xs font-semibold uppercase tracking-wide text-ink-secondary">
                  {t("studio.people.field.email")}
                  <input
                    type="email"
                    value={row.email}
                    onChange={(e) => updateTyped(i, "email", e.target.value)}
                    className="mt-1 block min-h-11 w-full rounded-xl border border-line-strong bg-surface-base px-3 text-sm text-ink-body"
                  />
                </label>
                {typed.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeTypedRow(i)}
                    className="mt-2 min-h-11 text-sm font-semibold text-ink-body underline underline-offset-2"
                  >
                    {t("studio.people.typeIn.remove")}
                  </button>
                )}
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={addTypedRow}
            className="mt-3 min-h-11 text-sm font-semibold text-ink-body underline underline-offset-2"
          >
            {t("studio.people.typeIn.addAnother")}
          </button>

          <StepPrimary disabled={chosen.length === 0} onClick={() => go("decide")} label={t("studio.people.typeIn.continue")} />
        </div>
      )}

      {!outcome && step === "decide" && (
        <div className="mt-4">
          <StepIndicator total={total} current={4} label={t("studio.people.decide.stepLabel")} />
          <h2 className="font-display text-lg font-semibold text-ink-strong">{t("studio.people.decide.heading")}</h2>
          <p className="mt-2 text-sm text-ink-body">
            {tn("studio.people.decide.count", chosen.length, { count: String(chosen.length) })}
          </p>

          {trips.length > 1 && (
            <label className="mt-3 block text-xs font-semibold uppercase tracking-wide text-ink-secondary">
              {t("studio.people.decide.tripLabel")}
              <select
                value={tripId}
                onChange={(e) => setTripId(e.target.value)}
                className="mt-1 block min-h-11 w-full rounded-xl border border-line-strong bg-surface-base px-3 text-sm text-ink-body"
              >
                {trips.map((tr) => (
                  <option key={tr.id} value={tr.id}>
                    {tr.title}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className="mt-3 flex flex-col gap-2">
            {chosen.map((row, i) => (
              <div key={i} className="rounded-xl border border-line-strong px-4 py-3">
                <div className="flex items-center gap-2">
                  {row.email && figuresByEmail[row.email] && (
                    <img
                      src={`/api/v2/${encodeURIComponent(username)}/figures/preview?figure=${encodeURIComponent(
                        JSON.stringify(figuresByEmail[row.email]),
                      )}&size=44`}
                      alt=""
                      width={26}
                      height={42}
                    />
                  )}
                  <p className="font-display text-base font-semibold text-ink-strong">{row.name}</p>
                </div>
                <p className="text-xs text-ink-secondary">{row.email}</p>
                {row.email && figuresByEmail[row.email] && (
                  <p className="text-xs text-ink-secondary">{t("studio.people.decide.hasFigure")}</p>
                )}
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() => row.email && toggleWasOnTrip(row.email)}
                    aria-pressed={!!(row.email && onTrip(row.email))}
                    className={`min-h-11 rounded-full border px-3 text-sm font-semibold ${
                      row.email && onTrip(row.email)
                        ? "border-ink-strong text-ink-strong"
                        : "border-line-strong text-ink-secondary"
                    }`}
                  >
                    {t("studio.people.decide.wasOnTrip")}
                  </button>
                </div>
                {row.email && onTrip(row.email) && (
                  <p className="mt-1 text-xs text-ink-secondary">{tripTitle}</p>
                )}
              </div>
            ))}
          </div>

          <div className="mt-4 rounded-xl border border-line-strong bg-surface-subtle px-3 py-2 text-sm text-ink-body">
            {t("studio.people.decide.warning")}
          </div>

          <StepPrimary
            busy={busy}
            busyLabel={t("studio.people.decide.busy")}
            disabled={chosen.length === 0}
            onClick={commit}
            label={t("studio.people.decide.cta")}
            tone="bg-yellow-400 text-yellow-950 hover:bg-yellow-300"
          />
          <SubmitError message={commitError} />
        </div>
      )}

      {outcome === "draw" && drawingPerson && drawingPerson.email && (
        <FigureCreator
          username={username}
          initial={null}
          person={{ name: drawingPerson.name, email: drawingPerson.email }}
          photoConsent={photoConsent}
          photoCredits={photoCredits}
          existingIds={Object.values(figuresByEmail).map((f) => f.id)}
          onSaved={(saved) => {
            setFiguresByEmail((prev) => (saved.person ? { ...prev, [saved.person]: saved } : prev));
            setDrawingPerson(null);
            dropFromDraw(drawingPerson.email);
          }}
          onCancel={() => setDrawingPerson(null)}
        />
      )}

      {outcome === "draw" && !drawingPerson && (
        <div className="mt-4">
          <h2 className="font-display text-lg font-semibold text-ink-strong">{t("studio.people.draw.heading")}</h2>
          <p className="mt-2 text-sm text-ink-body">
            {tn("studio.people.draw.intro", pendingDraw.length, { count: String(pendingDraw.length) })}
          </p>

          <div className="mt-3 flex flex-col gap-2">
            {pendingDraw.map((row) => (
              <div key={row.email} className="flex flex-col gap-2 rounded-xl border border-line-strong px-4 py-3">
                <div>
                  <p className="font-display text-base font-semibold text-ink-strong">{row.name}</p>
                  <p className="text-xs text-ink-secondary">{row.email}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setDrawingPerson(row)}
                    className="min-h-11 rounded-full bg-action-strong px-4 text-sm font-semibold text-on-action"
                  >
                    {t("studio.people.draw.action", { name: row.name })}
                  </button>
                  <button
                    type="button"
                    onClick={() => dropFromDraw(row.email)}
                    className="min-h-11 rounded-full border border-line-strong px-4 text-sm font-semibold text-ink-body"
                  >
                    {t("studio.people.draw.notNow")}
                  </button>
                </div>
              </div>
            ))}
          </div>

          <p className="mt-3 text-xs text-ink-secondary">{t("studio.people.draw.note")}</p>

          <button
            type="button"
            onClick={() => {
              setPendingDraw([]);
              setOutcome("done");
            }}
            className="mt-3 min-h-11 text-sm font-semibold text-ink-body underline underline-offset-2"
          >
            {t("studio.people.draw.skipAll")}
          </button>
        </div>
      )}

      {outcome === "done" && result && (
        <>
          <DoneScreen
            username={username}
            done={tn("studio.people.done.banner", filed, { count: String(filed) })}
            next={[
              {
                title: t("studio.people.done.moreTitle"),
                href: `/${username}/studio/people`,
                label: t("studio.people.done.more"),
              },
              // A query, not only the fragment: the same path with just a
              // `#` would scroll this done screen instead of reloading the
              // page whose list now holds them.
              {
                title: t("studio.people.done.everyoneTitle"),
                href: `/${username}/studio/people?everyone=1#people-you-have`,
                label: t("studio.people.done.everyone"),
              },
            ]}
          />
          {(result.invalid ?? 0) > 0 && (
            <p className="mt-2 text-sm text-ink-secondary">
              {tn("studio.people.done.invalid", result.invalid ?? 0, { count: String(result.invalid) })}
            </p>
          )}
        </>
      )}
    </StepBody>
  );
}

function mapReadError(code: string | undefined): TranslationKey {
  if (code && code in READ_ERROR_KEYS) return READ_ERROR_KEYS[code];
  return "studio.people.error.generic";
}
