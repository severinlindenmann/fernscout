"use client";

import { useState } from "react";
import BusyButton from "@/components/BusyButton";
import type { Locale } from "@/lib/types";
import { DOOR_PRIMARY, DOOR_SECONDARY } from "./AddPersonDoor";
import ShareLink from "./ShareLink";
import { GroupPicker } from "./groups";
import type { AdminGroup, Count, Translate } from "./shared";

const FIELD =
  "mt-1 min-h-11 w-full rounded-xl border border-line-strong bg-surface-raised px-3 text-base text-ink-strong";
const LABEL = "block text-sm font-semibold text-ink-strong";
const DAYS = [7, 30, 90] as const;
// B-2963 — a trip link: 30 days, a year, or 0 = until the owner stops it.
const READ_DAYS = [30, 365, 0] as const;

type Created = { url: string; note: string; kind: "guest" | "buddy" | "read"; tripTitle: string | null; expiresAt: string | null };

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
  groups = [],
  onCreated,
  journalTitle = username,
  siteName = "Fernscout",
}: {
  username: string;
  locale: Locale;
  trips: { id: string; title: string; visibility?: string }[];
  t: Translate;
  tn: Count;
  /** TIX-6 — the owner's reader groups; the picker is absent while there are none. */
  groups?: AdminGroup[];
  onCreated: () => void;
  /** The journal's own title — the share text's "{trip}" for a guest link
   *  (B2444); a buddy link uses the trip's own title instead. */
  journalTitle?: string;
  siteName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<"guest" | "buddy" | "read">("guest");
  const [tripId, setTripId] = useState(trips[0]?.id ?? "");
  const [note, setNote] = useState("");
  const [days, setDays] = useState<number>(30);
  const [readTripId, setReadTripId] = useState(trips.find((trip) => trip.visibility === "guest")?.id ?? "");
  const hasGuestTrip = trips.some((trip) => trip.visibility === "guest");
  const [groupId, setGroupId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Created | null>(null);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const isRead = kind === "read";
      const response = await fetch(`/api/web/${encodeURIComponent(username)}/${isRead ? "trip-links" : "invites"}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          isRead
            ? { trip: readTripId, ...(days === 0 ? { neverExpires: true } : { days }), ...(note.trim() ? { name: note.trim() } : {}) }
            : {
          kind,
          ...(kind === "buddy" ? { trip: tripId } : {}),
          ...(note.trim() ? { name: note.trim() } : {}),
          expiresAt: new Date(Date.now() + days * 86_400_000).toISOString(),
          ...(groupId ? { group: groupId } : {}),
        },
        ),
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
        tripTitle:
          kind === "buddy" || kind === "read"
            ? (trips.find((trip) => trip.id === (kind === "read" ? readTripId : tripId))?.title ?? null)
            : null,
        expiresAt: body?.expiresAt ?? null,
      });
      // no-refresh: onCreated is ReadersAdmin's own `refresh`, which already
      // calls router.refresh() right after this save succeeds.
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
    setDays(30);
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
            className="stroke-ink-strong"
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
            <div className="grid gap-2 sm:grid-cols-3">
              {(["guest", "buddy", "read"] as const).map((value) => {
                const disabled = (value === "buddy" && trips.length === 0) || (value === "read" && !hasGuestTrip);
                return (
                  <label
                    key={value}
                    className={`flex cursor-pointer gap-2 rounded-xl border p-3 ${
                      kind === value ? "border-2 border-line-ink bg-yellow-50" : "border-line-quiet bg-surface-raised"
                    } ${disabled ? "cursor-not-allowed opacity-60" : ""}`}
                  >
                    <input type="radio" name="link-kind" className="mt-1 size-4" checked={kind === value} disabled={disabled} onChange={() => {
                        setKind(value);
                        setDays(value === "read" ? 0 : 30);
                      }} />
                    <span>
                      <span className="block font-semibold text-ink-strong">{t(`readers.link.kind.${value}`)}</span>
                      <span className="block text-sm text-ink-secondary">
                        {disabled ? t(value === "read" ? "readers.link.noGuestTrip" : "readers.add.noTrip") : t(`readers.link.kind.${value}Hint`)}
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
          {kind === "read" && (
            <label className={LABEL}>
              {t("readers.add.trip")}
              <select className={FIELD} value={readTripId} onChange={(e) => setReadTripId(e.target.value)}>
                {trips.map((trip) => {
                  if (trip.visibility === "public") return null;
                  const open = trip.visibility === "guest";
                  return (
                    <option key={trip.id} value={trip.id} disabled={!open}>
                      {open ? trip.title : `${trip.title} — ${t("readers.link.openToGuestsFirst")}`}
                    </option>
                  );
                })}
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
              <select className={FIELD} value={days} onChange={(e) => setDays(Number(e.target.value))}>
                {(kind === "read" ? READ_DAYS : DAYS).map((value) => (
                  <option key={value} value={value}>
                    {value === 0
                      ? t("readers.link.untilStop")
                      : value === 365
                        ? t("readers.link.year")
                        : tn("readers.link.days", value, { count: String(value) })}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {kind !== "read" && (
          <GroupPicker
            groups={groups}
            value={groupId}
            onChange={setGroupId}
            legend={t("readers.groups.linkLegend")}
            hint={t("readers.groups.linkHint")}
            noneLabel={t("readers.groups.none")}
            name="link-group"
          />
          )}
          <p className="text-sm text-ink-secondary">
            {kind === "read"
              ? t("readers.link.promiseRead", { trip: trips.find((trip) => trip.id === readTripId)?.title ?? "" })
              : t("readers.link.promise")}
          </p>
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
                : created.kind === "read"
                  ? t("readers.link.kindReadOf", { trip: created.tripTitle ?? "" })
                  : t("readers.link.kind.guest"),
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <ShareLink
            username={username}
            url={created.url}
            title={created.kind !== "guest" ? (created.tripTitle ?? journalTitle) : journalTitle}
            text={t("readers.share.text", {
              trip: created.kind !== "guest" ? (created.tripTitle ?? journalTitle) : journalTitle,
              site: siteName,
            })}
            t={t}
            big
          />
          {created.expiresAt ? (
            <p className="text-sm text-ink-secondary">{t("readers.link.worksUntil", { date: until(created.expiresAt) ?? "" })}</p>
          ) : (
            created.kind === "read" && <p className="text-sm text-ink-secondary">{t("readers.link.worksUntilStopped")}</p>
          )}
          {created.kind !== "read" && (
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
          )}
          <button type="button" className="min-h-11 self-start text-sm font-semibold text-ink-strong underline underline-offset-2" onClick={reset}>
            {t("notifyStep.done")}
          </button>
        </div>
      )}
    </section>
  );
}
