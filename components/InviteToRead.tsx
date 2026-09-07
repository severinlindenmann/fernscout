"use client";

import { useEffect, useState } from "react";
import BusyButton from "@/components/BusyButton";
import CopyLine from "./CopyLine";
import { useI18n } from "./LocaleProvider";

/**
 * "Invite family to read", on the day she just published — B799.
 *
 * The journal exists so that somebody reads it, and the moment a day goes on
 * the site is the moment that matters. Until this existed, nothing on that
 * page mentioned letting anybody in: the response tells an *agent* to offer a
 * guest link and `/agent.md` instructs it to, while a person doing it in a
 * browser had to notice an icon-only nav item, open `/<user>/me`, and scroll
 * past journal settings, agent keys, storage and credits to find "Manage who
 * can read this". Three levels down, behind a wall of things nobody asked
 * about.
 *
 * **It only ever makes a guest link, and there is no control here for the
 * other one.** A guest link belongs in a family group chat and a buddy link
 * does not — that is the whole reason the two have separate URLs (see
 * `inviteLinkUrl`) — and a button on a day page that could hand somebody write
 * access to the trip by mistake would be the worst possible place to put the
 * choice. Making a buddy link is still the contacts page's own form, where the
 * two kinds are chosen deliberately, side by side, each under the sentence
 * that says what it does.
 *
 * The words are the contacts page's own (`me.inviteGuestTitle` /
 * `me.inviteGuestBody`), for the reason `INVITE_KIND_KEY` gives there: an
 * owner looking at a link wants the words they were shown when they made it.
 *
 * **It grants nothing and does not say it does.** The link leads to a form;
 * whoever fills it in proves their own address and lands in the owner's queue,
 * and `approveContact` is still the only thing in the codebase that writes a
 * grant. `me.inviteGuestBody` says exactly that — "they see nothing until you
 * say yes" — which is why it is the sentence rendered rather than a shorter
 * one written here.
 *
 * Rendered only where the viewer is already known to be the owner
 * (`canPublish`, which is exactly `isOwner` — see `lib/tripGate.ts`), and it
 * asks the server the remaining question itself: `GET /api/v1/<user>/invites`
 * is owner-only *and* refuses a journal with `contacts` switched off, so a
 * journal that cannot invite anybody shows nothing at all rather than a button
 * that explains itself after being pressed. Same shape as `DayNotify` beside
 * it, for the same reason.
 */
export default function InviteToRead({ username }: { username: string }) {
  const { t, locale } = useI18n();
  const [offered, setOffered] = useState(false);
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/v1/${username}/invites`)
      .then((response) => {
        if (!cancelled && response.ok) setOffered(true);
      })
      .catch(() => {
        // Not the owner, contacts off, or offline. Nothing to offer, and
        // nothing worth saying to somebody who would not have seen this
        // control anyway.
      });
    return () => {
      cancelled = true;
    };
  }, [username]);

  if (!offered) return null;

  async function make() {
    setFailed(false);
    setBusy(true);
    const response = await fetch(`/api/v1/${username}/invites`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // `kind: "guest"` and nothing else. No `trip`, which this route refuses
      // on a guest link anyway — a guest is a guest of the journal and never
      // of one trip (B41).
      body: JSON.stringify({ kind: "guest", locale }),
    }).catch(() => null);
    setBusy(false);
    const body = (await response?.json().catch(() => null)) as {
      invite?: { url?: string };
    } | null;
    if (!response?.ok || !body?.invite?.url) return setFailed(true);
    setLink(body.invite.url);
  }

  if (link) {
    return (
      <div className="mt-3 rounded-2xl border border-navy-200 bg-white p-4">
        <p className="font-display text-base font-semibold text-navy-900">
          {t("me.inviteGuestTitle")}
        </p>
        <p className="mt-1 text-sm leading-6 text-navy-700">
          {t("me.inviteGuestBody")}
        </p>
        <code className="mt-3 block break-all rounded-xl bg-cream-100 p-3 text-xs text-navy-900">
          {link}
        </code>
        <p className="mt-2 text-xs text-coral-700">
          {t("contact.adminInviteCopy")}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-4">
          <CopyLine
            value={link}
            label={t("contact.adminCopyLink")}
            copiedLabel={t("contact.adminCopiedLink")}
          />
          <a
            className="text-xs text-navy-900 underline underline-offset-4"
            href={`/${username}/contacts`}
          >
            {t("me.contacts")}
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-3">
      <BusyButton
        busy={busy}
        type="button"
        onClick={make}
        className="min-h-11 rounded-full border border-navy-200 bg-white px-4 text-xs font-semibold text-navy-900 transition-colors hover:border-navy-500 disabled:opacity-60"
      >
        {t("invite.share")}
      </BusyButton>
      {failed && (
        <p role="alert" className="mt-2 text-xs text-coral-700">
          {t("contact.adminInviteFailed")}
        </p>
      )}
    </div>
  );
}
