"use client";

import { useCallback, useEffect, useState } from "react";
import BusyButton from "@/components/BusyButton";
import { Bell } from "lucide-react";
import { useI18n } from "./LocaleProvider";
import { needsHomeScreenInstall } from "./PushOptIn";
import { subscribeToPush } from "./pushSubscribe";
import { useEngagement } from "./useEngagement";

/**
 * Offering notifications to a reader who never went looking for them — B440.
 *
 * The switch exists in two places (`TripHero`, and `/<user>/me` since B439)
 * and both have to be found. Somebody reading their daughter's journal does
 * not know that a bell icon under a trip's hero is what gets them the next
 * day; they find out there was a way when they stop hearing about it.
 *
 * ## Where it lives — B2464
 *
 * Used to be appended after every page's content in `app/at/[user]/layout.tsx`,
 * pushed into the corner of whatever page happened to be open — /me, the
 * trips list, a finished trip — disconnected from anything the reader had
 * just done. It now renders exactly once: inside `DayCard` (`StoryPager.tsx`),
 * after the reactions row and before the pager's own Back/Continue row, and
 * only at the end of the **newest published day of a trip that is still
 * going** (`trip.status !== "past"`). That is the only moment "the next day"
 * is a real thing to want — a finished trip has none, and a day that is not
 * the newest is not the one somebody has just caught up to.
 *
 * ## The one rule this component exists to keep
 *
 * **It never calls `Notification.requestPermission()` itself.** This is a
 * *soft* ask — an in-page card that costs nothing to decline — and only
 * pressing yes reaches the browser's own prompt, inside that click, through
 * `subscribeToPush`. Two reasons, and the second is the one that matters:
 *
 * - Safari refuses the real prompt outside a user gesture, and Chrome and
 *   Firefox penalise an origin that fires one on load.
 * - A **denied** browser permission is close to permanent. Undoing it means
 *   finding a buried settings screen, which for the reader this whole feature
 *   is written for means never. So a reflexive "no" to a browser prompt is
 *   unrecoverable, where a reflexive "not now" to this card costs nothing.
 *
 * ## When it appears
 *
 * After the reader has actually read something — see
 * `components/useEngagement.ts`, which B1718 lifted out of this file so the
 * showcase bar could ask the same question the same way. Someone
 * who has read a day has a reason to want the next one, so the ask makes sense
 * to them; someone who bounced in three seconds is never interrupted.
 *
 * ## What "no" means
 *
 * - **Not now** snoozes *this journal* for `SNOOZE_DAYS`. A reader who is not
 *   interested today may be after the trip starts.
 * - **Don't ask again**, since B2464, lives on `/<user>/me` beside the push
 *   switch rather than as a button on this card — it is global and permanent,
 *   across every journal on the instance, and a settings page is where a
 *   permanent, reversible choice belongs, not a card the reader may never see
 *   twice. See `NeverAskNextDay.tsx`.
 *
 * A denial from the browser also writes the global key: the reader has said no
 * in the strongest terms the platform offers, and asking again would be asking
 * them to go into settings.
 */

/** Never ask on any journal again. Set by the `/me` switch, and by a browser
 * denial. Exported so `NeverAskNextDay` (the `/me` toggle) reads and writes
 * the same key this component checks. */
export const NEVER_KEY = "fs.push.never";
/** Per journal: `fs.push.snooze.<username>`, holding an ISO instant. */
const SNOOZE_PREFIX = "fs.push.snooze.";
const SNOOZE_DAYS = 30;

function snoozedUntil(username: string): number {
  const raw = window.localStorage.getItem(`${SNOOZE_PREFIX}${username}`);
  const at = raw ? Date.parse(raw) : NaN;
  return Number.isNaN(at) ? 0 : at;
}

export default function PushPrompt({
  username,
  /** The day number to offer notification for — one past the day this card
   * sits at the end of. */
  nextDayNumber,
}: {
  username: string;
  nextDayNumber: number;
}) {
  const { t } = useI18n();
  const engaged = useEngagement();
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [eligible, setEligible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let cancelled = false;

    const decide = async () => {
      // The reader's own answers first: both are free to read and both are
      // final for now, so nothing else needs asking.
      if (window.localStorage.getItem(NEVER_KEY)) return;
      if (Date.now() < snoozedUntil(username)) return;

      // Nothing to offer on a browser that cannot do it, or on an iPhone that
      // has not added the site to the Home Screen — that reader needs the
      // install explainer (`PushInstallOnboarding`), not this.
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
      if (!("Notification" in window)) return;
      if (needsHomeScreenInstall()) return;

      /**
       * Already answered at the browser level. `granted` means they are
       * subscribed somewhere or about to be — either way, not something to
       * ask about — and `denied` is the permanent no described above.
       */
      if (Notification.permission !== "default") {
        if (Notification.permission === "denied") {
          window.localStorage.setItem(NEVER_KEY, "1");
        }
        return;
      }

      const res = await fetch(
        `/api/push/subscribe?user=${encodeURIComponent(username)}`,
      )
        .then((r) => r.json())
        .catch(() => null);
      if (cancelled || !res?.enabled || !res.publicKey) return;

      // Already subscribed on this browser for this journal — the permission
      // check above usually catches this, and this catches the case where the
      // permission is shared and the subscription is not.
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) return;
      if (await reg.pushManager.getSubscription()) return;

      if (cancelled) return;
      setPublicKey(res.publicKey);
      setEligible(true);
    };

    decide().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [username]);

  const accept = useCallback(async () => {
    if (!publicKey) return;
    setBusy(true);
    const result = await subscribeToPush(username, publicKey);
    // A denial is the permanent one; the reader would have to go into settings
    // to undo it, so this must never ask again anywhere.
    if (result === "denied") window.localStorage.setItem(NEVER_KEY, "1");
    setBusy(false);
    setGone(true);
  }, [publicKey, username]);

  const notNow = useCallback(() => {
    const until = new Date(Date.now() + SNOOZE_DAYS * 24 * 60 * 60 * 1000);
    window.localStorage.setItem(
      `${SNOOZE_PREFIX}${username}`,
      until.toISOString(),
    );
    setGone(true);
  }, [username]);

  if (!eligible || !engaged || gone) return null;

  return (
    /*
      One slim row across the day card's width on desktop; the same content
      wraps onto its own lines on a phone rather than needing a separate
      layout — B2464/B310 (fixes.html item 13).
    */
    <div
      role="group"
      aria-label={t("push.prompt.title")}
      className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-line-quiet bg-surface-raised px-4 py-3"
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-yellow-400 text-yellow-950">
        <Bell className="h-3.5 w-3.5" aria-hidden />
      </span>
      <div className="min-w-[10rem] flex-1">
        <p className="text-sm font-semibold text-ink-strong">
          {t("push.prompt.wantDay", { n: String(nextDayNumber) })}
        </p>
        <p className="text-xs leading-5 text-ink-secondary">
          {t("push.prompt.body")}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <BusyButton
          busy={busy}
          type="button"
          onClick={accept}
          className="inline-flex min-h-11 items-center justify-center rounded-xl bg-action-strong px-4
                     text-sm font-semibold text-on-action transition-colors hover:bg-action-strong-hover
                     disabled:opacity-50
                     focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
          busyLabel={t("push.working")}
        >
          {t("push.prompt.yes")}
        </BusyButton>
        <button
          type="button"
          onClick={notNow}
          className="text-sm font-semibold text-ink-body underline underline-offset-4 transition-colors
                     hover:text-ink-strong
                     focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
        >
          {t("push.prompt.notNow")}
        </button>
      </div>
    </div>
  );
}
