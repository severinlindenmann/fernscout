"use client";

import { useState } from "react";
import BusyButton from "@/components/BusyButton";
import { PRIMARY_BUTTON } from "@/components/LandingSections";
import { useI18n } from "@/components/LocaleProvider";
import { LOCALE_LABEL, MAINTAINED_LOCALES } from "@/lib/i18n";

/** Same shape as `USERNAME_RE` in `lib/users.ts` — checked again here only so
 * a person sees why the button is disabled before they press it. The server
 * is what actually decides; this never has to be the last word. */
const USERNAME_RE = /^[a-z0-9][a-z0-9-]{1,30}$/;

type Step = "email" | "code" | "journal" | "trip" | "signing-in";

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
 *
 * **This form is `/agent.md`'s onboarding script, drawn.** That script opens
 * "ask all of the questions below, in order, once, before your first call. Do
 * not start on a guess", and it is `firstQuestions()` in `lib/api/agentCopy.ts`
 * — one list, so the two doors cannot drift. Where they stand now:
 *
 * | The script asks | Here |
 * | --- | --- |
 * | email address | the first step |
 * | the journal's address (`username`) | asked, with the hint above the field, because it is permanent (B809) |
 * | what the journal is called (`title`) | asked |
 * | public or guest (`visibility`) | asked |
 * | their name and what the site calls them (`ownerName`, `ownerNickname`) | asked, as two labelled questions — never one inferred from the other (B809) |
 * | which language they write in (`defaultLocale`) | asked — until B838 it was read off the browser and never put |
 * | which languages a reader may switch into (`locales`) | asked — until B838 it was hardcoded to `[defaultLocale]`, which is B277 by construction |
 * | what they count money in (`baseCurrency`) | asked — B839 added it to both, since it is the one field nothing can change afterwards |
 *
 * Everything else `POST /api/v1/journals` accepts — `tagline`,
 * `startLocation`, `units`, `displayCurrencies` — is absent here on purpose:
 * each is correctable later at `PATCH /api/v1/<user>/config`, and a question
 * with a good default and a way back does not belong in front of somebody who
 * has not written a day yet.
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
  /** The browser's language is the *starting point* of the question, never
   * the answer to it — B838. A German speaker on a phone somebody else set
   * up in English is the exact person tested twice on this instance. */
  const [defaultLocale, setDefaultLocale] = useState(
    (MAINTAINED_LOCALES as readonly string[]).includes(locale) ? locale : "en",
  );
  /** The *extra* languages a reader may switch into — `defaultLocale` is
   * always sent as well and is not in here, so changing the answer above
   * cannot leave a journal whose own language is not on offer to its
   * readers (which `POST /api/v1/journals` refuses outright). */
  const [extraLocales, setExtraLocales] = useState<string[]>([]);
  /** Empty, required, and deliberately not guessed — B839. It is the one
   * field `setJournalProfile` refuses for ever after, so a value prefilled
   * from a language ("de" is Germany, Austria *and* Switzerland) would be a
   * permanent decision nobody was asked about. The examples are in the hint
   * and the datalist, where they are visible without being chosen. */
  const [baseCurrency, setBaseCurrency] = useState("");

  const [agentToken, setAgentToken] = useState("");
  const [signInUrl, setSignInUrl] = useState("");
  const [journalUsername, setJournalUsername] = useState("");

  const [tripTitle, setTripTitle] = useState("");
  const [tripStart, setTripStart] = useState("");
  const [tripEnd, setTripEnd] = useState("");

  async function post(
    path: string,
    body: unknown,
    auth?: string,
  ): Promise<Record<string, unknown> | null> {
    const response = await fetch(path, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(auth ? { authorization: `Bearer ${auth}` } : {}),
      },
      body: JSON.stringify(body),
    }).catch(() => null);
    const json = (await response?.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!response?.ok) {
      const message =
        typeof json?.message === "string"
          ? json.message
          : response?.statusText || "unknown";
      setError(t("agent.failed", { error: message }));
      return null;
    }
    return json;
  }

  async function requestCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Read what the field actually holds rather than trusting `email` to
    // have followed autofill — see IdentitySignIn's own `requestCode` (B787).
    const value = String(new FormData(event.currentTarget).get("email") ?? "");
    setEmail(value);
    setBusy(true);
    setError(null);
    await fetch("/api/auth/signup/request", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: value }),
    }).catch(() => null);
    setBusy(false);
    setStep("code");
  }

  async function verifyCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = String(new FormData(event.currentTarget).get("code") ?? "").replace(
      /\D/g,
      "",
    );
    setCode(value);
    setBusy(true);
    setError(null);
    const result = await post("/api/auth/signup/verify", { email, code: value });
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
        locales: [defaultLocale, ...extraLocales],
        baseCurrency,
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
      ? await post("/api/auth/link", {
          user: journalUsername,
          token: linkToken,
        })
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

  const label =
    "block font-mono text-[11px] uppercase tracking-[0.08em] text-navy-600";
  const field =
    "mt-4 min-h-11 rounded-xl border border-navy-300 bg-cream-50 px-4 py-2 " +
    "focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500";
  const input =
    "block w-full border-0 bg-transparent p-0 text-base text-navy-900 focus:outline-none focus:ring-0";

  return (
    <section className="rounded-2xl border border-navy-200 bg-cream-50 p-5 sm:p-6">
      <h2 className="font-display text-xl font-semibold text-navy-900">
        {t("agent.startTitle")}
      </h2>
      <p className="mt-2 text-base leading-7 text-navy-700">
        {t("agent.startIntro")}
      </p>

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
              name="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={input}
            />
          </div>
          {/* No `disabled={email === ""}` — B787. Autofill can set the field
              without firing `onChange`, leaving that state stale; `required`
              above is what refuses a genuinely empty submit, natively. */}
          <BusyButton
            busy={busy}
            type="submit"
            className={`mt-4 w-full ${PRIMARY_BUTTON} disabled:opacity-50`}
            busyLabel={t("me.signInSending")}
          >
            {t("me.signInSend")}
          </BusyButton>
        </form>
      )}

      {step === "code" && (
        <form onSubmit={verifyCode}>
          <p className="mt-2 text-base leading-7 text-navy-700">
            {t("agent.startCodeSent", { minutes: codeMinutes })}
          </p>
          <div className={field}>
            <label className={label} htmlFor="signup-code">
              {t("me.signInCode")}
            </label>
            <input
              id="signup-code"
              name="code"
              autoComplete="one-time-code"
              inputMode="numeric"
              pattern="[0-9]*"
              // `minLength` makes "fewer than 6 digits" a submit the browser
              // itself refuses (B787), rather than one gated on React state
              // that autofill or a code-filling keyboard can bypass.
              minLength={6}
              maxLength={6}
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              className={`${input} font-mono text-2xl tracking-[0.3em]`}
            />
          </div>
          <BusyButton
            busy={busy}
            type="submit"
            className={`mt-4 w-full ${PRIMARY_BUTTON} disabled:opacity-50`}
            busyLabel={t("me.signInSending")}
          >
            {t("agent.startVerify")}
          </BusyButton>
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
          {/* B809 — above the field, not below it. A tester chose an address
              and only then read that it was going to be a web address, which
              is the one thing here that cannot be corrected afterwards. */}
          <p className="mt-4 text-sm leading-6 text-navy-600">
            {t("agent.usernameHint")}
          </p>
          <div className={`${field} mt-2`}>
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
          {/* B809 — two name fields a tester could not tell apart, so he put
              "Kevin" in both. They are genuinely two things: `owner.name` is
              the byline on a trip, `owner.nickname` is what the site says in
              a sentence. `/agent.md` is emphatic that both are asked and
              neither is inferred from the other, so the answer is to say
              what each is for rather than to collapse them. */}
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
          <p className="mt-2 text-sm leading-6 text-navy-600">
            {t("agent.ownerNameHint")}
          </p>
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
          <p className="mt-2 text-sm leading-6 text-navy-600">
            {t("agent.ownerNicknameHint")}
          </p>

          {/* B838, first half — which language the owner writes in. It was
              read off the browser and never asked, so a German speaker whose
              phone is in English got an English journal. */}
          <p className={`${label} mt-5`}>{t("agent.localeLabel")}</p>
          <p className="mt-2 text-sm leading-6 text-navy-600">
            {t("agent.localeHint")}
          </p>
          <div className="mt-2 space-y-2">
            {MAINTAINED_LOCALES.map((code) => (
              <label
                key={code}
                className="flex min-h-11 items-center gap-3 rounded-xl border border-navy-300 bg-cream-50 px-4 py-2 text-sm text-navy-800"
              >
                <input
                  type="radio"
                  name="signup-locale"
                  value={code}
                  checked={defaultLocale === code}
                  onChange={() => {
                    setDefaultLocale(code);
                    // Whatever the new one is, it is no longer an *extra*.
                    setExtraLocales((prev) => prev.filter((c) => c !== code));
                  }}
                />
                {LOCALE_LABEL[code] ?? code}
              </label>
            ))}
          </div>

          {/* B838, second half — the different question, and the one that
              was hardcoded to `[defaultLocale]`, which is B277 reproduced by
              construction: a journal with no switcher and no page to add one
              from. The hint says what a second language commits somebody to
              (B294), because it is a promise to write everything twice. */}
          <p className={`${label} mt-5`}>{t("agent.readerLocalesLabel")}</p>
          <p className="mt-2 text-sm leading-6 text-navy-600">
            {t("agent.readerLocalesHint")}
          </p>
          <div className="mt-2 space-y-2">
            {MAINTAINED_LOCALES.filter((code) => code !== defaultLocale).map(
              (code) => (
                <label
                  key={code}
                  className="flex min-h-11 items-center gap-3 rounded-xl border border-navy-300 bg-cream-50 px-4 py-2 text-sm text-navy-800"
                >
                  <input
                    type="checkbox"
                    name="signup-reader-locales"
                    value={code}
                    checked={extraLocales.includes(code)}
                    onChange={(e) =>
                      setExtraLocales((prev) =>
                        e.target.checked
                          ? [...prev, code]
                          : prev.filter((c) => c !== code),
                      )
                    }
                  />
                  {LOCALE_LABEL[code] ?? code}
                </label>
              ),
            )}
          </div>

          {/* B839 — the one permanent field, asked at the one moment it can
              still be answered. `setJournalProfile` refuses it for ever
              after, on purpose: every cost in the journal is denominated
              against it. */}
          <p className="mt-5 text-sm leading-6 text-navy-600">
            {t("agent.currencyHint")}
          </p>
          <div className={`${field} mt-2`}>
            <label className={label} htmlFor="signup-currency">
              {t("agent.currencyLabel")}
            </label>
            <input
              id="signup-currency"
              required
              maxLength={3}
              // Native, so a phone offers the right keyboard and the browser
              // says why the button will not go — the server checks it too.
              pattern="[A-Za-z]{3}"
              autoComplete="off"
              list="signup-currency-codes"
              value={baseCurrency}
              onChange={(e) => setBaseCurrency(e.target.value.toUpperCase())}
              className={input}
            />
          </div>
          <datalist id="signup-currency-codes">
            {["EUR", "CHF", "HUF", "GBP", "USD"].map((code) => (
              <option key={code} value={code} />
            ))}
          </datalist>

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
                {t(
                  option === "public"
                    ? "agent.visibilityPublic"
                    : "agent.visibilityGuest",
                )}
              </label>
            ))}
          </div>

          <BusyButton
            busy={busy}
            type="submit"
            disabled={
              busy ||
              !title ||
              !USERNAME_RE.test(username) ||
              !ownerName ||
              !ownerNickname ||
              !/^[A-Z]{3}$/.test(baseCurrency)
            }
            className={`mt-5 w-full ${PRIMARY_BUTTON} disabled:opacity-50`}
            busyLabel={t("agent.creatingJournal")}
          >
            {t("agent.createJournal")}
          </BusyButton>
        </form>
      )}

      {step === "trip" && (
        <form onSubmit={createTripStep}>
          <h3 className="mt-4 font-display text-lg font-semibold text-navy-900">
            {t("agent.tripHeading")}
          </h3>
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
          <BusyButton
            busy={busy}
            type="submit"
            disabled={!tripTitle || !tripStart || !tripEnd}
            className={`mt-5 w-full ${PRIMARY_BUTTON} disabled:opacity-50`}
            busyLabel={t("agent.creatingTrip")}
          >
            {t("agent.createTrip")}
          </BusyButton>
        </form>
      )}

      {step === "signing-in" && (
        <p className="mt-4 text-base leading-7 text-navy-700">
          {t("agent.signingIn")}
        </p>
      )}
    </section>
  );
}
