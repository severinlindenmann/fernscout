"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { plural, translate, type TranslationKey } from "@/lib/i18n";
import { splitReaders } from "@/lib/readers/split";
import type { Locale } from "@/lib/types";
import AddPersonDoor from "./AddPersonDoor";
import InviteLinkDoor from "./InviteLinkDoor";
import LinksList from "./LinksList";
import ReaderPreview from "./ReaderPreview";
import type { TripPreview } from "@/lib/studio/audiencePreview";
import { ReaderGroup, type CardEnv, type GuestFormEnv } from "./ReaderCard";
import { notOpenedYet, viaLabel, type AdminContact, type AdminInvite } from "./shared";

/**
 * Studio › Readers — **the only place a person is let in** (B2291, "Two
 * doors, one page"). Two door cards, then the groups by whose turn it is:
 * waiting for your answer · invited, not opened yet · not invited yet ·
 * reading along · the links you've shared · access taken away (collapsed).
 *
 * The data arrives already fetched from the server component above, which did
 * the owner check. Every button goes back through a route that does it again
 * — a page that renders is not an authorisation. The split is `splitReaders`,
 * the same function the hub's chip counts with.
 *
 * Provider-free except for the step-2 panel (`NotifyStep`, which reads the
 * locale context the `[user]` layout provides), so the row tests can render
 * it alone.
 */
export default function ReadersAdmin({
  username,
  locale,
  locales,
  dictionary,
  contacts,
  invites,
  trips = [],
  hasGuestTrip,
  highlightId,
  postcardsEnabled = true,
  pushEnabled = false,
  whatsappEnabled = true,
  defaultCountryCode,
  addressLookupEnabled = false,
  ownEmail = null,
  preview = [],
}: {
  username: string;
  locale: Locale;
  /** The trips a buddy can be added to, or a buddy link can name. */
  trips?: { id: string; title: string }[];
  /** Whether an approved guest could read any trip at all (B300, B638). */
  hasGuestTrip: boolean;
  locales: string[];
  dictionary: Record<string, string>;
  contacts: AdminContact[];
  invites: AdminInvite[];
  /** The request the owner's approval mail was about — B319. */
  highlightId?: string;
  postcardsEnabled?: boolean;
  pushEnabled?: boolean;
  whatsappEnabled?: boolean;
  defaultCountryCode?: string;
  addressLookupEnabled?: boolean;
  /** The owner's own address, left out of every group (B621) — their own
   * details live under Settings since B2291. */
  ownEmail?: string | null;
  /** What a reader would see (B2130/B2132): `previewJournal(username, "guest")`. */
  preview?: TripPreview[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<AdminContact | null>(null);
  const [notes, setNotes] = useState<CardEnv["notes"]>({});

  const t = (key: TranslationKey, vars?: Record<string, string>) => translate(dictionary, key, vars);
  const tn = (key: TranslationKey, count: number, vars?: Record<string, string>) =>
    plural(dictionary, key, count, vars);

  /** Every list on this page is the server's: re-render it rather than keep
   * a second copy in the browser that can drift from what the gates read. */
  function refresh() {
    router.refresh();
  }

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    const response = await fetch("/api/contacts/admin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user: username, ...body }),
    }).catch(() => null);
    setBusy(false);
    refresh();
    return response;
  }

  /** Let in (or back in) and Decline / Take access away — reached only from
   * the card's ConfirmPanel, then said back as a status line on that card. */
  async function confirmed(contact: AdminContact, action: "letin" | "revoke") {
    const name = contact.name ?? contact.email;
    let text: string | null = null;
    if (action === "letin") {
      setBusy(true);
      const response = await fetch(`/api/web/${encodeURIComponent(username)}/readers/letin`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contactId: contact.id }),
      }).catch(() => null);
      setBusy(false);
      const body = (await response?.json().catch(() => null)) as
        | { tripsOpened?: string[]; told?: "email" | "sms" | null }
        | null;
      if (response?.ok && body) {
        const trips = body.tripsOpened ?? [];
        text = [
          trips.length
            ? t("contact.adminApprovedTrips", { trips: trips.join(", ") })
            : t("contact.adminApprovedNoTrip"),
          body.told ? t(body.told === "email" ? "readers.toldByEmail" : "readers.toldBySms", { name }) : "",
        ]
          .filter(Boolean)
          .join(" ");
      }
      refresh();
    } else {
      const response = await act({ action: "revoke", id: contact.id });
      if (response?.ok) text = t("contact.adminRevoked", { name });
    }
    setNotes((previous) => ({
      ...previous,
      [contact.id]: text ? { text } : { text: t("contact.adminActionFailed"), failed: true },
    }));
  }

  const split = splitReaders(contacts, ownEmail);
  const invited = [...split.readingNow.filter(notOpenedYet), ...split.waitingOnThem];
  const reading = split.readingNow.filter((contact) => !notOpenedYet(contact));

  const guestFormEnv: GuestFormEnv = {
    fallbackLocale: locale,
    locales,
    username,
    t,
    busy,
    act,
    postcardsEnabled,
    pushEnabled,
    whatsappEnabled,
    defaultCountryCode,
    addressLookupEnabled,
    onClose: () => setEditing(null),
  };
  const env: CardEnv = {
    t,
    tn,
    busy,
    locale,
    username,
    defaultCountryCode,
    act: (body) => void act(body),
    confirmed: (contact, action) => void confirmed(contact, action),
    refresh,
    onEdit: setEditing,
    via: (contact) => viaLabel(contact.createdVia, invites, trips, t),
    notes,
    highlightId,
    editingId: editing?.id ?? null,
    guestFormEnv: editing ? guestFormEnv : undefined,
  };

  // Put the highlighted request in view rather than merely marked — B319.
  useEffect(() => {
    if (!highlightId) return;
    document.getElementById(`contact-${highlightId}`)?.scrollIntoView({ block: "center" });
  }, [highlightId]);

  return (
    <div lang={locale}>
      {/* B300/B638 — said ahead of every Let in: letting somebody in opens
          nothing while no trip is open to guests. */}
      {!hasGuestTrip && (
        <p className="mt-6 rounded-xl border-2 border-coral-600 bg-coral-300 px-4 py-3 text-base text-on-bright">
          {t("readers.noGuestTrip")}
        </p>
      )}

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <AddPersonDoor username={username} locale={locale} locales={locales} trips={trips} t={t} onDone={refresh} />
        <InviteLinkDoor username={username} locale={locale} trips={trips} t={t} onCreated={refresh} />
      </div>
      {preview.length > 0 && <ReaderPreview preview={preview} t={t} tn={tn} />}

      <ReaderGroup title={t("contact.adminPending")} rows={split.waitingOnYou} kind="asking" env={env} />
      <ReaderGroup title={t("readers.group.invited")} rows={invited} kind="invited" env={env} />
      <ReaderGroup title={t("contact.adminNotInvited")} rows={split.notInvited} kind="notInvited" env={env} />
      <ReaderGroup
        title={t("readers.group.reading")}
        rows={reading}
        kind="reading"
        env={env}
        empty={t("readers.group.readingEmpty")}
      />

      <LinksList username={username} locale={locale} invites={invites} trips={trips} t={t} onStopped={refresh} />

      {split.revoked.length > 0 && (
        <details className="mt-10">
          <summary className="min-h-11 cursor-pointer py-2 font-semibold text-ink-strong underline underline-offset-2">
            {t("readers.group.revoked", { count: String(split.revoked.length) })}
          </summary>
          <ReaderGroup title={t("readers.group.revokedTitle")} rows={split.revoked} kind="revoked" env={env} />
        </details>
      )}

      <p className="mt-10 text-sm text-ink-secondary">
        {t("readers.ownDetailsMoved")}{" "}
        <a className="font-semibold text-ink-strong underline underline-offset-2" href={`/${username}/studio/journal#own-details`}>
          {t("readers.ownDetailsLink")}
        </a>
      </p>
    </div>
  );
}
