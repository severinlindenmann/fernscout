"use client";

import { useState } from "react";
import { useI18n } from "@/components/LocaleProvider";
import BackToJournal from "@/components/BackToJournal";

/**
 * The gate in front of a password-protected trip.
 *
 * Written for the person most likely to meet it: someone in their seventies,
 * on a phone, who was sent a link and a word. One field, one button, large
 * type, and an error that says what to do rather than what went wrong.
 *
 * `reason` separates two states that used to look identical. `locked` is a
 * first meeting. `stale` is a reader who was let in before and whose cookie
 * stopped verifying — the password was changed, or ninety days passed — and
 * who would otherwise conclude they had done something wrong. See
 * `tripLockReason` in lib/tripGate.ts.
 */
export default function TripPasswordForm({
  tripId,
  tripTitle,
  username,
  journalTitle,
  reason = "locked",
}: {
  tripId: string;
  tripTitle: string;
  username: string;
  journalTitle: string;
  reason?: "locked" | "stale";
}) {
  const { t } = useI18n();
  const [password, setPassword] = useState("");
  const [state, setState] = useState<"idle" | "working" | "wrong" | "throttled" | "serverFault">(
    "idle",
  );

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setState("working");
    const body = new FormData();
    body.set("trip", tripId);
    body.set("password", password);

    const response = await fetch("/api/trip-access", { method: "POST", body });
    if (response.ok) {
      // A full reload rather than a router refresh: the gate lives in a layout,
      // and the whole subtree below it now renders differently.
      window.location.reload();
      return;
    }
    // 503 means the password was right and the server still could not let them
    // in. Saying "wrong password" there sends somebody looking for a mistake
    // they did not make, and they will look for a long time.
    setState(
      response.status === 429 ? "throttled" : response.status === 503 ? "serverFault" : "wrong",
    );
    setPassword("");
  }

  const errorKey =
    state === "wrong"
      ? "access.wrong"
      : state === "throttled"
        ? "access.throttled"
        : state === "serverFault"
          ? "access.serverFault"
          : null;

  return (
    <main
      id="main"
      tabIndex={-1}
      className="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-6 py-16"
    >
      <h1 className="font-display text-2xl text-navy-900">
        {reason === "stale" ? t("err.passwordChangedTitle") : tripTitle}
      </h1>
      <p className="mt-3 text-lg leading-8 text-navy-700">
        {reason === "stale" ? t("err.passwordChangedBody") : t("access.prompt")}
      </p>

      <form onSubmit={submit} className="mt-6">
        <label htmlFor="trip-password" className="block text-base font-medium text-navy-700">
          {t("access.password")}
        </label>
        <input
          id="trip-password"
          name="password"
          type="password"
          autoComplete="current-password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          // Points at the error only while there is one: a permanently present
          // aria-describedby makes a screen reader read an empty node on every
          // focus, and pointing at a node that is not in the DOM reads nothing
          // at all when the error does appear.
          aria-describedby={errorKey ? "trip-password-error" : undefined}
          aria-invalid={state === "wrong" ? true : undefined}
          className="mt-2 w-full rounded-xl border border-navy-200 bg-white px-4 py-3 text-base
                     text-navy-900"
        />

        {/* One live region rather than two conditional paragraphs: swapping
            between "wrong password" and "too many tries" inside the same node
            is announced; replacing one node with another often is not. */}
        <p
          id="trip-password-error"
          role="alert"
          className="mt-3 text-base text-coral-600 empty:mt-0"
        >
          {errorKey ? t(errorKey) : ""}
        </p>

        <button
          type="submit"
          disabled={state === "working" || password === ""}
          className="mt-5 min-h-12 w-full rounded-xl bg-navy-900 px-4 py-3 text-lg font-medium
                     text-cream-50 disabled:opacity-50"
        >
          {state === "working" ? t("access.working") : t("access.submit")}
        </button>
      </form>

      {/* This page has no header — it cannot show a locked trip's navigation —
          and without this there was nothing to do but edit the address bar. */}
      <div className="mt-10">
        <BackToJournal username={username} journalTitle={journalTitle} />
      </div>
    </main>
  );
}
