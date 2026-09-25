"use client";

import { useState } from "react";
import BusyButton from "@/components/BusyButton";
import ConfirmPanel from "@/components/ConfirmPanel";
import { Mail, MessageCircle, Stamp } from "lucide-react";
import { countryName, resolveCountry } from "@/lib/countries";
import { LOCALE_LABEL } from "@/lib/i18n";
import type { Locale } from "@/lib/types";
import { isMessageable } from "@/lib/phone";
import { GuestForm } from "./GuestForm";
import type { AdminContact, Count, Translate } from "./shared";

/**
 * The props `GuestForm` needs beyond the contact it is editing — B1094.
 *
 * Bundled so a row can be handed everything the form needs in one prop
 * rather than threading eight of them individually through `ContactGroup`
 * and `ContactRow`, which otherwise carry them only to pass them on.
 */
export type GuestFormEnv = {
  fallbackLocale: Locale;
  locales: string[];
  username: string;
  t: Translate;
  busy: boolean;
  act: (body: Record<string, unknown>) => Promise<Response | null>;
  postcardsEnabled: boolean;
  pushEnabled: boolean;
  whatsappEnabled: boolean;
  defaultCountryCode?: string;
  addressLookupEnabled: boolean;
  onClose: () => void;
};

/**
 * One channel this reader is on — B453.
 *
 * A chip rather than a line of the list, and two words rather than the
 * sentence. The sentences live in the tick boxes, where each one is a consent
 * being given and reads as one; here they were three of them joined with a
 * dot, which turned the most scannable fact about a person — how they hear
 * from this journal — into the least scannable thing on the card.
 *
 * Only what somebody actually asked for is shown. A row of greyed-out chips
 * for the channels they declined would say the same thing in colour alone,
 * which is not something everyone can read.
 */
function Channel({ icon: Icon, label }: { icon: typeof Mail; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-line-quiet bg-surface-subtle px-2.5 py-1 text-sm text-ink-strong">
      <Icon className="h-3.5 w-3.5 text-ink-secondary" aria-hidden />
      {label}
    </span>
  );
}

/** What one card needs from the page, bundled once rather than threaded
 * prop by prop through the group and the card (B2133). */
export type CardEnv = {
  t: Translate;
  tn: Count;
  busy: boolean;
  locale: Locale;
  locales: string[];
  defaultCountryCode?: string;
  /** Fire-and-forget, for Remove. */
  act: (body: Record<string, unknown>) => void;
  /** Approve, Revoke and Resend — each only after its ConfirmPanel. */
  confirmed: (contact: AdminContact, action: "approve" | "revoke" | "resend") => void;
  onEdit: (contact: AdminContact) => void;
  via: (contact: AdminContact) => string | null;
  canResend: (contact: AdminContact) => boolean;
  /** The status line the last Approve / Revoke / Resend on a contact left —
   * kept by the page, because the card moves to another group and would
   * lose it (B244). */
  notes: Record<string, { text: string; failed?: boolean }>;
  highlightId?: string;
  editingId: string | null;
  guestFormEnv?: GuestFormEnv;
};

/** Reusable for any stored ISO instant: "24 September 2026", in the page's
 * language, fixed to UTC so the server and the browser agree (B2133 — the
 * card printed raw ISO dates). */
function longDate(iso: string, locale: Locale): string {
  return new Date(iso).toLocaleDateString(locale === "en" ? "en-GB" : locale, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

const LINK = "text-sm font-semibold text-ink-strong underline underline-offset-2 disabled:opacity-50";
const PILL =
  "min-h-11 rounded-full border border-line-strong px-4 text-sm font-semibold text-ink-strong hover:bg-surface-subtle disabled:opacity-50";

/** One person: who they are, how they came in, what they get, and what the
 * owner can do about it — every consequential action asks first (B2133). */
function ReaderCard({ contact, env }: { contact: AdminContact; env: CardEnv }) {
  const { t, tn, busy, locale, locales, defaultCountryCode } = env;
  // Owner-facing copy, not the guest form's first-person "Send me…" — this
  // list is read by the owner, about somebody else.
  const channels = [
    contact.wantsEmailDigest
      ? { icon: Mail, label: t("contact.adminChannelEmail") }
      : null,
    contact.wantsPostcard
      ? { icon: Stamp, label: t("contact.adminChannelPostcard") }
      : null,
    contact.wantsWhatsapp
      ? { icon: MessageCircle, label: t("contact.adminChannelWhatsapp") }
      : null,
  ].filter((channel) => channel !== null);

  const postal = contact.postalAddress;

  // B1301 — an already-`active` contact whose later buddy link named a trip
  // the earlier approval never covered. `relationship.buddyOf` only lists a
  // *live* place, so this is the one thing that still needs a decision from
  // a row that otherwise reads as fully settled.
  const pendingTrips = contact.status === "active" ? (contact.pendingTrips ?? []) : [];

  // B630 — what this person actually is to the journal, said in words rather
  // than left for the owner to work out from a status and a "via" line. More
  // than one can be true at once, and each is said rather than one winning.
  const tags: string[] = [];
  if (contact.relationship.owner) tags.push(t("contact.relationOwner"));
  if (contact.relationship.buddyOf.length === 1) {
    tags.push(
      t("contact.relationBuddyOne", {
        trip: contact.relationship.buddyOf[0].title,
      }),
    );
  } else if (contact.relationship.buddyOf.length > 1) {
    const count = contact.relationship.buddyOf.length;
    tags.push(tn("contact.relationBuddyCount", count, { count: String(count) }));
  }
  if (contact.relationship.guest) tags.push(t("contact.relationGuest"));

  const [asking, setAsking] = useState<"approve" | "revoke" | "resend" | "delete" | null>(null);
  const displayName = contact.name ?? contact.email;
  const via = env.via(contact);
  const canResend = env.canResend(contact);
  const canApprove = (contact.status !== "active" && contact.confirmedAt !== null) || pendingTrips.length > 0;
  const note = env.notes[contact.id];
  const editing = contact.id === env.editingId;
  const highlighted = contact.id === env.highlightId;

  return (
    <li
      id={`contact-${contact.id}`}
      className={`rounded-2xl border bg-surface-raised p-4 ${
        highlighted ? "border-yellow-400 ring-2 ring-yellow-400" : "border-line-quiet"
      }`}
    >
      <p className="font-display text-lg font-semibold text-ink-strong">{displayName}</p>
      <p className="text-sm text-ink-secondary">{contact.email}</p>
      {/* How they came in, as the sentence the owner would say (B321). */}
      {via && <p className="mt-2 text-sm text-ink-body">{via}.</p>}
      {/* What they get: their relationship, then the channels they hear on
          (B630, B453). */}
      {(tags.length > 0 || channels.length > 0) && (
        <div className="mt-2 flex flex-wrap gap-2">
          {tags.map((label) => (
            <span
              key={label}
              className="inline-flex items-center rounded-full border border-line-quiet bg-surface-subtle px-2.5 py-1 text-sm text-ink-strong"
            >
              {label}
            </span>
          ))}
          {channels.map((channel) => (
            <Channel icon={channel.icon} label={channel.label} key={channel.label} />
          ))}
        </div>
      )}
      <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm text-ink-strong">
        <dt className="text-ink-secondary">{t("contact.language")}</dt>
        <dd>{contact.locale ? (LOCALE_LABEL[contact.locale] ?? contact.locale) : "—"}</dd>
        <dt className="text-ink-secondary">{t("contact.adminLastSeen")}</dt>
        <dd>{contact.lastSeenAt ? longDate(contact.lastSeenAt, locale) : t("contact.adminNever")}</dd>
        {/* The fourth channel, and the only one that is state rather than
            consent — B453. Absent, not zero, where this journal has push off:
            `null` means the channel was never offered here. Zero is said as
            a sentence below the list (B2092), not as a label over "none". */}
        {contact.pushDevices !== null && contact.pushDevices > 0 && (
          <>
            <dt className="text-ink-muted">{t("contact.adminPush")}</dt>
            <dd>
              {tn("contact.adminPushDevices", contact.pushDevices, {
                count: String(contact.pushDevices),
              })}
            </dd>
          </>
        )}
        {postal && (
          <>
            {/* B383 — this row is the owner's own address book, not a
                postcard destination: the tick above is the postcard
                consent, this is the address on file whether or not one was
                ever asked for. Reuses `contact.address` rather than the
                postcard-specific label. */}
            <dt>{t("contact.address")}</dt>
            <dd>
              {[
                postal.name,
                postal.line1,
                postal.line2,
                `${postal.postcode} ${postal.city}`.trim(),
                // B398 stores an ISO2 code once a row is saved through the
                // picker; named back out in the admin's own locale the same
                // way CountryField does. A legacy row resolveCountry can't
                // place (or an ISO2 Intl.DisplayNames won't name) shows
                // exactly the string on disk — never a blank.
                (() => {
                  const iso2 = resolveCountry(postal.country, locales);
                  return iso2 ? countryName(iso2, locale) : postal.country;
                })(),
              ]
                .filter((line) => line !== "")
                .join(", ")}
            </dd>
          </>
        )}
        {postal?.tel && (
          <>
            <dt>{t("contact.tel")}</dt>
            <dd>
              {postal.tel}
              {/* B389 — a number `toE164` cannot parse (no `+`, no configured
                  default country) is silently skipped by the WhatsApp send
                  loop; say so here rather than let it read like every other
                  number on the page. */}
              {!isMessageable(postal.tel, defaultCountryCode) && (
                <>
                  {" "}
                  <span className="ml-2 text-ink-secondary">{t("contact.telNotMessageable")}</span>
                </>
              )}
            </dd>
          </>
        )}
      </dl>
      {/* A direct grant (D11) confirmed nothing: the owner let them in. */}
      <p className="mt-2 text-sm text-ink-secondary">
        {contact.confirmedAt
          ? t(contact.createdVia === "owner-grant" ? "contact.adminLetInOn" : "contact.adminConfirmedOn", {
              date: longDate(contact.confirmedAt, locale),
            })
          : t("contact.adminNotConfirmed")}
        {contact.pushDevices === 0 && ` ${t("contact.adminPushNone")}`}
      </p>
      {canResend && <p className="mt-2 text-sm text-ink-secondary">{t("contact.adminInvitePending")}</p>}
      {pendingTrips.length > 0 && (
        // B1301 — an active reader still asking to write to a trip.
        <p className="mt-2 text-sm text-ink-secondary">
          {pendingTrips.length === 1
            ? t("contact.adminPendingTripOne", { trip: pendingTrips[0] })
            : t("contact.adminPendingTripCount", { trips: pendingTrips.join(", ") })}
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        {canApprove && (
          <BusyButton busy={busy} type="button" onClick={() => setAsking("approve")} aria-expanded={asking === "approve"} className={PILL}>
            {t("contact.adminApprove")}
          </BusyButton>
        )}
        {canResend && (
          <BusyButton busy={busy} type="button" onClick={() => setAsking("resend")} aria-expanded={asking === "resend"} className={PILL}>
            {t("contact.adminResendInvite")}
          </BusyButton>
        )}
        <BusyButton busy={busy} type="button" onClick={() => env.onEdit(contact)} className={LINK}>
          {t("contact.adminEdit")}
        </BusyButton>
        {contact.status === "active" && (
          <BusyButton busy={busy} type="button" onClick={() => setAsking("revoke")} aria-expanded={asking === "revoke"} className={LINK}>
            {t("contact.adminRevoke")}
          </BusyButton>
        )}
        <BusyButton busy={busy} type="button" onClick={() => setAsking("delete")} aria-expanded={asking === "delete"} className={LINK}>
          {t("contact.adminDelete")}
        </BusyButton>
      </div>
      {/* Nothing is posted until the confirming button is pressed (B2133;
          B2053 for Remove). Each names the person and says the consequence. */}
      {asking === "approve" && (
        <div className="mt-3">
          <ConfirmPanel
            label={t("contact.adminApprove")}
            question={t("contact.adminApproveQuestion", { name: displayName })}
            confirmLabel={t("contact.adminApproveConfirm", { name: displayName })}
            busy={busy}
            onConfirm={() => {
              setAsking(null);
              env.confirmed(contact, "approve");
            }}
            onCancel={() => setAsking(null)}
          />
        </div>
      )}
      {asking === "resend" && (
        <div className="mt-3">
          <ConfirmPanel
            label={t("contact.adminResendInvite")}
            question={t("contact.adminResendQuestion", { email: contact.email })}
            confirmLabel={t("contact.adminResendConfirm")}
            busy={busy}
            onConfirm={() => {
              setAsking(null);
              env.confirmed(contact, "resend");
            }}
            onCancel={() => setAsking(null)}
          />
        </div>
      )}
      {asking === "revoke" && (
        <div className="mt-3">
          <ConfirmPanel
            label={t("contact.adminRevoke")}
            question={t("contact.adminRevokeQuestion", { name: displayName })}
            confirmLabel={t("contact.adminRevokeConfirm", { name: displayName })}
            tone="destructive"
            busy={busy}
            onConfirm={() => {
              setAsking(null);
              env.confirmed(contact, "revoke");
            }}
            onCancel={() => setAsking(null)}
          />
        </div>
      )}
      {asking === "delete" && (
        <div className="mt-3">
          <ConfirmPanel
            label={t("contact.adminDelete")}
            question={t("contact.adminDeleteQuestion", { name: displayName })}
            confirmLabel={t("contact.adminDeleteConfirm", { name: displayName })}
            tone="destructive"
            busy={busy}
            onConfirm={() => {
              setAsking(null);
              env.act({ action: "delete", id: contact.id });
            }}
            onCancel={() => setAsking(null)}
          />
        </div>
      )}
      {note &&
        (note.failed ? (
          <p role="alert" className="mt-3 text-sm text-coral-600">
            {note.text}
          </p>
        ) : (
          <p role="status" className="mt-3 text-sm text-ink-strong">
            {note.text}
          </p>
        ))}
      {/* B1094 — the edit form for this exact row, in place, rather than off
          the top of the page. `key`ed on the contact id so switching from one
          row's edit button to another's remounts rather than patching stale
          field values from whoever was being edited before. */}
      {editing && env.guestFormEnv && (
        <GuestForm
          key={contact.id}
          contact={contact}
          fallbackLocale={env.guestFormEnv.fallbackLocale}
          locales={env.guestFormEnv.locales}
          username={env.guestFormEnv.username}
          t={env.guestFormEnv.t}
          busy={env.guestFormEnv.busy}
          act={env.guestFormEnv.act}
          onClose={env.guestFormEnv.onClose}
          postcardsEnabled={env.guestFormEnv.postcardsEnabled}
          pushEnabled={env.guestFormEnv.pushEnabled}
          whatsappEnabled={env.guestFormEnv.whatsappEnabled}
          defaultCountryCode={env.guestFormEnv.defaultCountryCode}
          addressLookupEnabled={env.guestFormEnv.addressLookupEnabled}
        />
      )}
    </li>
  );
}

/** One section of the page: a heading and its cards, or one quiet line. */
export function ReaderGroup({
  title,
  rows,
  env,
  children,
}: {
  title: string;
  rows: AdminContact[];
  env: CardEnv;
  children?: React.ReactNode;
}) {
  return (
    <section className="mt-10">
      <h2 className="font-display text-lg font-semibold text-ink-strong">{title}</h2>
      {rows.length === 0 ? (
        <p className="mt-3 rounded-2xl bg-surface-subtle px-4 py-3 text-sm text-ink-secondary">{env.t("contact.adminNone")}</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {rows.map((contact) => (
            <ReaderCard contact={contact} env={env} key={contact.id} />
          ))}
        </ul>
      )}
      {children}
    </section>
  );
}

