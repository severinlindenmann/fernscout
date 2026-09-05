"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Bell, X } from "lucide-react";
import { useI18n } from "./LocaleProvider";
import { needsHomeScreenInstall } from "./PushOptIn";
import { subscribeToPush } from "./pushSubscribe";

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
 * After the reader has actually read something — see `useEngagement`. Someone
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

/** How long a reader has to have been *looking* at the page, tab in front,
 * before the ask is earned. Paused while the tab is in the background, so a
 * journal left open in another window never qualifies on its own. */
const DWELL_MS = 15_000;
/** And how far they have to have scrolled, if they have not navigated. */
const SCROLL_PX = 300;

function snoozedUntil(username: string): number {
  const raw = window.localStorage.getItem(`${SNOOZE_PREFIX}${username}`);
  const at = raw ? Date.parse(raw) : NaN;
  return Number.isNaN(at) ? 0 : at;
}

/**
 * Has this reader actually read anything?
 *
 * Two signals, either of which counts, both gated behind visible dwell time:
 * they scrolled a screen's worth, or they moved to another page inside the
 * journal. A timer alone would fire at somebody who opened a tab and walked
 * away, which is the reader least likely to want a prompt waiting for them.
 */
function useEngagement(): boolean {
  const pathname = usePathname();
  const startPath = useRef(pathname);
  const [engaged, setEngaged] = useState(false);

  useEffect(() => {
    if (engaged) return;

    let dwelled = 0;
    let last = Date.now();
    let acted = false;

    const tick = () => {
      const now = Date.now();
      if (document.visibilityState === "visible") dwelled += now - last;
      last = now;
      if (acted && dwelled >= DWELL_MS) setEngaged(true);
    };

    const onScroll = () => {
      if (window.scrollY >= SCROLL_PX) acted = true;
    };

    // A navigation inside the journal — the story pager's day links, a trip,
    // the gallery — is the clearest "I am reading this" there is.
    if (pathname !== startPath.current) acted = true;

    const timer = window.setInterval(tick, 1000);
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [engaged, pathname]);

  return engaged;
}

export default function PushPrompt({ username }: { username: string }) {
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

      const res = await fetch(`/api/push/subscribe?user=${encodeURIComponent(username)}`)
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
    window.localStorage.setItem(`${SNOOZE_PREFIX}${username}`, until.toISOString());
    setGone(true);
  }, [username]);

  const never = useCallback(() => {
    window.localStorage.setItem(NEVER_KEY, "1");
    setGone(true);
  }, []);

  if (!eligible || !engaged || gone) return null;

  return (
    /*
      A card at the bottom of the screen rather than a modal over it. The
      install explainer is a modal because it is instructions somebody has to
      follow; this is a question they are allowed to ignore, and covering the
      day they are reading to ask it would be taking more than the question is
      worth. `sm:max-w-sm` keeps it a card on a desktop instead of a banner
      across the whole window.
    */
    <div
      role="dialog"
      aria-modal="false"
      aria-label={t("push.prompt.title")}
      className="fixed inset-x-0 bottom-0 z-40 p-3 sm:left-auto sm:right-4 sm:max-w-sm"
    >
      <div className="rounded-2xl border border-navy-200 bg-white p-4 shadow-lg">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-yellow-400 text-yellow-950">
            <Bell className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-sm font-semibold text-navy-900">{t("push.prompt.title")}</h2>
            <p className="mt-1 text-sm leading-6 text-navy-600">{t("push.prompt.body")}</p>
          </div>
          {/* The quiet way out. Same as "Not now": a reader who closes a card
              has not said never, and treating it as never would be putting
              words in their mouth. */}
          <button
            type="button"
            onClick={notNow}
            aria-label={t("push.prompt.notNow")}
            className="-m-1 shrink-0 rounded-full p-1 text-navy-400 transition-colors hover:text-navy-700
                       focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={accept}
            disabled={busy}
            className="inline-flex min-h-11 flex-1 items-center justify-center rounded-xl bg-navy-900 px-4
                       text-sm font-semibold text-cream-50 transition-colors hover:bg-navy-700
                       disabled:opacity-50
                       focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
          >
            {busy ? t("push.working") : t("push.prompt.yes")}
          </button>
          <button
            type="button"
            onClick={notNow}
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-navy-200 px-3
                       text-sm font-semibold text-navy-700 transition-colors hover:border-navy-500
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
          className="mt-1 inline-flex min-h-11 items-center text-xs text-navy-500 underline underline-offset-4
                     transition-colors hover:text-navy-800
                     focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
        >
          {t("push.prompt.never")}
        </button>
      </div>
    </div>
  );
}
