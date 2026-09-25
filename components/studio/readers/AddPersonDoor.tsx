"use client";

import { useState } from "react";
import BusyButton from "@/components/BusyButton";
import { LOCALE_LABEL } from "@/lib/i18n";
import type { Locale } from "@/lib/types";
import NotifyStep from "./NotifyStep";
import type { Translate } from "./shared";

/** Every refusal `POST /api/web/<user>/readers` answers, as its own sentence
 * — B2291: "already on the page" and "access was taken away" are different
 * things to be told, and neither is "something went wrong". */
const ERRORS: Record<string, Parameters<Translate>[0]> = {
  name_required: "readers.add.error.name",
  no_channel: "readers.add.error.noChannel",
  invalid_email: "readers.add.error.email",
  invalid_phone: "readers.add.error.phone",
  unknown_trip: "readers.add.error.trip",
  blocked_contact: "readers.add.error.blocked",
  conflict: "readers.add.error.conflict",
  not_approved: "readers.add.error.generic",
  too_many_requests: "readers.add.error.rateLimited",
};

const FIELD =
  "mt-1 min-h-11 w-full rounded-xl border border-line-strong bg-surface-raised px-3 text-base text-ink-strong";
const LABEL = "block text-sm font-semibold text-ink-strong";
export const DOOR_PRIMARY =
  "min-h-12 rounded-xl bg-yellow-400 px-5 text-base font-semibold text-navy-900 transition-colors hover:bg-yellow-300 disabled:opacity-50";
export const DOOR_SECONDARY =
  "min-h-12 rounded-xl border border-line-ink bg-surface-raised px-5 text-base font-semibold text-ink-strong hover:bg-surface-subtle disabled:opacity-50";

/**
 * Door 1 · "Add a person" — B2291. The owner knows who it is: a name, reader
 * or buddy of one trip, an email and/or a mobile (at least one, any country),
 * and the language to write to them in. Step 1 posts to
 * `/api/web/<user>/readers` (pre-approved, nothing sent); step 2 is
 * `NotifyStep` — how they hear about it.
 */
export default function AddPersonDoor({
  username,
  locale,
  locales,
  trips,
  t,
  onDone,
}: {
  username: string;
  locale: Locale;
  locales: string[];
  trips: { id: string; title: string }[];
  t: Translate;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [role, setRole] = useState<"reader" | "buddy">("reader");
  const [tripId, setTripId] = useState(trips[0]?.id ?? "");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [language, setLanguage] = useState<string>(locale);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState<{ id: string; updated: boolean } | null>(null);

  function reset() {
    setOpen(false);
    setName("");
    setRole("reader");
    setEmail("");
    setPhone("");
    setError(null);
    setAdded(null);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!email.trim() && !phone.trim()) {
      setError(t("readers.add.error.noChannel"));
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`/api/web/${encodeURIComponent(username)}/readers`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name,
          role,
          ...(role === "buddy" ? { tripId } : {}),
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
          locale: language,
        }),
      });
      const body = (await response.json().catch(() => null)) as
        | { ok?: boolean; outcome?: string; contact?: { id: string }; error?: string }
        | null;
      if (!response.ok || !body?.contact) {
        setError(t(ERRORS[body?.error ?? ""] ?? "readers.add.error.generic"));
        return;
      }
      setAdded({ id: body.contact.id, updated: body.outcome === "updated" });
      // They are on the page now, under "Invited — not opened yet".
      onDone();
    } catch {
      setError(t("readers.add.error.generic"));
    } finally {
      setBusy(false);
    }
  }

  const first = name.trim().split(/\s+/)[0] ?? "";

  return (
    <section
      aria-labelledby="door-add"
      className="flex flex-col gap-3 rounded-2xl border-2 border-line-ink bg-surface-raised p-5 md:col-span-1"
    >
      <div className="flex items-center gap-3">
        <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden className="shrink-0">
          <circle cx="20" cy="20" r="20" className="fill-yellow-400" />
          <circle cx="17" cy="16" r="5" fill="none" className="stroke-navy-900" strokeWidth="2.4" />
          <path d="M8 30c1.5-5 5-7 9-7s7.5 2 9 7" fill="none" className="stroke-navy-900" strokeWidth="2.4" strokeLinecap="round" />
          <path d="M30 12v8M26 16h8" className="stroke-navy-900" strokeWidth="2.4" strokeLinecap="round" />
        </svg>
        <h2 id="door-add" className="font-display text-xl font-semibold text-ink-strong">
          {t("readers.add.title")}
        </h2>
      </div>

      {!open && (
        <>
          <p className="text-base text-ink-body">{t("readers.add.body")}</p>
          <p className="text-sm text-ink-secondary">{t("readers.add.hint")}</p>
          <button type="button" className={`${DOOR_PRIMARY} self-start`} onClick={() => setOpen(true)}>
            {t("readers.add.open")}
          </button>
        </>
      )}

      {open && !added && (
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <p className="text-xs font-bold uppercase tracking-wide text-ink-secondary">{t("readers.add.step")}</p>
          <label className={LABEL}>
            {t("readers.add.name")}
            <input className={FIELD} value={name} onChange={(e) => setName(e.target.value)} required autoComplete="off" maxLength={120} />
          </label>
          <fieldset>
            <legend className={LABEL}>{t("readers.add.roleLegend")}</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {(["reader", "buddy"] as const).map((value) => {
                const disabled = value === "buddy" && trips.length === 0;
                return (
                  <label
                    key={value}
                    className={`flex cursor-pointer gap-2 rounded-xl border p-3 ${
                      role === value ? "border-2 border-line-ink bg-yellow-50" : "border-line-quiet bg-surface-raised"
                    } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
                  >
                    <input
                      type="radio"
                      name="add-role"
                      className="mt-1 size-4"
                      checked={role === value}
                      disabled={disabled}
                      onChange={() => setRole(value)}
                    />
                    <span>
                      <span className="block font-semibold text-ink-strong">{t(`readers.add.role.${value}`)}</span>
                      <span className="block text-sm text-ink-secondary">
                        {disabled ? t("readers.add.noTrip") : t(`readers.add.role.${value}Hint`)}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
            {role === "buddy" && (
              <label className={`${LABEL} mt-3`}>
                {t("readers.add.trip")}
                <select className={FIELD} value={tripId} onChange={(e) => setTripId(e.target.value)}>
                  {trips.map((trip) => (
                    <option key={trip.id} value={trip.id}>
                      {trip.title}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </fieldset>
          <fieldset className="flex flex-col gap-3">
            <legend className={LABEL}>
              {t("readers.add.reachLegend")}{" "}
              <span className="font-normal text-ink-secondary">{t("readers.add.oneIsEnough")}</span>
            </legend>
            <label className={LABEL}>
              {t("readers.add.email")}
              <input className={FIELD} type="email" inputMode="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <label className={LABEL}>
              {t("readers.add.mobile")}
              <input className={FIELD} type="tel" inputMode="tel" autoComplete="off" placeholder="+41 79 …" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </label>
          </fieldset>
          <label className={LABEL}>
            {t("readers.add.language")}
            <select className={FIELD} value={language} onChange={(e) => setLanguage(e.target.value)}>
              {locales.map((code) => (
                <option key={code} value={code}>
                  {LOCALE_LABEL[code as Locale] ?? code}
                </option>
              ))}
            </select>
          </label>
          {error && (
            <p role="alert" className="text-sm text-coral-600">
              {error}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-4">
            <BusyButton busy={busy} type="submit" className={DOOR_PRIMARY} disabled={!name.trim()}>
              {first ? t("readers.add.submitNamed", { name: first }) : t("readers.add.submit")}
            </BusyButton>
            <button type="button" className="min-h-11 text-sm font-semibold text-ink-strong underline underline-offset-2" onClick={reset}>
              {t("readers.cancel")}
            </button>
          </div>
          <p className="text-sm text-ink-secondary">{t("readers.add.promise")}</p>
        </form>
      )}

      {added && (
        <>
          {added.updated && (
            <p role="status" className="text-sm text-ink-body">
              {t("readers.add.updated", { name: first || name })}
            </p>
          )}
          <NotifyStep
            username={username}
            contactId={added.id}
            onLater={() => {
              reset();
              onDone();
            }}
          />
        </>
      )}
    </section>
  );
}
