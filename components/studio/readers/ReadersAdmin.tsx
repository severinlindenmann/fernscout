"use client";

import { useEffect, useState } from "react";
import type { ManageContact } from "@/components/ContactManage";
import { plural, translate, type TranslationKey } from "@/lib/i18n";
import { splitReaders } from "@/lib/readers/split";
import type { Locale } from "@/lib/types";
import { GuestForm } from "./GuestForm";
import InvitationLinks from "./InvitationLinks";
import OwnDetails from "./OwnDetails";
import { ReaderGroup, type CardEnv, type GuestFormEnv } from "./ReaderCard";
import { resendableInvite, viaLabel, type AdminContact, type AdminInvite } from "./shared";

/**
 * Who is waiting, who is in, and when they last looked (C6) — the readers
 * page's sections below the invite (B2133): waiting for your answer, waiting
 * for them, reading now, then the owner's own row and the invitation links.
 *
 * The data arrives already fetched from the server component above, which did
 * the owner check. Every button goes back through `/api/contacts/admin`, which
 * does it again: a page that renders is not an authorisation. The split is
 * `splitReaders`, the same function the hub's chip counts with.
 *
 * Provider-free on purpose, so the row tests can render it alone.
 */
export default function ReadersAdmin({
  username,
  locale,
  locales,
  dictionary,
  contacts: initialContacts,
  invites: initialInvites,
  trips = [],
  hasGuestTrip,
  highlightId,
  postcardsEnabled = true,
  pushEnabled = false,
  whatsappEnabled = true,
  defaultCountryCode,
  addressLookupEnabled = false,
  own,
  canAddOwn = false,
}: {
  username: string;
  locale: Locale;
  /** The trips a writing link can name. Empty is a real state — a journal with
   * no trip yet can issue a reading link and nothing else. */
  trips?: { id: string; title: string }[];
  /**
   * Whether an approved guest could read any trip in the journal at all —
   * `visibility: guest` (what an approval itself opens, B300) or
   * `visibility: public` (already open to everyone, approval or not). Only a
   * journal whose every trip is `private` leaves an approval opening nothing,
   * which is worth saying before the owner acts on it rather than after
   * (B638: a fully public journal was wrongly told it had nothing to open).
   */
  hasGuestTrip: boolean;
  /** The languages this journal offers, from its config. */
  locales: string[];
  dictionary: Record<string, string>;
  contacts: AdminContact[];
  invites: AdminInvite[];
  /**
   * The request the owner's approval mail (`notifyOwnerOfRequest`) was
   * about — B319. From the page's own `?contact=` query string, so the
   * button in that mail opens the queue with this one already in front of
   * the owner rather than merely at the top of a list they still have to
   * find.
   */
  highlightId?: string;
  /** B360: whether this server can act on a postcard request at all —
   * `isEnabled("postcards", username)`, from the page. Defaults to shown, the
   * same reasoning as `GuestForm`'s own default below. */
  postcardsEnabled?: boolean;
  /** Whether this journal offers notifications at all. Off, the note below the
   * tick boxes describes a channel that does not exist here. */
  pushEnabled?: boolean;
  /** B376: whether this server can act on a WhatsApp update at all —
   * `isEnabled("whatsapp", username)`, from the page. Same default reasoning. */
  whatsappEnabled?: boolean;
  /** B385: `whatsappCountryCode()` — passed through to `GuestForm`'s own
   * default, unrelated to whether WhatsApp itself is on. */
  defaultCountryCode?: string;
  /** B399: `isEnabled("addressLookup", username)`, from the page. */
  addressLookupEnabled?: boolean;
  /**
   * The owner's own row, when they have one — B621, moved here from
   * `/{user}/me`. Present and `canAddOwn` false is the ordinary state once
   * they have pressed the button once.
   */
  own?: { token: string; contact: ManageContact };
  /** Whether to offer to make one. True only for an owner who has none: a
   * guest gets a row by being invited and approved, which is the whole of
   * `lib/contacts`, and a button here would be a way around it. */
  canAddOwn?: boolean;
}) {
  const [contacts, setContacts] = useState(initialContacts);
  const [invites, setInvites] = useState(initialInvites);
  // A `router.refresh()` (the invite section's grant, B2133) hands new props;
  // take them, the way React's docs adjust state to a changed prop.
  const [seeded, setSeeded] = useState({ initialContacts, initialInvites });
  if (seeded.initialContacts !== initialContacts || seeded.initialInvites !== initialInvites) {
    setSeeded({ initialContacts, initialInvites });
    setContacts(initialContacts);
    setInvites(initialInvites);
  }
  const [busy, setBusy] = useState(false);
  // `null`: closed. `"new"`: the "Add a guest" link. Otherwise the row being
  // corrected. One form on the page at a time.
  const [formTarget, setFormTarget] = useState<"new" | AdminContact | null>(null);
  // B244, B2133 — the status line each Approve / Revoke / Resend left, by
  // contact id, so a card that moves group keeps saying what just happened.
  const [notes, setNotes] = useState<CardEnv["notes"]>({});

  const t = (key: TranslationKey, vars?: Record<string, string>) => translate(dictionary, key, vars);
  const tn = (key: TranslationKey, count: number, vars?: Record<string, string>) =>
    plural(dictionary, key, count, vars);

  async function refresh() {
    const response = await fetch(`/api/contacts/admin?user=${encodeURIComponent(username)}`).catch(() => null);
    if (!response?.ok) return;
    const body = (await response.json()) as { contacts: AdminContact[]; invites: AdminInvite[] };
    setContacts(body.contacts);
    setInvites(body.invites);
  }

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    const response = await fetch("/api/contacts/admin", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user: username, ...body }),
    }).catch(() => null);
    setBusy(false);
    await refresh();
    return response;
  }

  /** Approve, Revoke or Resend — reached only from the card's ConfirmPanel,
   * then said back as a status line on that card. */
  async function confirmed(contact: AdminContact, action: "approve" | "revoke" | "resend") {
    const name = contact.name ?? contact.email;
    const response = await act({ action, id: contact.id });
    const body = (await response?.json().catch(() => null)) as { tripsOpened?: string[]; sent?: boolean } | null;
    let text: string | null = null;
    if (response?.ok && body) {
      if (action === "approve") {
        const trips = body.tripsOpened ?? [];
        // B244 — what the approval opened, said rather than inferred.
        text = trips.length
          ? t("contact.adminApprovedTrips", { trips: trips.join(", ") })
          : t("contact.adminApprovedNoTrip");
      } else if (action === "revoke") {
        text = t("contact.adminRevoked", { name });
      } else if (body.sent) {
        text = t("contact.adminResent", { email: contact.email });
      }
    }
    setNotes((previous) => ({
      ...previous,
      [contact.id]: text ? { text } : { text: t("contact.adminActionFailed"), failed: true },
    }));
  }

  // B621 — the owner's own row is the section near the bottom, never a reader.
  const split = splitReaders(contacts, own?.contact.email ?? null);

  const editingId = formTarget !== null && formTarget !== "new" ? formTarget.id : null;
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
    onClose: () => setFormTarget(null),
  };
  const env: CardEnv = {
    t,
    tn,
    busy,
    locale,
    locales,
    defaultCountryCode,
    act: (body) => void act(body),
    confirmed: (contact, action) => void confirmed(contact, action),
    onEdit: setFormTarget,
    // B321 — resolved here, where the invite list and the trip titles are.
    via: (contact) => viaLabel(contact.createdVia, invites, trips, t),
    // B384 — only an unconfirmed row with a live invite behind it.
    canResend: (contact) =>
      contact.status === "pending" && !contact.confirmedAt && resendableInvite(contact.createdVia, invites) !== null,
    notes,
    highlightId,
    editingId,
    guestFormEnv: editingId ? guestFormEnv : undefined,
  };

  // Put the highlighted request in view rather than merely marked — B319.
  useEffect(() => {
    if (!highlightId) return;
    document.getElementById(`contact-${highlightId}`)?.scrollIntoView({ block: "center" });
  }, [highlightId]);

  return (
    <div lang={locale}>
      {/* B300/B638 — said ahead of every Approve: approving opens nothing
          while no trip is open to guests. */}
      {!hasGuestTrip && (
        <p className="mt-8 rounded-xl border-2 border-coral-600 bg-coral-300 px-4 py-3 text-base text-on-bright">
          {t("contact.adminNoGuestTrip")}
        </p>
      )}

      <ReaderGroup title={t("contact.adminPending")} rows={split.waitingOnYou} env={env} />
      {split.waitingOnThem.length > 0 && (
        <ReaderGroup title={t("contact.adminWaitingOnThem")} rows={split.waitingOnThem} env={env} />
      )}
      {/* B2296 — filed by an import, never invited. Its own group rather than
          folded into "waiting for them": that name means an invite already
          went out, and none did for these. */}
      {split.notInvited.length > 0 && (
        <ReaderGroup title={t("contact.adminNotInvited")} rows={split.notInvited} env={env} />
      )}
      <ReaderGroup title={t("contact.adminReadingNow")} rows={split.readingNow} env={env}>
        {/* A contact typed in by hand, with an address for postcards — a
            secondary action, so a link rather than a second primary. */}
        {formTarget === "new" ? (
          <GuestForm contact={null} {...guestFormEnv} />
        ) : (
          <button
            type="button"
            onClick={() => setFormTarget("new")}
            className="mt-3 text-sm font-semibold text-ink-strong underline underline-offset-2"
          >
            {t("contact.adminAddGuest")}
          </button>
        )}
      </ReaderGroup>
      {split.revoked.length > 0 && <ReaderGroup title={t("contact.adminOther")} rows={split.revoked} env={env} />}

      {(own || canAddOwn) && (
        <OwnDetails
          username={username}
          locales={locales}
          dictionary={dictionary}
          defaultCountryCode={defaultCountryCode}
          addressLookupEnabled={addressLookupEnabled}
          own={own}
          t={t}
          onAdded={refresh}
        />
      )}

      <InvitationLinks
        username={username}
        locale={locale}
        locales={locales}
        trips={trips}
        invites={invites}
        t={t}
        busy={busy}
        setBusy={setBusy}
        act={(body) => void act(body)}
        refresh={refresh}
      />
    </div>
  );
}
