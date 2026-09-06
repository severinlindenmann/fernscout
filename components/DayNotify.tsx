"use client";

import { useEffect, useState } from "react";
import { useI18n } from "./LocaleProvider";

type Status = {
  ok: true;
  reachable: boolean;
  alreadySent: boolean;
  pending: string[];
  needed: number;
  balance: number | null;
  short: boolean;
};

/**
 * The button on a day itself, for the owner alone — B633.
 *
 * `sendDayLetter` / `sendDayWhatsapp` (`lib/digest/`) already exist behind
 * `POST …/send-mail` and `…/send-whatsapp`; an agent has always been able to
 * ask for a send. What did not exist was a way for the person whose journal
 * it is to do it themselves, see what it costs first, and see afterwards
 * that it already went — so they never have to remember or ask.
 *
 * `app/[user]/trips/[trip]/day/[slug]/notify/route.ts` is the door: the
 * owner's cookie only, refusing a bearer token outright, the same shape as
 * the postcard send button beside it.
 *
 * Rendered unconditionally by `StoryPager`'s `DayCard` and answers `null`
 * itself when there is nothing to do — a reader who is not the owner gets a
 * `403` from the route and this renders nothing, so no flash of a button
 * only to have it vanish.
 */
export default function DayNotify({
  username,
  tripId,
  slug,
}: {
  username: string;
  tripId: string;
  slug: string;
}) {
  const { t } = useI18n();
  const url = `/${username}/trips/${tripId}/day/${slug}/notify`;
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(url)
      .then((r) => (r.ok ? (r.json() as Promise<Status>) : null))
      .then((data) => {
        if (!cancelled && data) setStatus(data);
      })
      .catch(() => {
        // Not signed in as the owner, offline, or the route refused — either
        // way there is nothing to offer, so this stays silent rather than
        // showing an error nobody but the owner would ever see.
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  if (!status || !status.reachable) return null;

  if (status.alreadySent) {
    return <p className="mt-3 text-xs text-navy-600">{t("notify.sent")}</p>;
  }

  if (status.short) {
    return (
      <p className="mt-3 text-xs text-coral-700">
        {t("notify.short", { needed: String(status.needed), balance: String(status.balance) })}{" "}
        <a className="font-semibold underline" href={`/${username}/me`}>
          {t("photobook.getCredits")}
        </a>
      </p>
    );
  }

  const onClick = async () => {
    const message =
      status.balance === null
        ? t("notify.confirmFree")
        : t("notify.confirm", {
            needed: String(status.needed),
            rest: String(status.balance - status.needed),
          });
    if (!window.confirm(message)) return;

    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, { method: "POST" });
      if (!res.ok) {
        setError(t("notify.failed"));
        return;
      }
      setStatus({ ...status, alreadySent: true, pending: [] });
    } catch {
      setError(t("notify.failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3">
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className="rounded-full border border-navy-300 px-3 py-1.5 text-xs font-semibold text-navy-900 transition-colors hover:bg-cream-100 disabled:opacity-50"
      >
        {t("notify.button")}
      </button>
      {error && <p className="mt-1 text-xs text-coral-700">{error}</p>}
    </div>
  );
}
