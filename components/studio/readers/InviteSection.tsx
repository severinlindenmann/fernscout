"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/components/LocaleProvider";
import DoneScreen from "@/components/studio/DoneScreen";
import StepPrimary from "@/components/studio/StepPrimary";
import SubmitError from "@/components/studio/SubmitError";
import type { TranslationKey } from "@/lib/i18n";
import type { ReaderState } from "@/lib/readers/split";
import type { TripPreview } from "@/lib/studio/audiencePreview";

/** The section each state is listed under on this page — the same words,
 * so the invite's "already here" note and the lists below cannot disagree. */
const SECTION: Record<ReaderState, TranslationKey> = {
  notInvited: "contact.adminNotInvited",
  waitingOnYou: "contact.adminPending",
  waitingOnThem: "contact.adminWaitingOnThem",
  readingNow: "contact.adminReadingNow",
  revoked: "contact.adminOther",
};

const EYEBROW = "block text-xs font-semibold uppercase tracking-wide text-ink-secondary";
const FIELD = "mt-1 block min-h-11 w-full rounded-xl border border-line-strong bg-surface-base px-3 text-base text-ink-body";

/**
 * "Let somebody read this journal" — B1833, D11, spec §7.5; one section of
 * `/studio/readers` since B2133 (it was its own two-step flow).
 *
 * **D11: this grants directly.** `grantContactAccess` (`lib/contacts`) opens
 * the journal the moment the owner presses the yellow button, and the mail
 * that follows tells the person, with a way to decline everything. A *link*
 * still grants nothing; this is a named address, from the owner's own studio.
 *
 * Only the "guest" relationship is offered — naming somebody on a trip's
 * `people:` list has no route (B245), so there is no card for it.
 */
export default function InviteSection({
  username,
  preview,
  existing,
}: {
  username: string;
  /** What a guest of this journal would see — the same for every address. */
  preview: TripPreview[];
  /** Everybody already on the page, from `readersModel` (B2133). */
  existing: { name: string | null; email: string; state: ReaderState }[];
}) {
  const { t, tn } = useI18n();
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);
  const [grantedEmail, setGrantedEmail] = useState<string | null>(null);

  const openTrips = preview.filter((p) => p.opens);
  const closedTrips = preview.filter((p) => !p.opens);
  const totalPublishedDays = openTrips.reduce((sum, p) => sum + p.publishedDays, 0);
  const totalDraftDays = preview.reduce((sum, p) => sum + p.draftDays, 0);
  const totalHeldBackDays = preview.reduce((sum, p) => sum + p.heldBackDays, 0);
  // B2130 — whether a guest sees any money is the trips' own answer.
  const seesCosts = openTrips.some((p) => p.costsVisible);
  const already = existing.find((r) => r.email === email.trim().toLowerCase());

  async function grant() {
    setBusy(true);
    setWriteError(null);
    const failed = `${t("studio.invite.writeFailed.banner")} ${t("studio.invite.writeFailed.message")}`;
    try {
      const res = await fetch(`/api/helper/${encodeURIComponent(username)}/reader/grant`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, name }),
      });
      const json = (await res.json().catch(() => null)) as { ok?: boolean; email?: string } | null;
      if (!res.ok || !json?.ok) {
        setWriteError(failed);
        return;
      }
      setGrantedEmail(json.email ?? email);
      setName("");
      setEmail("");
      // The lists below are this page's server props: re-read them so the
      // new reader appears under "Reading now".
      router.refresh();
    } catch {
      setWriteError(failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section id="invite" className="mt-6 scroll-mt-6">
      <h2 className="font-display text-lg font-semibold text-ink-strong">{t("studio.readers.invite.heading")}</h2>
      {grantedEmail ? (
        <>
          <DoneScreen
            username={username}
            done={`${t("studio.invite.done.banner", { email: grantedEmail })} ${t("studio.invite.done.accessExists")}`}
          />
          <button
            type="button"
            onClick={() => setGrantedEmail(null)}
            className="mt-3 text-sm font-semibold text-ink-strong underline underline-offset-2"
          >
            {t("studio.invite.done.inviteAnother")}
          </button>
        </>
      ) : (
        <>
          <p className="mt-1 text-sm text-ink-body">
            {t("studio.invite.what.consequence")}{" "}
            {t(seesCosts ? "studio.invite.what.promiseCosts" : "studio.invite.what.promise")}
          </p>
          <label className={`${EYEBROW} mt-4`}>
            {t("studio.invite.gather.nameLabel")}
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} className={FIELD} />
          </label>
          <label className={`${EYEBROW} mt-3`}>
            {t("studio.invite.gather.emailLabel")}
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
              className={FIELD}
            />
          </label>
          {already && (
            <p className="mt-2 text-sm text-ink-secondary">
              {t("studio.readers.invite.already", {
                name: already.name ?? already.email,
                section: t(SECTION[already.state]),
              })}
            </p>
          )}

          <details className="mt-4 rounded-2xl border border-line-quiet bg-surface-raised p-4">
            <summary className="cursor-pointer text-sm font-semibold text-ink-strong">
              {t("studio.readers.invite.preview")}
            </summary>
            {totalPublishedDays === 0 && (
              <p className="mt-3 rounded-xl border border-coral-300 bg-coral-50 px-4 py-3 text-sm text-ink-body">
                {t("studio.invite.preview.nothingPublished")}
              </p>
            )}
            <ul className="mt-3 divide-y divide-line-faint rounded-xl border border-line-strong">
              {openTrips.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
                  <span className="text-ink-strong">{p.title}</span>
                  <span className="text-xs text-ink-secondary">
                    {t("studio.invite.preview.tripSummary", {
                      days: tn("studio.invite.preview.days", p.publishedDays, { count: String(p.publishedDays) }),
                      photos: tn("studio.day.preview.photoCount", p.photoCount, { count: String(p.photoCount) }),
                    })}
                    {p.costsVisible && ` · ${t("studio.tripVisibility.preview.money")}`}
                  </span>
                  <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700">
                    {t("studio.invite.preview.yes")}
                  </span>
                </li>
              ))}
              {closedTrips.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-2 px-4 py-2 text-sm italic text-ink-secondary">
                  <span>{p.title}</span>
                  <span className="rounded-full bg-surface-subtle px-2 py-0.5 text-xs font-semibold text-ink-secondary">
                    {t("studio.invite.preview.no")}
                  </span>
                </li>
              ))}
            </ul>
            <div className="mt-3 text-sm text-ink-body">
              <p className="font-semibold text-ink-strong">{t("studio.tripVisibility.preview.theyDoNot")}</p>
              {/* B2130/B2132 — drafts, held-back days, money and closed trips are separate facts, each only when true. */}
              <ul className="mt-1" data-they-do-not>
                <li>{tn("studio.tripVisibility.preview.draftDays", totalDraftDays, { count: String(totalDraftDays) })}</li>
                {totalHeldBackDays > 0 && (
                  <li>
                    {tn("studio.tripVisibility.preview.heldBackDays", totalHeldBackDays, { count: String(totalHeldBackDays) })}
                  </li>
                )}
                {!seesCosts && <li>{t("studio.invite.preview.money")}</li>}
                {closedTrips.length > 0 && (
                  <li>{tn("studio.invite.preview.privateTrips", closedTrips.length, { count: String(closedTrips.length) })}</li>
                )}
              </ul>
            </div>
          </details>

          <SubmitError message={writeError} />
          {/* The page's one primary, and yellow: it writes a grant and sends
              a mail. */}
          <StepPrimary
            busy={busy}
            disabled={!name.trim() || !email.trim()}
            onClick={grant}
            label={name.trim() ? t("studio.invite.preview.button", { name: name.trim() }) : t("studio.readers.invite.button")}
            tone="bg-yellow-400 text-yellow-950 hover:bg-yellow-300"
          />
        </>
      )}
    </section>
  );
}
