"use client";

import { useState } from "react";
import { useI18n } from "@/components/LocaleProvider";

export type ReadAlongState = { status: "none" } | { status: "live"; url: string } | { status: "paused" };

/**
 * The "Ask to read along" block on the share screen, for a readers-only
 * ("guest") trip — B2665 round 2. A standing link the owner turns on once;
 * holding it is still only a request (the same `/j/<code>` door every
 * other guest link uses), never a grant. Pause and resume are explicit
 * owner presses only — a new story never flips either switch itself.
 */
export default function ReadAlongLink({
  username,
  initial,
  onLiveChange,
}: {
  username: string;
  initial: ReadAlongState;
  /** Told whenever the live URL changes (or disappears), so the caller can
   * include it in the share — or stop offering it once paused. */
  onLiveChange: (url: string | null) => void;
}) {
  const { t } = useI18n();
  const [state, setState] = useState<ReadAlongState>(initial);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function act(action: "start" | "pause" | "resume") {
    setBusy(true);
    setFailed(false);
    try {
      // no-refresh: this block's own `setState`/`onLiveChange` below update
      // the share screen directly — there is no server-rendered list on
      // this page that a `router.refresh()` would need to catch up with.
      const response = await fetch(`/api/web/${encodeURIComponent(username)}/story-link`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = (await response.json()) as ReadAlongState | { status: "unavailable" };
      if (!response.ok || body.status === "unavailable") throw new Error("failed");
      setState(body);
      onLiveChange(body.status === "live" ? body.url : null);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  const box = "rounded-xl border border-line-quiet bg-surface-subtle px-3 py-3";

  if (state.status === "none") {
    return (
      <div className={box}>
        <p className="text-sm font-semibold text-ink-strong">{t("studio.share.readAlong.noneTitle")}</p>
        <p className="mt-1 text-xs text-ink-secondary">{t("studio.share.readAlong.noneBody")}</p>
        <button
          type="button"
          disabled={busy}
          onClick={() => void act("start")}
          className="mt-2 min-h-9 rounded-lg bg-yellow-400 px-3 text-xs font-semibold text-navy-900 hover:bg-yellow-300 disabled:opacity-60"
        >
          {t("studio.share.readAlong.turnOn")}
        </button>
        {failed && <p role="alert" className="mt-2 text-xs text-coral-600">{t("studio.share.failed")}</p>}
      </div>
    );
  }

  if (state.status === "paused") {
    return (
      <div className={box}>
        <p className="text-sm font-semibold text-ink-strong">{t("studio.share.readAlong.pausedTitle")}</p>
        <p className="mt-1 text-xs text-ink-secondary">{t("studio.share.readAlong.pausedStays")}</p>
        <button
          type="button"
          disabled={busy}
          onClick={() => void act("resume")}
          className="mt-2 min-h-9 rounded-lg bg-yellow-400 px-3 text-xs font-semibold text-navy-900 hover:bg-yellow-300 disabled:opacity-60"
        >
          {t("studio.share.readAlong.resume")}
        </button>
        {failed && <p role="alert" className="mt-2 text-xs text-coral-600">{t("studio.share.failed")}</p>}
      </div>
    );
  }

  return (
    <div className={box}>
      <p className="text-sm font-semibold text-ink-strong">{state.url.replace(/^https?:\/\//, "")}</p>
      <p className="mt-1 text-xs text-ink-secondary">{t("studio.share.readAlong.liveBody")}</p>
      <button
        type="button"
        disabled={busy}
        onClick={() => void act("pause")}
        className="mt-2 min-h-9 rounded-lg border border-line-strong px-3 text-xs font-semibold text-ink-strong"
      >
        {t("studio.share.readAlong.pause")}
      </button>
      {failed && <p role="alert" className="mt-2 text-xs text-coral-600">{t("studio.share.failed")}</p>}
    </div>
  );
}
