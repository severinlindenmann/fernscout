"use client";

import { useState } from "react";
import BusyButton from "@/components/BusyButton";
import ConfirmPanel from "@/components/ConfirmPanel";
import { LOCALE_LABEL } from "@/lib/i18n";
import { isMessageable } from "@/lib/phone";
import type { Locale } from "@/lib/types";
import { GuestForm } from "./GuestForm";
import NotifyStep from "./NotifyStep";
import type { AdminContact, Count, Translate } from "./shared";

/**
 * The props `GuestForm` needs beyond the contact it is editing — B1094.
 * Bundled so a card can be handed everything the form needs in one prop.
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

/** Which group a card sits in decides what it offers — B2291. */
export type CardKind = "asking" | "invited" | "notInvited" | "reading" | "revoked";

/** What one card needs from the page, bundled once (B2133). */
export type CardEnv = {
  t: Translate;
  tn: Count;
  busy: boolean;
  locale: Locale;
  username: string;
  /** B385/B389 — the operator's default dialling code, for reading a national number. */
  defaultCountryCode?: string;
  /** Remove — fire-and-forget through `/api/contacts/admin`. */
  act: (body: Record<string, unknown>) => void;
  /** Let in, Decline and Take access away — each only after its ConfirmPanel. */
  confirmed: (contact: AdminContact, action: "letin" | "revoke") => void;
  /** After NotifyStep sent or was put off: re-read the lists. */
  refresh: () => void;
  onEdit: (contact: AdminContact) => void;
  via: (contact: AdminContact) => string | null;
  /** The status line the last Let in / Take away on a contact left — kept by
   * the page, because the card moves to another group and would lose it. */
  notes: Record<string, { text: string; failed?: boolean }>;
  highlightId?: string;
  editingId: string | null;
  guestFormEnv?: GuestFormEnv;
};

/** "24 September 2026", in the page's language, fixed to UTC so the server
 * and the browser agree (B2133). */
function longDate(iso: string, locale: Locale): string {
  return new Date(iso).toLocaleDateString(locale === "en" ? "en-GB" : locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? (parts.at(-1)?.[0] ?? "") : "")).toUpperCase() || "?";
}

const GHOST =
  "min-h-11 rounded-xl border border-line-strong bg-surface-raised px-4 text-sm font-semibold text-ink-strong hover:bg-surface-subtle disabled:opacity-50";
const PRIMARY =
  "min-h-11 rounded-xl bg-yellow-400 px-4 text-sm font-semibold text-navy-900 hover:bg-yellow-300 disabled:opacity-50";
const MENU_ITEM =
  "block min-h-11 w-full px-4 py-2 text-left text-sm font-semibold text-ink-strong hover:bg-surface-subtle";

type Asking = "letin" | "decline" | "revoke" | "delete" | "notify" | "menu" | null;

/** One person: who they are, what they may do, and what the owner can do
 * about it — every consequential action asks first (B2133, B2291). */
function ReaderCard({ contact, kind, env }: { contact: AdminContact; kind: CardKind; env: CardEnv }) {
  const { t, busy, locale } = env;
  const [asking, setAsking] = useState<Asking>(null);
  const [copied, setCopied] = useState<"ok" | "failed" | null>(null);
  const hasEmail = contact.email.includes("@");
  const displayName = contact.name ?? (hasEmail ? contact.email : (contact.phone ?? ""));
  const first = displayName.split(/\s+/)[0] ?? displayName;
  const note = env.notes[contact.id];
  const editing = contact.id === env.editingId;
  const highlighted = contact.id === env.highlightId;

  // The role, said as a pill (B2291): a buddy writes to one trip, a reader
  // reads. Only a live place counts; an asked-for one is said in the line.
  const buddyOf = contact.relationship.buddyOf;
  const role =
    buddyOf.length === 1
      ? t("readers.role.buddyOf", { trip: buddyOf[0].title })
      : buddyOf.length > 1
        ? env.tn("contact.relationBuddyCount", buddyOf.length, { count: String(buddyOf.length) })
        : kind === "asking"
          ? contact.pendingTrips?.length
            ? t("readers.role.wantsTrip", { trip: contact.pendingTrips.join(", ") })
            : t("readers.role.wantsToRead")
          : t("readers.role.reader");

  // `phone` from the page; a fixture or an older answer may carry it only in
  // the address blob, which is where it lived before B2294.
  const phone = contact.phone ?? (contact.postalAddress?.tel || null);
  const reach = [
    hasEmail ? t("readers.reach.email") : null,
    // The number itself — and, when no message could reach it, why (B389).
    phone
      ? isMessageable(phone, env.defaultCountryCode)
        ? phone
        : `${phone} (${t("contact.telNotMessageable")})`
      : null,
    contact.postalAddress?.line1 ? t("readers.reach.postal") : null,
    // Their own language — what every message to them is written in (B469).
    contact.locale ? (LOCALE_LABEL[contact.locale] ?? contact.locale) : null,
  ].filter((part) => part !== null);
  const hears = [
    contact.wantsEmailDigest ? t("contact.adminChannelEmail") : null,
    contact.wantsWhatsapp ? t("contact.adminChannelWhatsapp") : null,
    contact.wantsPostcard ? t("contact.adminChannelPostcard") : null,
    // B453 — a fact about their phones, not a consent; absent where this
    // journal has push off (`null`) and where nothing is subscribed.
    contact.pushDevices
      ? t("readers.line.push", {
          devices: env.tn("contact.adminPushDevices", contact.pushDevices, { count: String(contact.pushDevices) }),
        })
      : null,
  ].filter((part) => part !== null);

  const via = env.via(contact);
  const line: string[] = [];
  if (kind === "asking") {
    if (via) line.push(via);
    line.push(hasEmail && contact.confirmedAt ? t("readers.line.emailConfirmed") : t("readers.line.mobileConfirmed"));
  } else if (kind === "invited") {
    line.push(
      contact.invitedVia && contact.invitedAt
        ? contact.invitedVia === "self"
          ? t("readers.line.sharedYourself", { date: longDate(contact.invitedAt, locale) })
          : t("readers.line.sentVia", {
              channel: t(`notifyStep.${contact.invitedVia as "email" | "whatsapp" | "sms"}`),
              date: longDate(contact.invitedAt, locale),
            })
        : contact.status === "active"
          ? t("readers.line.notToldYet")
          : t("readers.line.neverProved"),
    );
  } else if (kind === "notInvited") {
    line.push(via ?? t("contact.adminViaImport"));
  } else {
    // How they came in, first (B321) — a buddy link is write access to a trip.
    if (via) line.push(via);
    if (reach.length) line.push(reach.join(" · "));
    if (hears.length) line.push(t("readers.line.hears", { channels: hears.join(", ") }));
    line.push(
      contact.lastSeenAt
        ? t("readers.line.lastSeen", { date: longDate(contact.lastSeenAt, locale) })
        : contact.welcomeOpenedAt
          ? t("readers.line.openedOn", { date: longDate(contact.welcomeOpenedAt, locale) })
          : t("readers.line.notOpened"),
    );
  }

  async function copyWelcome() {
    try {
      const response = await fetch(
        `/api/web/${encodeURIComponent(env.username)}/readers/notify?contactId=${encodeURIComponent(contact.id)}`,
      );
      const body = (await response.json()) as { url?: string | null };
      if (!response.ok || !body.url) throw new Error("no url");
      await navigator.clipboard.writeText(body.url);
      setCopied("ok");
    } catch {
      setCopied("failed");
    }
  }

  // An owner-added person still owes a proof; a row a link filed is a
  // request that never finished — nothing to send it again with.
  const canNotify = kind === "notInvited" || (kind === "invited" && contact.status === "active");
  const close = () => setAsking(null);

  return (
    <li
      id={`contact-${contact.id}`}
      className={`rounded-2xl border p-4 ${
        kind === "asking" ? "bg-yellow-50" : "bg-surface-raised"
      } ${highlighted ? "border-yellow-400 ring-2 ring-yellow-400" : "border-line-quiet"}`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span
            aria-hidden
            className="grid size-10 shrink-0 place-items-center rounded-full border border-line-strong bg-navy-900 text-sm font-bold text-on-deep"
          >
            {initials(displayName)}
          </span>
          <div className="min-w-0">
            <p className="font-semibold text-ink-strong">
              <span className="mr-2 break-words">{displayName}</span>
              <span className="inline-block rounded-full border border-line-quiet bg-surface-subtle px-2.5 py-0.5 text-xs font-semibold text-ink-strong">
                {role}
              </span>
            </p>
            <p className="mt-0.5 text-sm text-ink-secondary">{line.join(" · ")}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {kind === "asking" && (
            <>
              <BusyButton busy={busy} type="button" className={GHOST} aria-expanded={asking === "decline"} onClick={() => setAsking("decline")}>
                {t("readers.decline")}
              </BusyButton>
              <BusyButton busy={busy} type="button" className={PRIMARY} aria-expanded={asking === "letin"} onClick={() => setAsking("letin")}>
                {t("readers.letIn", { name: first })}
              </BusyButton>
            </>
          )}
          {kind === "invited" && contact.status === "active" && (
            <button type="button" className={GHOST} onClick={copyWelcome}>
              {copied === "ok" ? t("notifyStep.copied") : t("readers.copyWelcome")}
            </button>
          )}
          {canNotify && (
            <button type="button" className={kind === "notInvited" ? PRIMARY : GHOST} aria-expanded={asking === "notify"} onClick={() => setAsking(asking === "notify" ? null : "notify")}>
              {kind === "notInvited" ? t("readers.invite", { name: first }) : t("readers.sendAgain")}
            </button>
          )}
          {kind === "revoked" && (
            <BusyButton busy={busy} type="button" className={GHOST} aria-expanded={asking === "letin"} onClick={() => setAsking("letin")}>
              {t("readers.letBackIn")}
            </BusyButton>
          )}
          {(kind === "reading" || kind === "invited" || kind === "notInvited" || kind === "revoked") && (
            <button
              type="button"
              className={GHOST}
              aria-haspopup="true"
              aria-expanded={asking === "menu"}
              aria-label={t("readers.more", { name: displayName })}
              onClick={() => setAsking(asking === "menu" ? null : "menu")}
            >
              •••
            </button>
          )}
        </div>
      </div>

      {asking === "menu" && (
        <div className="mt-3 overflow-hidden rounded-xl border border-line-quiet bg-surface-raised sm:ml-auto sm:w-64">
          <button type="button" className={MENU_ITEM} onClick={() => { close(); env.onEdit(contact); }}>
            {t("readers.menu.edit")}
          </button>
          {contact.status === "active" && (
            <button type="button" className={MENU_ITEM} onClick={() => setAsking("revoke")}>
              {t("readers.menu.takeAway")}
            </button>
          )}
          <button type="button" className={MENU_ITEM} onClick={() => setAsking("delete")}>
            {t("readers.menu.remove")}
          </button>
        </div>
      )}
      {copied === "failed" && (
        <p role="alert" className="mt-2 text-sm text-coral-600">{t("readers.copyFailed")}</p>
      )}

      {/* Nothing is posted until the confirming button is pressed (B2133;
          B2053 for Remove). Each names the person and says the consequence. */}
      {asking === "letin" && (
        <div className="mt-3">
          <ConfirmPanel
            label={kind === "revoked" ? t("readers.letBackIn") : t("readers.letIn", { name: first })}
            question={t("readers.letInQuestion", { name: displayName })}
            confirmLabel={t("readers.letIn", { name: first })}
            busy={busy}
            onConfirm={() => {
              close();
              env.confirmed(contact, "letin");
            }}
            onCancel={close}
          />
        </div>
      )}
      {(asking === "decline" || asking === "revoke") && (
        <div className="mt-3">
          <ConfirmPanel
            label={asking === "decline" ? t("readers.decline") : t("readers.menu.takeAway")}
            question={t(asking === "decline" ? "readers.declineQuestion" : "contact.adminRevokeQuestion", { name: displayName })}
            confirmLabel={t(asking === "decline" ? "readers.declineConfirm" : "readers.takeAwayConfirm", { name: first })}
            tone="destructive"
            busy={busy}
            onConfirm={() => {
              close();
              env.confirmed(contact, "revoke");
            }}
            onCancel={close}
          />
        </div>
      )}
      {asking === "delete" && (
        <div className="mt-3">
          <ConfirmPanel
            label={t("readers.menu.remove")}
            question={t("contact.adminDeleteQuestion", { name: displayName })}
            confirmLabel={t("contact.adminDeleteConfirm", { name: displayName })}
            tone="destructive"
            busy={busy}
            onConfirm={() => {
              close();
              env.act({ action: "delete", id: contact.id });
            }}
            onCancel={close}
          />
        </div>
      )}
      {asking === "notify" && (
        <NotifyStep
          username={env.username}
          contactId={contact.id}
          onLater={() => {
            close();
            env.refresh();
          }}
        />
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
      {/* B1094 — the edit form for this exact row, in place. */}
      {editing && env.guestFormEnv && (
        <GuestForm key={contact.id} contact={contact} {...env.guestFormEnv} />
      )}
    </li>
  );
}

/** One section of the page: a heading with its count, and its cards. An empty
 * group says nothing at all unless it is asked to (`empty`). */
export function ReaderGroup({
  title,
  rows,
  kind,
  env,
  empty,
}: {
  title: string;
  rows: AdminContact[];
  kind: CardKind;
  env: CardEnv;
  empty?: string;
}) {
  if (rows.length === 0 && !empty) return null;
  return (
    <section className="mt-10">
      <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-ink-strong">
        {title}
        {rows.length > 0 && (
          <span className="rounded-full bg-surface-subtle px-2 py-0.5 text-sm font-semibold text-ink-secondary">
            {rows.length}
          </span>
        )}
      </h2>
      {rows.length === 0 ? (
        <p className="mt-3 rounded-2xl bg-surface-subtle px-4 py-3 text-sm text-ink-secondary">{empty}</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {rows.map((contact) => (
            <ReaderCard contact={contact} kind={kind} env={env} key={contact.id} />
          ))}
        </ul>
      )}
    </section>
  );
}
