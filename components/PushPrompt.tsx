"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import BusyButton from "@/components/BusyButton";
import { Bell, X } from "lucide-react";
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
 * Two different noes, because they are two different statements:
 *
 * - **Not now** snoozes *this journal* for `SNOOZE_DAYS`. A reader who is not
 *   interested today may be after the trip starts.
 * - **Never** is global and permanent, across every journal on the instance.
 *   Somebody who does not want notifications does not want them here either,
 *   and asking again on the next journal is the nagging this is meant to
 *   avoid.
 *
 * A denial from the browser also writes the global key: the reader has said no
 * in the strongest terms the platform offers, and asking again would be asking
 * them to go into settings.
 */

/** Never ask on any journal again. Set by "Never", and by a browser denial. */
const NEVER_KEY = "fs.push.never";
/** Per journal: `fs.push.snooze.<username>`, holding an ISO instant. */
const SNOOZE_PREFIX = "fs.push.snooze.";
const SNOOZE_DAYS = 30;

function snoozedUntil(username: string): number {
  const raw = window.localStorage.getItem(`${SNOOZE_PREFIX}${username}`);
  const at = raw ? Date.parse(raw) : NaN;
  return Number.isNaN(at) ? 0 : at;
}

export default function PushPrompt({ username }: { username: string }) {
  const { t } = useI18n();
  const engaged = useEngagement();
  const pathname = usePathname();
  // Never under the studio — B1992. The studio is a work surface an owner
  // scrolls all the way to the bottom of, and a card asking about
  // notifications is not one of its actions; it belongs to the reading pages
  // this component was written for.
  const underStudio = Boolean(pathname?.startsWith(`/${username}/studio`));
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [eligible, setEligible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (underStudio) return;
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
  }, [username, underStudio]);

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

  const never = useCallback(() => {
    window.localStorage.setItem(NEVER_KEY, "1");
    setGone(true);
  }, []);

  if (underStudio || !eligible || !engaged || gone) return null;

  return (
    /*
      In flow, above the footer, rather than pinned to the viewport — B1992.
      A `fixed` card had nothing reserving room for it, so on a page nothing
      else made scrollable (every studio page) it landed on top of the last
      content instead of below it. Rendered here, at the foot of a page's own
      content, it can only ever push the page taller, never cover it.
      `sm:justify-end` on the outer row plus `sm:max-w-sm` on the card keeps
      it corner-sized once there is room to spare, rather than a full-width
      banner.
    */
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:flex sm:justify-end">
      <div
        role="dialog"
        aria-modal="false"
        aria-label={t("push.prompt.title")}
        className="w-full rounded-2xl border border-line-quiet bg-surface-raised p-4 shadow-lg sm:max-w-sm"
      >
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-yellow-400 text-yellow-950">
            <Bell className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-ink-strong">
              {t("push.prompt.title")}
            </h2>
            <p className="mt-1 text-sm leading-6 text-ink-secondary">
              {t("push.prompt.body")}
            </p>
          </div>
          {/* The quiet way out. Same as "Not now": a reader who closes a card
              has not said never, and treating it as never would be putting
              words in their mouth. */}
          <button
            type="button"
            onClick={notNow}
            aria-label={t("push.prompt.notNow")}
            className="-m-1 shrink-0 rounded-full p-1 text-ink-faint transition-colors hover:text-ink-body
                       focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <BusyButton
            busy={busy}
            type="button"
            onClick={accept}
            className="inline-flex min-h-11 flex-1 items-center justify-center rounded-xl bg-action-strong px-4
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
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-line-quiet px-3
                       text-sm font-semibold text-ink-body transition-colors hover:border-line-prominent
                       focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
          >
            {t("push.prompt.notNow")}
          </button>
        </div>
        {/* Quieter than the other two, and still a real 44px target: it is the
            answer with the longest memory, so it should be chosen rather than
            hit by accident. */}
        <button
          type="button"
          onClick={never}
          className="mt-1 inline-flex min-h-11 items-center text-xs text-ink-muted underline underline-offset-4
                     transition-colors hover:text-ink-strong
                     focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
        >
          {t("push.prompt.never")}
        </button>
      </div>
    </div>
  );
}
