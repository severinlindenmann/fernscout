"use client";

import { useState } from "react";
import Link from "next/link";
import { TITLE_H1 } from "@/components/landing/kit";
import { TEXT_LINK } from "@/components/landing/styles";
import IdentitySignIn from "@/components/IdentitySignIn";
import SignupWizard from "@/components/SignupWizard";
import { useI18n } from "@/components/LocaleProvider";
import { JOURNAL_COOKIE } from "@/lib/requestKeys";

import { journalPath } from "@/lib/journalPath";
/**
 * `/welcome` — where a journal is made from nothing, B2170.
 *
 * The same `SignupWizard` `/agent` used to mount (B688), not a second signup
 * path: email and code, then name and address (and a proven phone number
 * where the instance asks for one), then the journal. It ends signed in on
 * `/@<user>/studio`, whose "A new trip" card makes the first trip.
 *
 * With `signup` off there is no form that cannot work: one sentence saying
 * so, and the instance-wide sign-in for somebody who already has a journal.
 */
export default function WelcomeDoor({
  codeMinutes,
  identityEmail,
  resume,
  initialSignupToken,
  signupEnabled,
  phoneCountryCode,
  contactEmail,
}: {
  /** From `CODE_TTL_MINUTES` — `lib/auth` is server-only. */
  codeMinutes: string;
  /** The address behind a live `fs_identity` cookie. While the field still
   *  holds it, the wizard skips the code (B2522). */
  identityEmail: string | null;
  /** B2804 — that address left a signup half-done; the wizard resumes it. */
  resume?: boolean;
  /** B2781 — see `SignupWizard`. */
  initialSignupToken?: string;
  signupEnabled: boolean;
  /** `whatsappCountryCode()` — `lib/contactNumber.ts` is server-only, so this
   *  instance's own dialling-code convention (`features.whatsapp.defaultCountryCode`)
   *  arrives as a prop rather than a second import. Absent (or not passed at
   *  all, the default for a caller that names none) means this instance
   *  named no convention, and the phone step says nothing country-specific. */
  phoneCountryCode?: string | null;
  /** `serverSite().operatorEmail` — B2357. Absent means this instance named
   *  no monitored address, and the "no WhatsApp" hint says so without one. */
  contactEmail?: string | null;
}) {
  const { t, locale } = useI18n();
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
    //
    // A full load, not `router.push` (B2550): reading pages are now kept for
    // 30s (`unstable_dynamicStaleTime`), and a signup just changed the
    // session cookie this same browser tab may have cached a signed-out
    // render under. `router.push` would risk serving that stale copy; a full
    // navigation always re-requests it.
    window.location.assign(`${journalPath(encodeURIComponent(username))}/${signedIn ? "studio" : "me"}`);
  }

  // The session cookie is set by the server; `/` renders the signed-in
  // order from it, the reader's own journals first. A full load for the same
  // reason as `intoTheStudio` above — B2550.
  const signIn = (
    <IdentitySignIn codeMinutes={codeMinutes} onDone={() => window.location.assign("/")} />
  );

  return (
    // B2531: the frame (the slim header C) and the reading width are the
    // page's, `PageShell` and `Band` in app/welcome/page.tsx.
    <>
        <h1 className={TITLE_H1}>{t("signupPage.title")}</h1>
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
              resume={resume}
              initialSignupToken={initialSignupToken}
              locale={locale}
              codeMinutes={codeMinutes}
              onSignedIn={intoTheStudio}
              onAlreadyOwns={() => setOwns(true)}
              phoneCountryCode={phoneCountryCode}
              contactEmail={contactEmail}
            />
            <p className="mt-4">
              <Link href="/?start=1" className={`text-sm ${TEXT_LINK}`}>
                {t("signupPage.haveOne")}
              </Link>
            </p>
          </div>
        )}
    </>
  );
}
