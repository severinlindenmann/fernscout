"use client";

import { useState } from "react";
import { MessagesSquare } from "lucide-react";
import { useI18n } from "@/components/LocaleProvider";

/**
 * Who may read this journal's conversations — B976.
 *
 * The owner asked for two things that pull in opposite directions: keep the
 * sessions so they can be studied and improved, and let a person opt out. This
 * control is where those meet, and its wording is the whole of it.
 *
 * **Conversations are saved either way**, because being able to open an old
 * one and carry on is a feature that was asked for and a person's own words
 * are theirs. What this switch decides is whether the operator may read them,
 * and **it starts on** — so the card is a thing to turn off rather than a
 * thing to agree to, and the notice on the first message of a conversation
 * says the same, because implying a permission nobody gave would be the
 * dishonest version of this.
 *
 * Four short lines, and they were longer: a title, a sentence, the switch, and
 * the one fact somebody would otherwise get wrong. A privacy control that
 * takes a paragraph to read is one nobody reads.
 *
 * The state is handed in rather than read back: `/<user>/me` runs on the
 * server and already knows, so a `GET` on the consent route would be a second
 * way to learn one boolean. The checkbox holds its own answer after that,
 * which is what makes it feel like a switch rather than a form.
 */
export default function SessionsConsent({
  username,
  shared: initial,
}: {
  username: string;
  shared: boolean;
}) {
  const { t } = useI18n();
  const [shared, setShared] = useState(initial);
  const [busy, setBusy] = useState(false);

  async function set(next: boolean) {
    setBusy(true);
    // Optimistic, and put back if the server disagrees: the switch is the
    // whole interaction and a checkbox that lags a round trip feels broken.
    setShared(next);
    const response = await fetch(`/api/helper/${encodeURIComponent(username)}/consent`, {
      method: next ? "POST" : "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scope: "sessions" }),
    }).catch(() => null);
    if (!response?.ok) setShared(!next);
    setBusy(false);
  }

  return (
    <div className="rounded-2xl border border-navy-200 bg-white p-5 sm:p-6">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-sky-300/40 text-navy-900">
          <MessagesSquare className="h-[18px] w-[18px]" aria-hidden="true" />
        </span>
        <h3 className="font-display text-lg font-semibold text-navy-900">
          {t("me.sessionsTitle")}
        </h3>
      </div>

      <p className="mt-2 text-sm leading-6 text-navy-700">{t("me.sessionsBody")}</p>

      <label className="mt-3 flex min-h-11 cursor-pointer items-center gap-3">
        <input
          type="checkbox"
          checked={shared}
          disabled={busy}
          onChange={(event) => void set(event.target.checked)}
          className="h-5 w-5 shrink-0 rounded border-navy-300 text-navy-900"
        />
        <span className="text-sm leading-6 text-navy-800">{t("me.sessionsShare")}</span>
      </label>

      {/* The sentence that stops somebody believing they deleted something. */}
      <p className="mt-1 text-xs leading-5 text-navy-500">{t("me.sessionsOffNote")}</p>
    </div>
  );
}
