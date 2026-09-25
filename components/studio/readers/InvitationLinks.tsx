"use client";

import { useState } from "react";
import BusyButton from "@/components/BusyButton";
import CopyLine from "@/components/CopyLine";
import { LOCALE_LABEL } from "@/lib/i18n";
import type { Locale } from "@/lib/types";
import { INVITE_KIND_KEY, tripLabel, type AdminInvite, type Translate } from "./shared";

/** The studio's field vocabulary (B2092), for the invitation form — the
 * same eyebrow and input `studio/journal` draws. The guest form keeps its
 * larger fields: it is shared with rows the tests render on their own. */
const EYEBROW = "block font-mono text-[11px] font-medium uppercase tracking-[.06em] text-ink-secondary";
const STUDIO_FIELD =
  "mt-1.5 block min-h-11 w-full rounded-xl border border-line-prominent bg-surface-raised px-3 py-2.5 text-base text-ink-strong";

/**
 * One issued link, said in full — B97.
 *
 * Two things have to be legible without opening anything, because this list is
 * the only place a link can be revoked and revoking is irreversible: **which
 * kind it is**, and **whether it still works**. The cost of guessing wrong is
 * asymmetric — kill the reading link by mistake and the family cannot ask to
 * read; leave the writing link alive and a stranger can join a trip.
 *
 * A dead link — revoked, or past its expiry — says so and is offered no
 * button. Both are already refused by `resolveInvite`, so a control that
 * claimed to do something to one would be noise over a link that is already
 * nothing.
 */
function InviteRow({
  invite,
  trips,
  t,
  busy,
  act,
}: {
  invite: AdminInvite;
  /** For naming a buddy link's trip as the owner named it — see `tripLabel`. */
  trips: { id: string; title: string }[];
  t: Translate;
  busy: boolean;
  act: (body: Record<string, unknown>) => void;
}) {
  // Compared as ISO strings, which is what the column stores and what sorts
  // correctly — the same comparison `lib/grants.ts` makes for a grant.
  const expired =
    invite.expiresAt !== null && invite.expiresAt <= new Date().toISOString();
  const dead = invite.revokedAt !== null || expired;

  const detail = [
    // The trip is the whole difference between this row and the one above it,
    // so it comes first on a buddy link.
    // The title rather than the id, the same as the contact rows above — B321.
    // Two lists on one page naming one trip two different ways is a difference
    // the owner has to decode, and the id is what they were never shown: the
    // form that made this link offered them a dropdown of titles.
    invite.kind === "buddy"
      ? t("contact.adminInviteTrip", {
          trip: invite.tripId ? tripLabel(trips, invite.tripId) : "—",
        })
      : null,
    // The owner's own note. Second, and before the counters, because it is the
    // only thing that tells two rows of the same kind apart — which is what
    // the owner is actually deciding between when they reach for revoke. It
    // was blank on every link until B281, because the form that collected it
    // made a `personal` link and the two kinds an owner hands out were made by
    // a form that collected neither.
    invite.name,
    invite.locale ? (LOCALE_LABEL[invite.locale] ?? invite.locale) : null,
    t("contact.adminInviteUses", { count: String(invite.uses) }),
    invite.revokedAt
      ? t("contact.adminInviteRevoked")
      : expired
        ? t("contact.adminInviteExpired")
        : invite.expiresAt
          ? t("contact.adminInviteExpires", {
              date: invite.expiresAt.slice(0, 10),
            })
          : t("contact.adminInviteNoExpiry"),
  ].filter(Boolean);

  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line-quiet px-4 py-3">
      <span className="text-base">
        <span
          className={dead ? "text-ink-secondary" : "font-semibold text-ink-strong"}
        >
          {t(INVITE_KIND_KEY[invite.kind])}
        </span>
        <span className="block text-sm text-ink-secondary">
          {detail.join(" · ")}
        </span>
      </span>
      {!dead && (
        <span className="flex flex-col items-end gap-2">
          {/* B934: the button above was the only route to this link — a phone
              whose clipboard write is refused (no secure context, permission
              denied, an old browser) left the owner nothing to select, on the
              one page B280 built specifically to show a lost link again. The
              value is now on screen too, selectable by hand, the same way
              `freshLink` below and `InviteToRead` already show one — so the
              button is a shortcut rather than the only way in, matching the
              rule the rest of this codebase follows for a live credential. */}
          {invite.url && (
            <code className="block max-w-full break-all rounded-lg bg-surface-subtle px-2 py-1 text-xs text-ink-strong">
              {invite.url}
            </code>
          )}
          <span className="flex flex-wrap items-center gap-2">
            {/* B280 and B281: send the same link again rather than issuing a
                second one for the same audience. Absent, not disabled, when
                there is no recoverable token — see `AdminInvite.url`. */}
            {invite.url && (
              <CopyLine
                value={invite.url}
                label={t("contact.adminCopyLink")}
                copiedLabel={t("contact.adminCopiedLink")}
                // The URL is a credential, so it is deliberately not recited as
                // the accessible name the way `CopyLine`'s default would — B199
                // is the precedent. What it copies is said in words instead, and
                // the note beside it is what identifies which link this is —
                // when there is one. B358: an unnamed link used to fill the gap
                // with an em-dash placeholder, so the name ended "— —".
                name={
                  invite.name
                    ? t("contact.adminCopyLinkNamed", {
                        kind: t(INVITE_KIND_KEY[invite.kind]),
                        name: invite.name,
                      })
                    : t("contact.adminCopyLinkKind", {
                        kind: t(INVITE_KIND_KEY[invite.kind]),
                      })
                }
              />
            )}
            <BusyButton
              busy={busy}
              type="button"
              onClick={() => act({ action: "revoke-invite", id: invite.id })}
              className="rounded-lg border border-line-quiet px-3 py-1 text-sm text-ink-body disabled:opacity-50"
            >
              {t("contact.adminRevokeLink")}
            </BusyButton>
          </span>
        </span>
      )}
    </li>
  );
}

/**
 * The links an owner hands out, and the form that makes one — collapsed at
 * the bottom of the readers page (B2133): a link only ever lets somebody ask,
 * and this is the one place any of them is revoked.
 */
export default function InvitationLinks({
  username,
  locale,
  locales,
  trips,
  invites,
  t,
  busy,
  setBusy,
  act,
  refresh,
}: {
  username: string;
  locale: Locale;
  locales: string[];
  trips: { id: string; title: string }[];
  invites: AdminInvite[];
  t: Translate;
  busy: boolean;
  setBusy: (busy: boolean) => void;
  act: (body: Record<string, unknown>) => void;
  refresh: () => Promise<void>;
}) {
  const [inviteName, setInviteName] = useState("");
  const [inviteLocale, setInviteLocale] = useState<Locale>(locale);
  // `guest` first because it is the one that belongs in a family group chat.
  // Defaulting to `buddy` would put write access one un-read radio button
  // away, which is the mistake B97 is about, made earlier.
  const [inviteKind, setInviteKind] = useState<"guest" | "buddy">("guest");
  const [inviteTrip, setInviteTrip] = useState(trips[0]?.id ?? "");
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [freshLink, setFreshLink] = useState<string | null>(null);

  return (
    <details className="mt-12 rounded-2xl border border-line-quiet bg-surface-raised p-4">
      <summary className="cursor-pointer font-display text-lg font-semibold text-ink-strong">
        {t("contact.adminLinks")}
      </summary>
        {/* There was a second block here: the open link, one per journal,
            offered for pasting into a group chat. It is gone (B37) — a journal
            no longer advertises a way in its owner never offered — and this
            section is now the one way anybody arrives: a link issued for a
            named person, which still only lets them ask. */}
        <form
          className="mt-4"
          onSubmit={async (event) => {
            event.preventDefault();
            setInviteError(null);
            setBusy(true);
            // `POST /api/web/{user}/invites` rather than the panel's own admin
            // route: that route's `invite` action made a `personal` link and
            // nothing else, and this one already owns the rules — a buddy
            // link needs a trip, a guest link must not name one, the trip has
            // to exist, and every link is dated. B281.
            const response = await fetch(`/api/web/${username}/invites`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                kind: inviteKind,
                ...(inviteKind === "buddy" ? { trip: inviteTrip } : {}),
                // `name` is optional on the wire (`inviteWrite`, min length
                // 1) and this field is optional in the form — an empty
                // string is "nothing typed", not a one-character name, so it
                // is left out rather than sent and refused.
                ...(inviteName.trim() ? { name: inviteName.trim() } : {}),
                locale: inviteLocale,
              }),
            }).catch(() => null);
            setBusy(false);

            if (!response?.ok) {
              // The route explains itself in `message`; showing that rather
              // than a generic failure is the difference between "try again"
              // and "you asked for a trip link without naming a trip".
              const body = (await response?.json().catch(() => null)) as {
                message?: string;
              } | null;
              setInviteError(body?.message ?? t("contact.adminInviteFailed"));
              return;
            }
            const body = (await response.json()) as { url?: string };
            setFreshLink(body.url ?? null);
            setInviteName("");
            await refresh();
          }}
        >
          <p className={EYEBROW}>{t("contact.adminNewInvite")}</p>

          {/* Which door, first, because it changes what the rest of the form
              means — and said in the same words the row below will use, so an
              owner who picks "a link for someone to write" recognises the row
              it produces. A reading link goes in a family group chat; a
              writing link does not, which is why the sentence under each is
              part of the control rather than a tooltip. */}
          <fieldset className="mt-4">
            <legend className={EYEBROW}>{t("contact.adminInviteKind")}</legend>
            {(["guest", "buddy"] as const).map((kind) => {
              // A writing link names a trip, and `POST /invites` refuses one
              // that names nothing. So a journal with no trip cannot make this
              // kind at all — and it is said here, on the option itself,
              // rather than after the owner has chosen it. A control you can
              // select that then explains why it will not work is the dead
              // button this project's capability rule exists to avoid.
              const unavailable = kind === "buddy" && trips.length === 0;
              return (
                <label
                  key={kind}
                  className={`mt-2 flex gap-3 rounded-xl border border-line-quiet p-4 ${
                    unavailable ? "bg-surface-subtle" : "bg-surface-raised"
                  }`}
                >
                  <input
                    type="radio"
                    name="invite-kind"
                    value={kind}
                    checked={inviteKind === kind}
                    disabled={unavailable}
                    onChange={() => setInviteKind(kind)}
                    className="mt-1.5 h-5 w-5 shrink-0"
                  />
                  <span>
                    <span
                      className={`block text-base font-semibold ${
                        unavailable ? "text-ink-secondary" : "text-ink-strong"
                      }`}
                    >
                      {t(INVITE_KIND_KEY[kind])}
                    </span>
                    <span className="block text-sm leading-6 text-ink-body">
                      {unavailable
                        ? t("contact.adminInviteNoTrips")
                        : t(
                            kind === "guest"
                              ? "me.inviteGuestBody"
                              : "me.inviteBuddyBody",
                          )}
                    </span>
                  </span>
                </label>
              );
            })}
          </fieldset>

          {/* Which trip, once there is a choice to make and the owner has
              asked for the kind that needs one. */}
          {inviteKind === "buddy" && trips.length > 0 && (
            <>
              <label className={`${EYEBROW} mt-4`} htmlFor="invite-trip">
                {t("contact.adminInviteWhichTrip")}
              </label>
              <select
                id="invite-trip"
                className={STUDIO_FIELD}
                value={inviteTrip}
                onChange={(e) => setInviteTrip(e.target.value)}
              >
                {trips.map((trip) => (
                  <option key={trip.id} value={trip.id}>
                    {trip.title}
                  </option>
                ))}
              </select>
            </>
          )}

          {/* The owner's own note, and the reason this field exists at all:
              two links of the same kind are otherwise one row repeated, and
              this list is the only place either can be revoked (B97). Asked
              as "what is this for" rather than "who is it for" — a link
              forwarded round a family is for a family, not a person, and
              `name` was never an identity. */}
          <label className={`${EYEBROW} mt-4`} htmlFor="invite-name">
            {t("contact.adminInviteNote")}
          </label>
          <input
            id="invite-name"
            className={STUDIO_FIELD}
            value={inviteName}
            onChange={(e) => setInviteName(e.target.value)}
            placeholder={t("contact.adminInviteNotePlaceholder")}
          />
          <label className={`${EYEBROW} mt-4`} htmlFor="invite-locale">
            {t("contact.language")}
          </label>
          <select
            id="invite-locale"
            className={STUDIO_FIELD}
            value={inviteLocale}
            onChange={(e) => setInviteLocale(e.target.value as Locale)}
          >
            {locales.map((option: string) => (
              <option key={option} value={option}>
                {LOCALE_LABEL[option]}
              </option>
            ))}
          </select>
          <BusyButton
            busy={busy}
            type="submit"
            disabled={inviteKind === "buddy" && trips.length === 0}
            className="mt-5 min-h-11 rounded-full border border-line-strong px-5 text-sm font-semibold text-ink-strong hover:bg-surface-subtle disabled:opacity-50"
          >
            {t("contact.adminCreate")}
          </BusyButton>

          {inviteError && (
            <p role="alert" className="mt-4 text-base leading-7 text-coral-600">
              {inviteError}
            </p>
          )}

          {freshLink && (
            <div className="mt-5">
              <p className="text-base font-semibold text-ink-strong">
                {t("contact.adminInviteCopy")}
              </p>
              <code className="mt-2 block break-all rounded-xl bg-surface-subtle p-3 text-sm text-ink-strong">
                {freshLink}
              </code>
              <div className="mt-3">
                <CopyLine
                  value={freshLink}
                  label={t("contact.adminCopyLink")}
                  copiedLabel={t("contact.adminCopiedLink")}
                  name={t("contact.adminCopyLink")}
                />
              </div>
            </div>
          )}
        </form>

        {invites.length > 0 && (
          <ul className="mt-6 space-y-2">
            {invites.map((invite) => (
              <InviteRow key={invite.id} invite={invite} trips={trips} t={t} busy={busy} act={act} />
            ))}
          </ul>
        )}
    </details>
  );
}
