"use client";

import { useState } from "react";
import BusyButton from "@/components/BusyButton";
import type { Locale } from "@/lib/types";
import { DOOR_PRIMARY, DOOR_SECONDARY } from "./AddPersonDoor";
import ShareLink from "./ShareLink";
import type { Count, Translate } from "./shared";

const FIELD =
  "mt-1 min-h-11 w-full rounded-xl border border-line-strong bg-surface-raised px-3 text-base text-ink-strong";
const LABEL = "block text-sm font-semibold text-ink-strong";
const DAYS = [7, 30, 90] as const;

type Created = { url: string; note: string; kind: "guest" | "buddy"; tripTitle: string | null; expiresAt: string | null };

/**
 * Door 2 · "Share an invite link" — B2291. One link for a group: readers, or
 * buddies of one trip; a note only the owner sees ("Family chat"); an expiry
 * (30 days by default). Whoever opens it proves an email or a mobile number
 * and becomes a request under "Waiting for your answer" — **nobody gets in
 * without the owner's yes.**
 *
 * No QR code: the app carries no QR encoder, and one is not worth a new
 * dependency before the owner asks for it (see the ticket). The link is shown
 * big, with Copy and — where the device has one — the system share sheet.
 */
export default function InviteLinkDoor({
  username,
  locale,
  trips,
  t,
  tn,
  onCreated,
}: {
  username: string;
  locale: Locale;
  trips: { id: string; title: string }[];
  t: Translate;
  tn: Count;
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"guest" | "buddy">("guest");
  const [tripId, setTripId] = useState(trips[0]?.id ?? "");
  const [note, setNote] = useState("");
  const [days, setDays] = useState<(typeof DAYS)[number]>(30);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/web/${encodeURIComponent(username)}/invites`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind,
          ...(kind === "buddy" ? { trip: tripId } : {}),
          ...(note.trim() ? { name: note.trim() } : {}),
          expiresAt: new Date(Date.now() + days * 86_400_000).toISOString(),
        }),
      });
      const body = (await response.json().catch(() => null)) as
        | { url?: string; joinUrl?: string | null; expiresAt?: string | null }
        | null;
      const url = body?.joinUrl ?? body?.url;
      if (!response.ok || !url) {
        setError(t("readers.link.error"));
        return;
      }
      setCreated({
        url,
        note: note.trim(),
        kind,
        tripTitle: kind === "buddy" ? (trips.find((trip) => trip.id === tripId)?.title ?? null) : null,
        expiresAt: body?.expiresAt ?? null,
      });
      onCreated();
    } catch {
      setError(t("readers.link.error"));
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setOpen(false);
    setCreated(null);
    setNote("");
    setKind("guest");
    setError(null);
  }

  const until = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleDateString(locale === "en" ? "en-GB" : locale, { day: "numeric", month: "long", timeZone: "UTC" })
      : null;

  return (
    <section aria-labelledby="door-link" className="flex flex-col gap-3 rounded-2xl border border-line-quiet bg-surface-raised p-5">
      <div className="flex items-center gap-3">
        <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden className="shrink-0">
          <circle cx="20" cy="20" r="20" className="fill-surface-subtle" />
          <path
            d="M17 23l6-6M15 19l-3 3a4 4 0 0 0 6 6l3-3M25 21l3-3a4 4 0 0 0-6-6l-3 3"
            fill="none"
            className="stroke-navy-900"
            strokeWidth="2.4"
            strokeLinecap="round"
          />
        </svg>
        <h2 id="door-link" className="font-display text-xl font-semibold text-ink-strong">
          {t("readers.link.title")}
        </h2>
      </div>

      {!open && (
        <>
          <p className="text-base text-ink-body">{t("readers.link.body")}</p>
          <p className="text-sm text-ink-secondary">{t("readers.link.hint")}</p>
          <button type="button" className={`${DOOR_SECONDARY} self-start`} onClick={() => setOpen(true)}>
            {t("readers.link.open")}
          </button>
        </>
      )}

      {open && !created && (
        <form onSubmit={create} className="flex flex-col gap-4">
          <fieldset>
            <legend className="sr-only">{t("readers.link.kindLegend")}</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {(["guest", "buddy"] as const).map((value) => {
                const disabled = value === "buddy" && trips.length === 0;
                return (
                  <label
                    key={value}
                    className={`flex cursor-pointer gap-2 rounded-xl border p-3 ${
                      kind === value ? "border-2 border-line-ink bg-yellow-50" : "border-line-quiet bg-surface-raised"
                    } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
                  >
                    <input type="radio" name="link-kind" className="mt-1 size-4" checked={kind === value} disabled={disabled} onChange={() => setKind(value)} />
                    <span>
                      <span className="block font-semibold text-ink-strong">{t(`readers.link.kind.${value}`)}</span>
                      <span className="block text-sm text-ink-secondary">
                        {disabled ? t("readers.add.noTrip") : t(`readers.link.kind.${value}Hint`)}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          {kind === "buddy" && (
            <label className={LABEL}>
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
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={LABEL}>
              {t("readers.link.note")}
              <input className={FIELD} value={note} maxLength={120} placeholder={t("readers.link.notePlaceholder")} onChange={(e) => setNote(e.target.value)} />
            </label>
            <label className={LABEL}>
              {t("readers.link.expiry")}
              <select className={FIELD} value={days} onChange={(e) => setDays(Number(e.target.value) as (typeof DAYS)[number])}>
                {DAYS.map((value) => (
                  <option key={value} value={value}>
                    {tn("readers.link.days", value, { count: String(value) })}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="text-sm text-ink-secondary">{t("readers.link.promise")}</p>
          {error && (
            <p role="alert" className="text-sm text-coral-600">
              {error}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-4">
            <BusyButton busy={busy} type="submit" className={DOOR_PRIMARY}>
              {t("readers.link.create")}
            </BusyButton>
            <button type="button" className="min-h-11 text-sm font-semibold text-ink-strong underline underline-offset-2" onClick={reset}>
              {t("readers.cancel")}
            </button>
          </div>
        </form>
      )}

      {created && (
        <div className="flex flex-col gap-4" aria-live="polite">
          <p className="font-semibold text-ink-strong">
            {[
              created.note || null,
              created.kind === "buddy"
                ? t("readers.link.kindBuddyOf", { trip: created.tripTitle ?? "" })
                : t("readers.link.kind.guest"),
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <ShareLink url={created.url} t={t} big />
          {created.expiresAt && (
            <p className="text-sm text-ink-secondary">{t("readers.link.worksUntil", { date: until(created.expiresAt) ?? "" })}</p>
          )}
          <ol className="grid gap-3 border-t border-line-quiet pt-4 sm:grid-cols-3">
            {(["readers.link.step1", "readers.link.step2", "readers.link.step3"] as const).map((key, index) => (
              <li key={key} className="flex gap-2 text-sm text-ink-body">
                <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-full bg-yellow-400 text-xs font-bold text-navy-900">
                  {index + 1}
                </span>
                {t(key)}
              </li>
            ))}
          </ol>
          <button type="button" className="min-h-11 self-start text-sm font-semibold text-ink-strong underline underline-offset-2" onClick={reset}>
            {t("notifyStep.done")}
          </button>
        </div>
      )}
    </section>
  );
}
