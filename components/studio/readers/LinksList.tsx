"use client";

import { useState } from "react";
import ConfirmPanel from "@/components/ConfirmPanel";
import type { Locale } from "@/lib/types";
import ShareLink from "./ShareLink";
import { tripLabel, type AdminInvite, type Translate } from "./shared";

/**
 * "Links you've shared" — B2291. Every group link still working: what it is
 * for, how often it was used, until when; Copy, and "Stop this link…" behind a
 * ConfirmPanel (B2148 — stopping a link used to happen on one tap). Stopping
 * takes nothing from anybody already let in.
 */
export default function LinksList({
  username,
  locale,
  invites,
  trips,
  t,
  onStopped,
}: {
  username: string;
  locale: Locale;
  invites: AdminInvite[];
  trips: { id: string; title: string }[];
  t: Translate;
  onStopped: () => void;
}) {
  const [asking, setAsking] = useState<string | null>(null);
  const [showing, setShowing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const live = invites.filter(
    (invite) => !invite.revokedAt && !(invite.expiresAt && new Date(invite.expiresAt).getTime() < Date.now()),
  );
  if (live.length === 0) return null;

  const until = (iso: string) =>
    new Date(iso).toLocaleDateString(locale === "en" ? "en-GB" : locale, { day: "numeric", month: "long", timeZone: "UTC" });

  async function stop(id: string) {
    setBusy(true);
    setFailed(null);
    const response = await fetch(`/api/web/${encodeURIComponent(username)}/invites/${encodeURIComponent(id)}`, {
      method: "DELETE",
    }).catch(() => null);
    setBusy(false);
    setAsking(null);
    if (!response?.ok) {
      setFailed(id);
      return;
    }
    onStopped();
  }

  return (
    <section className="mt-10">
      <h2 className="flex items-center gap-2 font-display text-lg font-semibold text-ink-strong">
        {t("readers.group.links")}
        <span className="rounded-full bg-surface-subtle px-2 py-0.5 text-sm font-semibold text-ink-secondary">{live.length}</span>
      </h2>
      <ul className="mt-3 space-y-3">
        {live.map((invite) => {
          const kind =
            invite.kind === "buddy" && invite.tripId
              ? t("readers.link.kindBuddyOf", { trip: tripLabel(trips, invite.tripId) })
              : t("readers.link.kind.guest");
          const url = invite.joinUrl ?? invite.url;
          const facts = [
            invite.uses === 1 ? t("readers.link.usedOnce") : t("readers.link.used", { count: String(invite.uses) }),
            invite.expiresAt ? t("readers.link.worksUntil", { date: until(invite.expiresAt) }) : null,
          ].filter(Boolean);
          return (
            <li key={invite.id} className="rounded-2xl border border-line-quiet bg-surface-raised p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-ink-strong">
                    <span className="mr-2">{invite.name ?? kind}</span>
                    {invite.name && (
                      <span className="inline-block rounded-full border border-line-quiet bg-surface-subtle px-2.5 py-0.5 text-xs font-semibold text-ink-strong">
                        {kind}
                      </span>
                    )}
                  </p>
                  <p className="mt-0.5 text-sm text-ink-secondary">{facts.join(" · ")}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {url && (
                    <button
                      type="button"
                      aria-expanded={showing === invite.id}
                      onClick={() => setShowing(showing === invite.id ? null : invite.id)}
                      className="min-h-11 rounded-xl border border-line-strong bg-surface-raised px-4 text-sm font-semibold text-ink-strong hover:bg-surface-subtle"
                    >
                      {t("readers.link.show")}
                    </button>
                  )}
                  <button
                    type="button"
                    aria-expanded={asking === invite.id}
                    onClick={() => setAsking(invite.id)}
                    className="min-h-11 rounded-xl border border-line-strong bg-surface-raised px-4 text-sm font-semibold text-ink-strong hover:bg-surface-subtle"
                  >
                    {t("readers.link.stop")}
                  </button>
                </div>
              </div>
              {showing === invite.id && url && (
                <div className="mt-3">
                  <ShareLink url={url} t={t} />
                </div>
              )}
              {asking === invite.id && (
                <div className="mt-3">
                  <ConfirmPanel
                    label={t("readers.link.stop")}
                    question={t("readers.link.stopQuestion", { name: invite.name ?? kind })}
                    confirmLabel={t("readers.link.stopConfirm")}
                    tone="destructive"
                    busy={busy}
                    onConfirm={() => void stop(invite.id)}
                    onCancel={() => setAsking(null)}
                  />
                </div>
              )}
              {failed === invite.id && (
                <p role="alert" className="mt-2 text-sm text-coral-600">
                  {t("contact.adminActionFailed")}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
