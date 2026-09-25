"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import UpLink from "@/components/UpLink";
import LocaleSwitcher from "@/components/LocaleSwitcher";
import IdentitySignIn from "@/components/IdentitySignIn";
import SignupWizard from "@/components/SignupWizard";
import { useI18n } from "@/components/LocaleProvider";
import { JOURNAL_COOKIE } from "@/lib/requestKeys";

/**
 * `/welcome` — where a journal is made from nothing, B2170.
 *
 * The same `SignupWizard` `/agent` used to mount (B688), not a second signup
 * path: email and code, then name and address (and a proven phone number
 * where the instance asks for one), then the journal. It ends signed in on
 * `/<user>/studio`, whose "A new trip" card makes the first trip.
 *
 * With `signup` off there is no form that cannot work: one sentence saying
 * so, and the instance-wide sign-in for somebody who already has a journal.
 */
export default function WelcomeDoor({
  codeMinutes,
  identityEmail,
  signupEnabled,
  siteName,
}: {
  /** From `CODE_TTL_MINUTES` — `lib/auth` is server-only. */
  codeMinutes: string;
  /** The address behind a live `fs_identity` cookie, prefilled only. A signup
   *  token still needs its own fresh code. */
  identityEmail: string | null;
  signupEnabled: boolean;
  siteName: string;
}) {
  const { t, locale } = useI18n();
  const router = useRouter();
  /** B1568 — the wizard's code step found the address already owns a journal;
   *  the way forward is signing in as it. */
  const [owns, setOwns] = useState(false);

  /**
   * Carried over unchanged from `AgentDoor`'s `intoTheWizard`. The session
   * itself was already set server-side by `/api/auth/links/redeem` inside the
   * wizard; this cookie grants nothing. It only names which of a person's
   * journals `/agent` should open (`app/agent/page.tsx` reads it), so a
   * signup that just made a second journal does not have `/agent` fall back
   * to the first one it finds. Kept until B2173 removes `/agent`.
   */
  function intoTheStudio(username: string, signedIn: boolean) {
    document.cookie = `${JOURNAL_COOKIE}=${encodeURIComponent(username)};path=/;max-age=31536000;samesite=lax`;
    // Without a session the studio answers 404 (it does not say whose it
    // is); the journal's own `/me` offers the code sign-in instead, and the
    // welcome mail's link works too.
    router.push(`/${encodeURIComponent(username)}/${signedIn ? "studio" : "me"}`);
  }

  // The session cookie is set by the server; `/` renders the signed-in
  // order from it, the reader's own journals first.
  const signIn = <IdentitySignIn codeMinutes={codeMinutes} onDone={() => router.push("/")} />;

  return (
    <div className="min-h-screen bg-surface-subtle">
      <div className="mx-auto flex max-w-xl items-center justify-between px-4 pt-6">
        <UpLink
          href="/"
          label={siteName}
          className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-ink-body
                     transition-colors hover:text-ink-strong
                     focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
        />
        <LocaleSwitcher subtle />
      </div>
      <main className="mx-auto w-full max-w-xl px-4 pb-12 pt-4">
        <h1 className="font-display text-2xl font-semibold text-ink-strong">{t("signupPage.title")}</h1>
        {!signupEnabled ? (
          <>
            <p className="mt-2 text-sm text-ink-body">{t("agent.signupOff")}</p>
            <div className="mt-6">{signIn}</div>
          </>
        ) : owns ? (
          <div className="mt-6">{signIn}</div>
        ) : (
          <div className="mt-6">
            <SignupWizard
              email={identityEmail ?? undefined}
              locale={locale}
              codeMinutes={codeMinutes}
              onSignedIn={intoTheStudio}
              onAlreadyOwns={() => setOwns(true)}
            />
            <p className="mt-4">
              <Link href="/?start=1" className="text-sm font-semibold text-ink-strong underline underline-offset-2">
                {t("signupPage.haveOne")}
              </Link>
            </p>
          </div>
        )}
      </main>
    </div>
  );
}
