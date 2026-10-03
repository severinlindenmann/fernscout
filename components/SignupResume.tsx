"use client";

import { useState } from "react";
import Link from "next/link";
import BusyButton from "@/components/BusyButton";
import WelcomeDoor from "@/components/WelcomeDoor";
import { TITLE_H1 } from "@/components/landing/kit";
import { TEXT_LINK } from "@/components/landing/styles";
import { useI18n } from "@/components/LocaleProvider";

/**
 * The press behind `/welcome/r/<token>` — B2781. One button spends the
 * mailed link (`POST /api/auth/signup/resume`); the signup token that comes
 * back goes straight to the wizard, which jumps to the step still open.
 */
export default function SignupResume({
  token,
  first = false,
  signupEnabled,
  inviteOnly,
  codeMinutes,
  phoneCountryCode,
  contactEmail,
}: {
  token: string;
  /** The approval mail's link: a first visit, worded "Start", not "Continue". */
  first?: boolean;
  signupEnabled: boolean;
  inviteOnly?: boolean;
  codeMinutes: string;
  phoneCountryCode: string | null;
  contactEmail: string | null;
}) {
  const { t } = useI18n();
  const [state, setState] = useState<"idle" | "working" | "expired" | "owns" | "failed">("idle");
  const [signupToken, setSignupToken] = useState<string | null>(null);
  const [resumed, setResumed] = useState(true);

  async function press() {
    setState("working");
    const response = await fetch("/api/auth/signup/resume", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    }).catch(() => null);
    const body = (await response?.json().catch(() => null)) as { token?: string; error?: string; resumed?: boolean } | null;
    if (response?.ok && typeof body?.token === "string") {
      setResumed(body.resumed === true);
      setSignupToken(body.token);
      return;
    }
    setState(
      body?.error === "too_many_journals" ? "owns"
        : body?.error === "invalid_resume_link" || body?.error === "signup_not_invited" ? "expired"
        : "failed",
    );
  }

  if (signupToken) {
    return (
      <WelcomeDoor
        codeMinutes={codeMinutes}
        identityEmail={null}
        initialSignupToken={signupToken}
        resumed={resumed}
        signupEnabled={signupEnabled}
        inviteOnly={inviteOnly}
        phoneCountryCode={phoneCountryCode}
        contactEmail={contactEmail}
      />
    );
  }

  const dead = state === "expired" || state === "owns";
  return (
    <>
      <h1 className={TITLE_H1}>{t(first ? "signupResume.startTitle" : "signupResume.title")}</h1>
      <p className="mt-2 text-base text-ink-body">
        {state === "expired" ? t("signupResume.expired") : state === "owns" ? t("signupResume.owns") : t(first ? "signupResume.startBody" : "signupResume.body")}
      </p>
      {dead ? (
        <p className="mt-6">
          <Link href={state === "owns" ? "/?start=1" : "/welcome"} className={`text-base ${TEXT_LINK}`}>
            {state === "owns" ? t("signupResume.ownsAction") : t("signupResume.expiredAction")}
          </Link>
        </p>
      ) : (
        <div className="mt-6">
          <BusyButton
            busy={state === "working"}
            type="button"
            onClick={press}
            className="inline-flex min-h-12 items-center justify-center rounded-full bg-yellow-400 px-6 text-lg font-semibold text-yellow-950 transition-colors hover:bg-yellow-300 disabled:opacity-60"
            busyLabel={t("signupResume.working")}
          >
            {t(first ? "signupResume.startAction" : "signupResume.action")}
          </BusyButton>
          {state === "failed" && <p className="mt-4 text-base text-ink-body">{t("signupResume.failed")}</p>}
        </div>
      )}
    </>
  );
}
