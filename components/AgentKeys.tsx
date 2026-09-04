"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "./LocaleProvider";

/**
 * Every key that can write to this journal, and a button to kill each — B283.
 *
 * The handover block above makes handing an agent a seven-day write token a
 * two-second act. This is the other half of that: taking one back has to be a
 * two-second act too, or the honest advice would be "only do this if you are
 * sure", which is not advice anybody can follow.
 *
 * Loaded on mount rather than rendered from the server, because it is the one
 * thing on this page that changes without the page changing — an agent
 * exchanging a credential adds a row, and an owner who has just pressed the
 * button above wants to see it appear. Absent while empty: an owner who has
 * never started an agent should not be shown a heading over nothing.
 */

type Key = {
  id: string;
  kind: "agent" | "handover";
  createdAt: string;
  expiresAt: string;
  lastSeenAt: string | null;
};

export default function AgentKeys({
  username,
  reloadOn = 0,
}: {
  username: string;
  /**
   * Bumped by whatever has just created a key, to make this read the list
   * again.
   *
   * It exists because of a real gap found in the browser: this component
   * mounts when the page does, the handover button is pressed afterwards, and
   * the key that button creates was therefore absent from the list until the
   * owner reloaded. A key you cannot see is a key you cannot revoke, which is
   * the whole reason this list exists.
   */
  reloadOn?: number;
}) {
  const { t } = useI18n();
  const [keys, setKeys] = useState<Key[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  /** Reads the list. Returns it rather than setting state, so the effect below
   * can drop an answer that arrived too late — see the comment there. */
  const fetchKeys = useCallback(async (): Promise<Key[]> => {
    const response = await fetch(`/api/v1/${username}/keys`).catch(() => null);
    // A journal with sign-in off answers 404 here, which is not an error to
    // report — it is a page with nothing to show.
    if (!response?.ok) return [];
    const body = (await response.json()) as { keys?: Key[] };
    return body.keys ?? [];
  }, [username]);

  useEffect(() => {
    // `active` rather than a bare call, for two reasons. It keeps `setKeys`
    // out of the effect's synchronous body, which is what
    // `react-hooks/set-state-in-effect` is about; and it drops a response that
    // arrives after this effect has been cleaned up, which would otherwise
    // show one journal's keys under another's name for as long as the request
    // took.
    let active = true;
    void (async () => {
      const rows = await fetchKeys();
      if (active) setKeys(rows);
    })();
    return () => {
      active = false;
    };
  }, [fetchKeys, reloadOn]);

  async function revoke(id: string) {
    setBusy(id);
    await fetch(`/api/v1/${username}/keys`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ revoke: id }),
    }).catch(() => null);
    setKeys(await fetchKeys());
    setBusy(null);
  }

  if (keys === null || keys.length === 0) return null;

  return (
    <div className="mt-5">
      <h3 className="font-display text-base font-semibold text-navy-900">{t("me.keysTitle")}</h3>
      <p className="mt-1 text-base leading-7 text-navy-700">{t("me.keysBody")}</p>
      <ul className="mt-3 space-y-2">
        {keys.map((key) => (
          <li
            key={key.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-navy-200 bg-white px-4 py-3"
          >
            <span className="text-base">
              <span className="font-semibold text-navy-900">
                {t(key.kind === "handover" ? "me.keysHandover" : "me.keysAgent")}
              </span>
              <span className="block text-sm text-navy-600">
                {[
                  t("me.keysUntil", { date: new Date(key.expiresAt).toLocaleString() }),
                  key.lastSeenAt
                    ? t("me.keysUsed", { date: new Date(key.lastSeenAt).toLocaleString() })
                    : t("me.keysUnused"),
                ].join(" · ")}
              </span>
            </span>
            <button
              type="button"
              disabled={busy === key.id}
              onClick={() => revoke(key.id)}
              className="rounded-lg border border-navy-200 px-3 py-1 text-sm text-navy-700 disabled:opacity-50"
            >
              {t("me.keysRevoke")}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
