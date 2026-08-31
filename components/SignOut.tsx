"use client";

import { useState } from "react";
import { useI18n } from "@/components/LocaleProvider";

/**
 * The way out.
 *
 * `/api/auth/logout` has existed since W08 and nothing has ever called it: a
 * guest session lasts a year (decision 24), so a reader on a shared or
 * borrowed device had no way to end one, and the page whose whole job is
 * answering "what do I have access to?" could not answer "and how do I stop".
 *
 * Deliberately quiet — a bordered secondary control rather than a filled
 * button, at the foot of the page rather than beside the greeting. This is the
 * page written for the reader who opens the site once a month and has lost the
 * email, and for them signing out is the expensive mistake, not the goal. It
 * says what it will cost before they press it rather than asking them to
 * confirm afterwards: a second click protects nobody who did not read the
 * first one.
 *
 * No optimistic state. The cookie is cleared by the server and this page is
 * rendered from it, so the honest confirmation is the reloaded page saying
 * "you are not signed in" — the same reason `GuestSignIn` reloads rather than
 * calling `router.refresh()`.
 */
export default function SignOut() {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function signOut() {
    setBusy(true);
    setFailed(false);
    const response = await fetch("/api/auth/logout", { method: "POST" }).catch(() => null);

    if (response?.ok) {
      window.location.reload();
      return;
    }
    // Never leave them believing they signed out when they did not — on a
    // borrowed laptop that belief is the whole harm.
    setBusy(false);
    setFailed(true);
  }

  return (
    <section className="mt-8 border-t border-navy-200 pt-6">
      <h2 className="font-display text-xl font-semibold text-navy-900">{t("me.signOutTitle")}</h2>
      <p className="mt-2 text-base leading-7 text-navy-700">{t("me.signOutBody")}</p>
      <button
        type="button"
        onClick={signOut}
        disabled={busy}
        className="mt-4 inline-flex min-h-11 items-center rounded-full border border-navy-700 px-5 text-base font-semibold text-navy-900 transition-colors hover:bg-cream-100 disabled:opacity-50"
      >
        {busy ? t("me.signingOut") : t("me.signOut")}
      </button>
      <p role="alert" className="mt-3 text-base text-coral-600 empty:mt-0">
        {failed ? t("me.signOutFailed") : ""}
      </p>
    </section>
  );
}
