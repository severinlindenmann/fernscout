"use client";

import { useState } from "react";
import { PRIMARY_BUTTON } from "@/components/LandingSections";
import { useI18n } from "@/components/LocaleProvider";
import { MAINTAINED_LOCALES } from "@/lib/i18n";

/** Same shape as `USERNAME_RE` in `lib/users.ts` — checked again here only so
 * a person sees why the button is disabled before they press it. The server
 * is what actually decides; this never has to be the last word. */
const USERNAME_RE = /^[a-z0-9][a-z0-9-]{1,30}$/;

type Step =
  | "email"
  | "code"
  | "journal"
  | "trip"
  | "signing-in";

/**
 * A brand-new visitor's whole way in, without leaving `/agent` — B688.
 *
 * Wraps the existing signup API rather than inventing a second one: every
 * step below is a `fetch` to a route `/agent.md` already documents —
 * `/api/auth/signup/request`, `/api/auth/signup/verify`, `/api/v1/journals`,
 * `/api/v1/<user>/trips` — called from the browser exactly as an external
 * agent would call them, with the tokens they hand back kept only in this
 * component's own state and never written to a cookie by this component
 * itself. The one exception is the last step: `POST /api/auth/link` spends
 * the same one-press relay link the welcome mail's button spends
 * (`components/SignInButton.tsx`), which is what turns "a journal now exists"
 * into "and you are looking at it" without a second trip through email.
 *
 * No day is written here. The point of this component is only to get a
 * person from nothing to a signed-in owner of an empty journal with one
 * trip — `onSignedIn` hands the username to the page, which sends them into
 * the wizard that already exists for writing the first day.
 */
export default function SignupWizard({
  email: prefillEmail,
  locale,
  codeMinutes,
  onSignedIn,
}: {
  /** Prefilled when the visitor already carries an identity cookie — they
   * proved this address once already, but a signup token still needs its
   * own fresh code (see the route's own reasoning). */
  email?: string;
  /** The reader's current UI language — offered as the journal's own
   * starting language, changeable before the journal is created. */
  locale: string;
  /** How long the code lasts, from `CODE_TTL_MINUTES` — passed rather than
   * imported, the same reason `IdentitySignIn` takes it as a prop. */
  codeMinutes: string;
  /** Called once the browser holds a session for the new journal. */
  onSignedIn: (username: string) => void;
}) {
  const { t } = useI18n();
  const [step, setStep] = useState<Step>("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [email, setEmail] = useState(prefillEmail ?? "");
  const [code, setCode] = useState("");
  const [signupToken, setSignupToken] = useState("");

  const [title, setTitle] = useState("");
  const [username, setUsername] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [ownerNickname, setOwnerNickname] = useState("");
  const [visibility, setVisibility] = useState<"public" | "guest">("public");
  const [defaultLocale] = useState(
    (MAINTAINED_LOCALES as readonly string[]).includes(locale) ? locale : "en",
  );

  const [agentToken, setAgentToken] = useState("");
  const [signInUrl, setSignInUrl] = useState("");
  const [journalUsername, setJournalUsername] = useState("");

  const [tripTitle, setTripTitle] = useState("");
  const [tripStart, setTripStart] = useState("");
  const [tripEnd, setTripEnd] = useState("");

  async function post(path: string, body: unknown, auth?: string): Promise<Record<string, unknown> | null> {
    const response = await fetch(path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(auth ? { authorization: `Bearer ${auth}` } : {}),
      },
      body: JSON.stringify(body),
    }).catch(() => null);
    const json = (await response?.json().catch(() => null)) as Record<string, unknown> | null;
    if (!response?.ok) {
      const message = typeof json?.message === "string" ? json.message : response?.statusText || "unknown";
      setError(t("agent.failed", { error: message }));
      return null;
    }
    return json;
  }

  async function requestCode(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    await fetch("/api/auth/signup/request", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    }).catch(() => null);
    setBusy(false);
    setStep("code");
  }

  async function verifyCode(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await post("/api/auth/signup/verify", { email, code });
    setBusy(false);
    if (!result) return;
    setSignupToken(result.token as string);
    setStep("journal");
  }

  async function createJournalStep(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await post(
      "/api/v1/journals",
      {
        title,
        username,
        ownerName,
        ownerNickname,
        visibility,
        defaultLocale,
        locales: [defaultLocale],
      },
      signupToken,
    );
    setBusy(false);
    if (!result) return;
    setAgentToken(result.token as string);
    setJournalUsername(result.user as string);
    setSignInUrl(typeof result.signIn === "string" ? result.signIn : "");
    setStep("trip");
  }

  async function createTripStep(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const tripId =
      `${tripTitle}-${tripStart.slice(0, 4)}`
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 60) || `trip-${tripStart.slice(0, 4)}`;
    const result = await post(
      `/api/v1/${encodeURIComponent(journalUsername)}/trips`,
      { id: tripId, title: tripTitle, start: tripStart, end: tripEnd },
      agentToken,
    );
    if (!result) {
      setBusy(false);
      return;
    }
    setStep("signing-in");
    // The one-press relay link, spent here rather than by a press — there is
    // nobody left to press it, the wizard already asked everything it needs
    // to. `signInUrl` is `${base}/${username}/s/${token}`; the token is
    // everything after the last "/s/".
    const linkToken = signInUrl.split("/s/").pop() ?? "";
    const signedIn = linkToken
      ? await post("/api/auth/link", { user: journalUsername, token: linkToken })
      : null;
    setBusy(false);
    if (!signedIn) {
      // The journal and its trip exist regardless; only the sign-in step
      // failed. Send them on anyway — the wizard page itself will 404 back to
      // a plain sentence if the cookie really did not take, rather than
      // stranding them here with a journal already made and no way forward.
      onSignedIn(journalUsername);
      return;
    }
    onSignedIn(journalUsername);
  }

  const label = "block font-mono text-[11px] uppercase tracking-[0.08em] text-navy-600";
  const field =
    "mt-4 min-h-11 rounded-xl border border-navy-300 bg-cream-50 px-4 py-2 " +
    "focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500";
  const input = "block w-full border-0 bg-transparent p-0 text-base text-navy-900 focus:outline-none focus:ring-0";

  return (
    <section className="rounded-2xl border border-navy-200 bg-cream-50 p-5 sm:p-6">
      <h2 className="font-display text-xl font-semibold text-navy-900">{t("agent.startTitle")}</h2>
      <p className="mt-2 text-base leading-7 text-navy-700">{t("agent.startIntro")}</p>

      {error && (
        <p role="alert" className="mt-4 text-base leading-7 text-coral-600">
          {error}
        </p>
      )}

      {step === "email" && (
        <form onSubmit={requestCode}>
          <div className={field}>
            <label className={label} htmlFor="signup-email">
              {t("me.signInEmail")}
            </label>
            <input
              id="signup-email"
              type="email"
              autoComplete="email"
              inputMode="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={input}
            />
          </div>
          <button type="submit" disabled={busy || email === ""} className={`mt-4 w-full ${PRIMARY_BUTTON} disabled:opacity-50`}>
            {busy ? t("me.signInSending") : t("me.signInSend")}
          </button>
        </form>
      )}

      {step === "code" && (
        <form onSubmit={verifyCode}>
          <p className="mt-2 text-base leading-7 text-navy-700">{t("agent.startCodeSent", { minutes: codeMinutes })}</p>
          <div className={field}>
            <label className={label} htmlFor="signup-code">
              {t("me.signInCode")}
            </label>
            <input
              id="signup-code"
              autoComplete="one-time-code"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              className={`${input} font-mono text-2xl tracking-[0.3em]`}
            />
          </div>
          <button type="submit" disabled={busy || code.length < 6} className={`mt-4 w-full ${PRIMARY_BUTTON} disabled:opacity-50`}>
            {busy ? t("me.signInSending") : t("agent.startVerify")}
          </button>
        </form>
      )}

      {step === "journal" && (
        <form onSubmit={createJournalStep}>
          <div className={field}>
            <label className={label} htmlFor="signup-title">
              {t("agent.journalNameLabel")}
            </label>
            <input
              id="signup-title"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={input}
            />
          </div>
          <div className={field}>
            <label className={label} htmlFor="signup-username">
              {t("agent.usernameLabel")}
            </label>
            <input
              id="signup-username"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase())}
              className={input}
            />
          </div>
          <p className="mt-2 text-sm leading-6 text-navy-600">{t("agent.usernameHint")}</p>
          <div className={field}>
            <label className={label} htmlFor="signup-owner-name">
              {t("agent.ownerNameLabel")}
            </label>
            <input
              id="signup-owner-name"
              required
              value={ownerName}
              onChange={(e) => setOwnerName(e.target.value)}
              className={input}
            />
          </div>
          <div className={field}>
            <label className={label} htmlFor="signup-owner-nickname">
              {t("agent.ownerNicknameLabel")}
            </label>
            <input
              id="signup-owner-nickname"
              required
              value={ownerNickname}
              onChange={(e) => setOwnerNickname(e.target.value)}
              className={input}
            />
          </div>

          <p className={`${label} mt-5`}>{t("agent.visibilityLabel")}</p>
          <div className="mt-2 space-y-2">
            {(["public", "guest"] as const).map((option) => (
              <label
                key={option}
                className="flex min-h-11 items-center gap-3 rounded-xl border border-navy-300 bg-cream-50 px-4 py-2 text-sm text-navy-800"
              >
                <input
                  type="radio"
                  name="signup-visibility"
                  value={option}
                  checked={visibility === option}
                  onChange={() => setVisibility(option)}
                />
                {t(option === "public" ? "agent.visibilityPublic" : "agent.visibilityGuest")}
              </label>
            ))}
          </div>

          <button
            type="submit"
            disabled={busy || !title || !USERNAME_RE.test(username) || !ownerName || !ownerNickname}
            className={`mt-5 w-full ${PRIMARY_BUTTON} disabled:opacity-50`}
          >
            {busy ? t("agent.creatingJournal") : t("agent.createJournal")}
          </button>
        </form>
      )}

      {step === "trip" && (
        <form onSubmit={createTripStep}>
          <h3 className="mt-4 font-display text-lg font-semibold text-navy-900">{t("agent.tripHeading")}</h3>
          <div className={field}>
            <label className={label} htmlFor="signup-trip-title">
              {t("agent.tripTitleLabel")}
            </label>
            <input
              id="signup-trip-title"
              required
              value={tripTitle}
              onChange={(e) => setTripTitle(e.target.value)}
              className={input}
            />
          </div>
          <div className={field}>
            <label className={label} htmlFor="signup-trip-start">
              {t("agent.tripStartLabel")}
            </label>
            <input
              id="signup-trip-start"
              type="date"
              required
              value={tripStart}
              onChange={(e) => setTripStart(e.target.value)}
              className={input}
            />
          </div>
          <div className={field}>
            <label className={label} htmlFor="signup-trip-end">
              {t("agent.tripEndLabel")}
            </label>
            <input
              id="signup-trip-end"
              type="date"
              required
              min={tripStart || undefined}
              value={tripEnd}
              onChange={(e) => setTripEnd(e.target.value)}
              className={input}
            />
          </div>
          <button
            type="submit"
            disabled={busy || !tripTitle || !tripStart || !tripEnd}
            className={`mt-5 w-full ${PRIMARY_BUTTON} disabled:opacity-50`}
          >
            {busy ? t("agent.creatingTrip") : t("agent.createTrip")}
          </button>
        </form>
      )}

      {step === "signing-in" && <p className="mt-4 text-base leading-7 text-navy-700">{t("agent.signingIn")}</p>}
    </section>
  );
}
