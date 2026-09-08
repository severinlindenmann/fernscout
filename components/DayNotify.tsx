"use client";

import { useEffect, useState } from "react";
import { useI18n } from "./LocaleProvider";
import BusyButton from "@/components/BusyButton";
import { OWNER_TOOL, OWNER_TOOL_CELL } from "./ownerToolClass";

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
 * The confirmation is a panel in the page rather than `window.confirm` —
 * B633. A browser dialog arrives in the operating system's own type, with a
 * generic title bar naming the domain, and it is the one moment this control
 * is asking somebody to spend real money on real letters: it should look like
 * the journal it belongs to. It also answers a question `window.confirm`
 * cannot — what a send costs and what is left afterwards, in the page's own
 * words.
 *
 * Rendered unconditionally by `OwnerTools`, as one cell of its grid — which
 * is why the states that are a sentence or a panel rather than a tile take
 * `col-span-full` (B877). It answers `null`
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
  const [asking, setAsking] = useState(false);
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
    return (
      <p className="col-span-full text-xs text-navy-600">{t("notify.sent")}</p>
    );
  }

  if (status.short) {
    return (
      <p className="col-span-full text-xs text-coral-700">
        {t("notify.short", {
          needed: String(status.needed),
          balance: String(status.balance),
        })}{" "}
        <a className="font-semibold underline" href={`/${username}/me`}>
          {t("photobook.getCredits")}
        </a>
      </p>
    );
  }

  const message =
    status.balance === null
      ? t("notify.confirmFree")
      : t("notify.confirm", {
          needed: String(status.needed),
          rest: String(status.balance - status.needed),
        });

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, { method: "POST" });
      if (!res.ok) {
        setError(t("notify.failed"));
        return;
      }
      setStatus({ ...status, alreadySent: true, pending: [] });
      setAsking(false);
    } catch {
      setError(t("notify.failed"));
    } finally {
      setBusy(false);
    }
  };

  if (asking) {
    return (
      // A panel in the flow of the day, not a modal over it: the question is
      // about the day being read and covering it up to ask would take more
      // than the question is worth — the same call `PushPrompt` makes.
      <div
        role="dialog"
        aria-modal="false"
        aria-label={t("notify.button")}
        className="col-span-full rounded-2xl border border-navy-200 bg-white p-4 shadow-sm"
      >
        <p className="text-sm leading-6 text-navy-700">{message}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <BusyButton
            busy={busy}
            type="button"
            onClick={send}
            className="min-h-11 rounded-full bg-yellow-400 px-4 text-xs font-semibold text-yellow-950 transition-colors hover:bg-yellow-300 disabled:opacity-50"
          >
            {t("notify.button")}
          </BusyButton>
          <BusyButton
            busy={busy}
            type="button"
            onClick={() => setAsking(false)}
            className="min-h-11 rounded-full border border-navy-300 px-4 text-xs font-semibold text-navy-700 transition-colors hover:bg-cream-100 disabled:opacity-50"
          >
            {t("notify.cancel")}
          </BusyButton>
        </div>
        {error && <p className="mt-2 text-xs text-coral-700">{error}</p>}
      </div>
    );
  }

  return (
    <div className={OWNER_TOOL_CELL}>
      <button
        type="button"
        onClick={() => setAsking(true)}
        className={OWNER_TOOL}
      >
        {t("notify.button")}
      </button>
      {error && <p className="text-xs text-coral-700">{error}</p>}
    </div>
  );
}
