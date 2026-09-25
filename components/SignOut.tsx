"use client";

import { useState } from "react";
import BusyButton from "@/components/BusyButton";
import ConfirmPanel from "@/components/ConfirmPanel";
import { useI18n } from "@/components/LocaleProvider";
import { tellWorkerSignedOut } from "@/lib/signedOut";
import { hasOutbox, openOutboxStore } from "@/lib/outbox";

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
 *
 * B2329 — the outbox lives in this browser's IndexedDB, not on the server, so
 * a sign-out that goes ahead while writes are still queued loses them for
 * good the moment the cookie they would have been sent with is gone. `owner`
 * is who the outbox is checked for: only an owner's own studio ever queues a
 * write, so a shared or guest reader (no `owner` passed) skips the check.
 */
export default function SignOut({ owner }: { owner?: string }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [waiting, setWaiting] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);

  async function doSignOut() {
    setBusy(true);
    setFailed(false);
    const response = await fetch("/api/auth/logout", { method: "POST" }).catch(
      () => null,
    );

    if (response?.ok) {
      // Before the reload, not after: the reload is what re-requests the home
      // payload, and a worker still holding the old copy would answer it.
      tellWorkerSignedOut();
      // Same boundary the worker's personal cache is cleared at (`purgePersonal`
      // in public/sw.js) — a queue left behind for the next person to sign in
      // on this device is not this owner's to keep, and the confirm above
      // already told them what it held.
      if (owner && hasOutbox()) await openOutboxStore().clear(owner).catch(() => undefined);
      window.location.reload();
      return;
    }
    // Never leave them believing they signed out when they did not — on a
    // borrowed laptop that belief is the whole harm.
    setBusy(false);
    setConfirming(false);
    setFailed(true);
  }

  async function signOut() {
    if (owner && hasOutbox()) {
      const rows = await openOutboxStore().list(owner).catch(() => []);
      if (rows.length > 0) {
        setWaiting(rows.length);
        setConfirming(true);
        return;
      }
    }
    void doSignOut();
  }

  if (confirming) {
    return (
      <section className="mt-8 border-t border-line-quiet pt-6">
        <ConfirmPanel
          label={t("me.signOut")}
          question={t(waiting === 1 ? "studio.outbox.confirmSignOut.one" : "studio.outbox.confirmSignOut", {
            n: String(waiting ?? 0),
          })}
          confirmLabel={t("studio.outbox.signOutAnyway")}
          busyLabel={t("me.signingOut")}
          tone="destructive"
          busy={busy}
          error={failed ? t("me.signOutFailed") : undefined}
          onConfirm={() => void doSignOut()}
          onCancel={() => setConfirming(false)}
        />
      </section>
    );
  }

  return (
    <section className="mt-8 border-t border-line-quiet pt-6">
      <h2 className="font-display text-xl font-semibold text-ink-strong">
        {t("me.signOutTitle")}
      </h2>
      <p className="mt-2 text-base leading-7 text-ink-body">
        {t("me.signOutBody")}
      </p>
      <BusyButton
        busy={busy}
        type="button"
        onClick={() => void signOut()}
        className="mt-4 inline-flex min-h-11 items-center rounded-full border border-line-ink px-5 text-base font-semibold text-ink-strong transition-colors hover:bg-surface-subtle disabled:opacity-50"
        busyLabel={t("me.signingOut")}
      >
        {t("me.signOut")}
      </BusyButton>
      <p role="alert" className="mt-3 text-base text-coral-600 empty:mt-0">
        {failed ? t("me.signOutFailed") : ""}
      </p>
    </section>
  );
}
