"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import BusyButton from "@/components/BusyButton";
import CodeWaitPanel from "@/components/CodeWaitPanel";
// B2531: the kit's yellow pill; the square button is retired.
import { PILL_GHOST, PILL_PRIMARY } from "@/components/landing/styles";
import { useI18n } from "@/components/LocaleProvider";
import TelField from "@/components/TelField";
import { LOCALE_LABEL, MAINTAINED_LOCALES, type TranslationKey } from "@/lib/i18n";
import { LOCALE_COOKIE } from "@/lib/requestKeys";
import { journalPath, suggestionsFor, usernameFrom, USERNAME_RE } from "@/lib/journalPath";
import { CURRENCY_FOR_COUNTRY } from "@/lib/countryCurrency";
import { regionDefaults } from "@/lib/regionDefaults";

/** `window.location.host` never changes under a mounted page. */
const noSubscription = () => () => {};

/**
 * Every refusal `post()` can actually get back from the signup routes, and
 * the sentence it gets — B1247/B1250, the same shape as `HelperAsk.tsx`'s
 * `NAMED_FAILURES`. The eight are every `createJournal()` refusal
 * (`lib/journals.ts`) a person's own input can trigger; `invalid_token` and
 * `missing_token` are the two ways `/api/v2/journals` and the phone-request
 * route refuse a signup token that has expired or was already spent —
 * neither of which reads as a sentence when shown raw, since both name an
 * HTTP endpoint. `phone_required` is not here: `createJournal()` branches on
 * it before `post()`'s fallback is ever reached, and it must stay there.
 */
const SIGNUP_FAILURES = [
  "invalid_username",
  "deleted_username",
  "reserved_username",
  "username_taken",
  "invalid_title",
  "invalid_owner",
  "too_many_journals",
  "tel_taken",
  "invalid_token",
  "missing_token",
  // B1693. An invite-only instance refuses an address nobody named, at the
  // very first step; without this the wizard would show its generic
  // "something went wrong" for the one refusal a person can actually act on.
  "signup_not_invited",
] as const;

/** The same cookie `LocaleSwitcher` writes, at module level for the same
 *  reason it is there: the linter is right that a component body should not
 *  be assigning to `document.cookie` directly. */
function rememberLocale(code: string) {
  const year = 60 * 60 * 24 * 365;
  document.cookie = `${LOCALE_COOKIE}=${code}; path=/; max-age=${year}; samesite=lax`;
}

/** B-2824. What the phone request route refuses with (400 `invalid_request`
 * is its bad-number answer) and the sentence each one gets. */
const PHONE_FAILURES: Record<string, TranslationKey> = {
  invalid_request: "agent.error.invalid_tel",
  sms_unreachable: "agent.error.sms_unreachable",
  verification_failed: "agent.error.phone_code_failed",
  too_many_requests: "agent.error.phone_too_many",
};

/** The refusals of the address itself — B2778. */
const ADDRESS_REFUSALS = ["invalid_username", "deleted_username", "reserved_username", "username_taken"];

type Step =
  | "email"
  | "code"
  | "owns"
  | "phone"
  | "phone-code"
  | "phone-wa"
  | "name"
  | "signing-in";

/** The browser keeps the name-step fields for this tab only — a reload lands
 *  back on the unfinished step with what was typed (B-2808). */
const DRAFT_KEY = "fs-signup-draft";
type Draft = {
  name?: string;
  addressEdited?: boolean;
  addressInput?: string;
  titleOverride?: string | null;
  listed?: boolean;
  currencyPick?: string | null;
  defaultLocale?: string;
};
function loadDraft(): Draft {
  try {
    return JSON.parse(sessionStorage.getItem(DRAFT_KEY) ?? "{}") as Draft;
  } catch {
    return {};
  }
}
function saveDraft(draft: Draft | null) {
  try {
    if (draft) sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    else sessionStorage.removeItem(DRAFT_KEY);
  } catch {
    // Private mode or blocked storage: the form simply is not remembered.
  }
}

const COMMON_CURRENCIES = ["CHF", "EUR", "USD", "HUF"];
const ALL_CURRENCIES = [...new Set(Object.values(CURRENCY_FOR_COUNTRY))].sort();
const RESEND_SECONDS = 30;

const subscribeNothing = () => () => {};
const browserLanguages = () => (typeof navigator === "undefined" ? "" : [...(navigator.languages ?? [navigator.language])].join(","));

/** Asks the open availability route; `ok: null` means "could not tell" — the
 *  server's create call decides then. */
async function checkAddress(username: string): Promise<{ ok: boolean | null; reason?: string }> {
  try {
    const response = await fetch(`/api/v2/journals/available?username=${encodeURIComponent(username)}`);
    const json = (await response.json()) as { available?: boolean; reason?: string };
    if (!response.ok || typeof json.available !== "boolean") return { ok: null };
    return { ok: json.available, reason: json.reason };
  } catch {
    return { ok: null };
  }
}

function clock(seconds: number) {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * A brand-new visitor's whole way in — B688, mounted at `/welcome` since
 * B2170 (it used to live on `/agent`, which is being retired).
 *
 * Wraps the existing signup API rather than inventing a second one: every
 * step below is a `fetch` to a route `/agent.md` already documents —
 * `POST /api/auth/codes` and `/codes/redeem` (both `for: "signup"`) and
 * `/api/v2/journals` — called from the browser
 * exactly as an external agent would call them, with the tokens they hand
 * back kept only in this component's own state and never written to a cookie
 * by this component itself. The one exception is the last step:
 * `POST /api/auth/links/redeem` (`for: "read"`) spends the same one-press
 * relay link the welcome mail's button spends
 * (`components/SignInButton.tsx`), which is what turns "a journal now exists"
 * into "and you are looking at it" without a second trip through email.
 *
 * No trip and no day is written here — B2170. The point of this component is
 * only to get a person from nothing to a signed-in owner of an empty journal;
 * `onSignedIn` hands the username to the page, which sends them to their
 * studio, whose "A new trip" makes the first trip. The trip step this wizard
 * used to carry (B1674) was a second copy of that flow.
 *
 * **This form is `/agent.md`'s onboarding script, drawn.** That script opens
 * "ask all of the questions below, in order, once, before your first call. Do
 * not start on a guess", and it is `firstQuestions()` in `lib/api/agentCopy.ts`
 * — one list, so the two doors cannot drift. Where they stand now:
 *
 * | The script asks | Here |
 * | --- | --- |
 * | email address | the first step |
 * | (the phone proof) | the second step, right after the address is proven — WhatsApp first, SMS behind it (B-2808) |
 * | their name (`ownerName`, `ownerNickname`) and the journal's title (`title`) | ONE field, "Your name", sent as all three. The owner's decision, overriding B809's two fields for the browser door only — the API still takes them separately, and the title is editable in the advanced settings |
 * | the journal's address (`username`) | suggested from the name with `usernameFrom`, checked live against `/api/v2/journals/available`, permanent (B809) |
 * | public or guest (`visibility`) | a default sent explicitly: guest, "List my journal in search engines" off in the advanced settings turns public on (`me.journalListed`) |
 * | which language they write in (`defaultLocale`) | the browser's (B838), shown on the summary card and editable in the advanced settings |
 * | which languages a reader may switch into (`locales`) | `[defaultLocale]` — one more is a promise to write every day twice (B294), made on the journal itself later |
 * | what they count money in (`baseCurrency`) | the browser region's (B-2807), never guessed from a language alone: with no region the card says "Choose" and Create stays disabled |
 *
* Everything else `POST /api/v2/journals` accepts — `tagline`,
 * `startLocation`, `units`, `displayCurrencies` — is absent here on purpose:
 * each is correctable later at `PATCH /api/v2/<user>`, and a question
 * with a good default and a way back does not belong in front of somebody who
 * has not written a day yet.
 */
export default function SignupWizard({
  email: prefillEmail,
  resume,
  initialSignupToken,
  initialResumed,
  locale,
  codeMinutes,
  onSignedIn,
  onAlreadyOwns,
  phoneCountryCode,
  contactEmail,
  inviteOnly,
  inviteRequest,
}: {
  /** Prefilled when the visitor already carries an identity cookie — they
   * proved this address once already, so while the field still holds it the
   * email step trades the cookie for a signup token instead of mailing a
   * second code (B2522, `POST /api/auth/signup/identity`). Editing the field
   * is the "not me" path: a different address gets the ordinary code. */
  email?: string;
  /** B2804 — this address already proved itself and left a signup open
   * (`getPendingSignup`, read server-side from the identity cookie). On mount
   * the wizard trades the cookie for a signup token and jumps to the step
   * that is still open. */
  resume?: boolean;
  /** B2781 — a signup token the press page `/welcome/r/<token>` already
   * minted from the code mail's button; the wizard jumps to the open step. */
  initialSignupToken?: string;
  /** B-2827: whether `initialSignupToken` resumed a signup that really stopped
   * earlier (the "Welcome back" line); unset counts as yes. */
  initialResumed?: boolean;
  /** The reader's current UI language — offered as the journal's own
   * starting language, changeable before the journal is created. */
  locale: string;
  /** How long the code lasts, from `CODE_TTL_MINUTES`. */
  codeMinutes: string;
  /** Called once the browser holds a session for the new journal. */
  onSignedIn: (username: string, signedIn: boolean) => void;
  /** Called when the verified address turns out to already own a journal —
   * B1568. The door swaps this wizard for its sign-in form. */
  onAlreadyOwns: () => void;
  /** B2357 — `whatsappCountryCode()`, this instance's own dialling
   *  convention: the SMS country box's fallback when the browser names no
   *  region (B-2807). Absent prefills nothing. */
  phoneCountryCode?: string | null;
  /** `serverSite().operatorEmail` — B2357. */
  contactEmail?: string | null;
  /** B-2780 — invite-only server: the code request answers alike for every address. */
  inviteOnly?: boolean;
  /** B-2773 — `/invite` exists: the email step links it. */
  inviteRequest?: boolean;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const [step, setStep] = useState<Step>("email");
  const [ownedUser, setOwnedUser] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [telTaken, setTelTaken] = useState(false);

  const [email, setEmail] = useState(prefillEmail ?? "");
  const host = useSyncExternalStore(noSubscription, () => window.location.host, () => "");
  const languages = useSyncExternalStore(subscribeNothing, browserLanguages, () => "");
  const defaults = useMemo(() => regionDefaults(languages ? languages.split(",") : []), [languages]);
  const proven = Boolean(prefillEmail) && email.trim().toLowerCase() === prefillEmail!.toLowerCase();
  const [code, setCode] = useState("");
  const [signupToken, setSignupToken] = useState(initialSignupToken ?? "");
  /** Resend countdown: when it ends, and a ticking clock to compare with. */
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(0);

  // The name step. Fields come back from this tab's draft after a reload.
  const [draft] = useState<Draft>(() => (typeof window === "undefined" ? {} : loadDraft()));
  const [name, setName] = useState(draft.name ?? "");
  const [addressEdited, setAddressEdited] = useState(draft.addressEdited ?? false);
  const [addressInput, setAddressInput] = useState(draft.addressInput ?? "");
  const [titleOverride, setTitleOverride] = useState<string | null>(draft.titleOverride ?? null);
  const [listed, setListed] = useState(draft.listed ?? false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [otherCurrency, setOtherCurrency] = useState(false);
  /** The browser's language is the *starting point* of the question, never
   * the answer to it — B838. */
  const [defaultLocale, setDefaultLocale] = useState(
    draft.defaultLocale ?? ((MAINTAINED_LOCALES as readonly string[]).includes(locale) ? locale : "en"),
  );
  /** `null` = the person has not picked, so the browser region's currency (if
   *  it names one) stands. Never guessed from a language alone — B839. */
  const [currencyPick, setCurrencyPick] = useState<string | null>(draft.currencyPick ?? null);
  const currency = currencyPick ?? defaults.currency ?? "";

  const suggested = usernameFrom(name);
  const username = addressEdited ? addressInput : suggested;
  const title = titleOverride ?? name;

  // The phone step.
  const [telPick, setTelPick] = useState<string | null>(null);
  const [telNational, setTelNational] = useState("");
  // B-2825: the country, not just its dial code, so a +44 region shows the
  // United Kingdom and a +1 one the country the person picked.
  const [telIso, setTelIso] = useState<string | undefined>(undefined);
  const telCc = telPick ?? defaults.cc ?? phoneCountryCode ?? "";
  const [phoneId, setPhoneId] = useState("");
  const [phoneCode, setPhoneCode] = useState("");
  const [waLink, setWaLink] = useState("");
  const [waOpened, setWaOpened] = useState(false);
  const [waExpired, setWaExpired] = useState(false);
  const [waChecking, setWaChecking] = useState(false);
  const [smsFallback, setSmsFallback] = useState(false);
  const [smsChannel, setSmsChannel] = useState(false);
  const [mode, setMode] = useState<string>("code");
  const [welcomeBack, setWelcomeBack] = useState(false);
  const pollRef = useRef<(() => Promise<void>) | null>(null);

  function chooseLanguage(next: string) {
    setDefaultLocale(next);
    rememberLocale(next);
    router.refresh();
  }

  async function post(
    path: string,
    body: unknown,
    auth?: string,
    /** Error codes the caller wants to branch on rather than show — the
     * result then carries `error` and the caller decides (B1222). */
    passthrough?: string[],
  ): Promise<Record<string, unknown> | null> {
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
      if (typeof json?.error === "string" && passthrough?.includes(json.error)) {
        return json;
      }
      // B-2808: a number that already keeps a journal is a way forward (sign
      // in to it), not an error line.
      if (json?.error === "tel_taken") {
        setTelTaken(true);
        return null;
      }
      // A known cause gets its own sentence, in the reader's own language —
      // never the API's own machine-facing message (B1250).
      if (typeof json?.error === "string" && (SIGNUP_FAILURES as readonly string[]).includes(json.error)) {
        setError(t(`agent.error.${json.error}` as TranslationKey));
        return null;
      }
      // B-2824: the phone routes' own refusals, each with its own sentence.
      if (path.startsWith("/api/auth/signup/phone") && typeof json?.error === "string") {
        const phoneKey = PHONE_FAILURES[json.error];
        if (phoneKey) {
          setError(t(phoneKey));
          return null;
        }
      }
      setError(t("agent.signupFailed"));
      return null;
    }
    return json;
  }

  /**
   * With a signup token in hand, ask where the signup stands and go to the
   * step still open (B2804). The phone comes right after the address (B-2808):
   * a proven number, or an instance that does not ask for one, goes straight
   * to the name. Anything unexpected falls back to the name step — a create
   * that then answers `phone_required` still finds its way to the phone.
   */
  async function continueFrom(token: string, resumed: boolean) {
    const response = await fetch("/api/auth/signup/state", {
      headers: { authorization: `Bearer ${token}` },
    }).catch(() => null);
    const state = (await response?.json().catch(() => null)) as Record<string, unknown> | null;
    setWelcomeBack(resumed);
    if (!response?.ok || !state) {
      setStep("name");
      return;
    }
    if (state.smsFallback === true) setSmsFallback(true);
    if (typeof state.mode === "string") setMode(state.mode);
    if (state.phoneProven === true || state.phoneRequired === false) {
      setStep("name");
    } else if (state.mode === "whatsapp-inbound") {
      await requestWaLink(token);
    } else {
      setStep("phone");
    }
  }

  useEffect(() => {
    if (!initialSignupToken) return;
    let cancelled = false;
    (async () => {
      await Promise.resolve();
      if (!cancelled) await continueFrom(initialSignupToken, initialResumed ?? true);
    })();
    return () => {
      cancelled = true;
    };
    // Once, on mount, like the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!resume || !prefillEmail) return;
    let cancelled = false;
    (async () => {
      const response = await fetch("/api/auth/signup/identity", { method: "POST" }).catch(() => null);
      const json = (await response?.json().catch(() => null)) as Record<string, unknown> | null;
      if (cancelled || !response?.ok || typeof json?.token !== "string") return;
      setSignupToken(json.token);
      await continueFrom(json.token, true);
    })();
    return () => {
      cancelled = true;
    };
    // Once, on mount: the prop is a server-side fact about this page load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // One clock for both resend countdowns.
  useEffect(() => {
    if (step !== "code" && step !== "phone-code") return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [step]);
  const resendLeft = Math.max(0, Math.ceil((resendAt - now) / 1000));
  function startCountdown() {
    const stamp = Date.now();
    setNow(stamp);
    setResendAt(stamp + RESEND_SECONDS * 1000);
  }

  /** Asks for a code; says why in words when it cannot (B2774). `true` only
   *  for the uniform 202. */
  async function sendCode(value: string): Promise<boolean> {
    const response = await fetch("/api/auth/codes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ for: "signup", email: value }),
    }).catch(() => null);
    if (response && response.status !== 202 && !response.ok) {
      const json = (await response.json().catch(() => null)) as { error?: string } | null;
      if (response.status === 403 && json?.error === "signup_not_invited") {
        setError(t("agent.error.signup_not_invited"));
      } else if (response.status === 429) {
        const seconds = Number(response.headers.get("retry-after"));
        setError(
          seconds > 0
            ? t("agent.error.too_many_requests_wait", { minutes: String(Math.ceil(seconds / 60)) })
            : t("agent.error.too_many_requests"),
        );
      } else if (response.status === 503) {
        setError(t("agent.error.mail_unavailable"));
      } else if (response.status === 404) {
        setError(t("agent.error.signup_disabled"));
      } else {
        setError(t("agent.signupFailed"));
      }
      return false;
    }
    if (!response) {
      setError(t("agent.signupFailed"));
      return false;
    }
    return true;
  }

  async function requestCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Read what the field actually holds rather than trusting `email` to
    // have followed autofill — see IdentitySignIn's own `requestCode` (B787).
    const value = String(new FormData(event.currentTarget).get("email") ?? "");
    setEmail(value);
    setBusy(true);
    setError(null);
    if (prefillEmail && value.trim().toLowerCase() === prefillEmail.toLowerCase()) {
      const result = await post("/api/auth/signup/identity", {}, undefined, ["too_many_journals", "not_signed_in"]);
      if (!result) {
        setBusy(false);
        return;
      }
      if (result.error === "too_many_journals") {
        setBusy(false);
        setStep("owns");
        return;
      }
      if (typeof result.token === "string") {
        setBusy(false);
        setSignupToken(result.token);
        await continueFrom(result.token, false);
        return;
      }
      // `not_signed_in`: the cookie lapsed, or it names a phone number.
      // The ordinary code below still works for the address typed.
    }
    const sent = await sendCode(value);
    setBusy(false);
    if (!sent) return;
    setCode("");
    startCountdown();
    setStep("code");
  }

  async function resendEmailCode() {
    setError(null);
    if (await sendCode(email)) startCountdown();
  }

  async function verifyCode(digits: string) {
    setBusy(true);
    setError(null);
    const result = await post(
      "/api/auth/codes/redeem",
      { for: "signup", email, code: digits },
      undefined,
      ["too_many_journals", "invalid_code"],
    );
    setBusy(false);
    if (!result) return;
    if (result.error === "invalid_code") {
      setError(t("signupPage.codeWrong"));
      setCode("");
      return;
    }
    // The address is proven and already owns a journal — B1568.
    if (result.error === "too_many_journals") {
      // B-2811: the 409 carries this address's own journal and the identity
      // cookie, so the studio opens without a second code.
      const user = (result.details as { user?: unknown } | undefined)?.user;
      if (typeof user === "string") setOwnedUser(user);
      setStep("owns");
      return;
    }
    setSignupToken(result.token as string);
    await continueFrom(result.token as string, false);
  }

  async function createJournal() {
    setBusy(true);
    setError(null);
    const result = await post(
      "/api/v2/journals",
      {
        // One name field: the byline, what the site calls them and the
        // journal's title start as the same words (B-2808).
        title: title.trim(),
        username,
        ownerName: name.trim(),
        ownerNickname: name.trim(),
        visibility: listed ? "public" : "guest",
        defaultLocale,
        locales: [defaultLocale],
        baseCurrency: currency,
      },
      signupToken,
      ["phone_required", ...ADDRESS_REFUSALS],
    );
    setBusy(false);
    if (!result) return;
    // The address was refused after all (a race, or the live check could not
    // answer). The name stays; the message sits at the address field.
    if (typeof result.error === "string" && ADDRESS_REFUSALS.includes(result.error)) {
      setError(t(`agent.error.${result.error}` as TranslationKey));
      setAddressEdited(true);
      setAddressInput(username);
      setStep("name");
      return;
    }
    // Unreachable on an instance that asks for the phone up front, but kept:
    // an exempt state that changed mid-signup still ends on the phone step.
    if (result.error === "phone_required") {
      setSmsFallback(result.smsFallback === true);
      if (typeof result.mode === "string") setMode(result.mode);
      if (result.mode === "whatsapp-inbound") await requestWaLink();
      else setStep("phone");
      return;
    }
    // The agent token in `result.token` is deliberately not kept (B2170).
    saveDraft(null);
    const user = result.user as string;
    setStep("signing-in");
    setBusy(true);
    // The one-press relay link, spent here rather than by a press (B2170): the
    // token is the path after the last "/s/", without the query.
    const signIn = typeof result.signIn === "string" ? result.signIn : "";
    const linkToken = signIn ? (new URL(signIn, window.location.href).pathname.split("/s/").pop() ?? "") : "";
    const redeemed = linkToken
      ? await fetch("/api/auth/links/redeem", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ user, token: linkToken, for: "read" }),
        }).catch(() => null)
      : null;
    setBusy(false);
    onSignedIn(user, redeemed?.ok === true);
  }

  async function requestWaLink(token = signupToken) {
    setBusy(true);
    setError(null);
    setWaExpired(false);
    setWaOpened(false);
    const result = await post("/api/auth/signup/phone", {}, token);
    setBusy(false);
    if (!result) return;
    setPhoneId(result.id as string);
    setWaLink(typeof result.link === "string" ? result.link : "");
    if (result.smsFallback === true) setSmsFallback(true);
    setMode("whatsapp-inbound");
    setStep("phone-wa");
  }

  /**
   * The poll — every few seconds while the WhatsApp step shows, at once when
   * "Check again" is pressed, and again whenever the tab comes back to the
   * front (a phone that went to WhatsApp and returned). `ok` moves on to the
   * name, `expired` offers a fresh link.
   */
  useEffect(() => {
    if (step !== "phone-wa" || !phoneId || waExpired) return;
    let done = false;
    let running = false;
    const tick = async () => {
      if (done || running) return;
      running = true;
      setWaChecking(true);
      const response = await fetch("/api/auth/signup/phone/redeem", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${signupToken}`,
        },
        body: JSON.stringify({ id: phoneId }),
      }).catch(() => null);
      const json = (await response?.json().catch(() => null)) as Record<string, unknown> | null;
      running = false;
      setWaChecking(false);
      if (done || !json) return;
      if (json.ok) {
        done = true;
        setStep("name");
      } else if (json.error === "tel_taken") {
        done = true;
        setTelTaken(true);
        setWaExpired(true);
      } else if (json.status === "expired") {
        setWaExpired(true);
      }
    };
    pollRef.current = tick;
    const timer = setInterval(tick, 2500);
    const back = () => {
      if (document.visibilityState === "visible") void tick();
    };
    document.addEventListener("visibilitychange", back);
    window.addEventListener("focus", back);
    return () => {
      done = true;
      pollRef.current = null;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", back);
      window.removeEventListener("focus", back);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, phoneId, waExpired]);

  async function sendPhoneCode(event?: React.FormEvent) {
    event?.preventDefault();
    setBusy(true);
    setError(null);
    const result = await post(
      "/api/auth/signup/phone",
      // `channel: "sms"` only when the person chose the fallback — in every
      // code mode the server's configured backend decides the delivery.
      smsChannel ? { tel: `+${telCc} ${telNational}`, channel: "sms" } : { tel: `+${telCc} ${telNational}` },
      signupToken,
    );
    setBusy(false);
    if (!result) return;
    setPhoneId(result.id as string);
    setPhoneCode("");
    startCountdown();
    setStep("phone-code");
  }

  async function verifyPhoneCode(digits: string) {
    setBusy(true);
    setError(null);
    const result = await post(
      "/api/auth/signup/phone/redeem",
      { id: phoneId, code: digits },
      signupToken,
      ["invalid_code"],
    );
    setBusy(false);
    if (!result) return;
    if (result.error === "invalid_code") {
      setError(t("agent.phoneWrong"));
      setPhoneCode("");
      return;
    }
    // The number is proven and attached to the signup token.
    setStep("name");
  }

  // The name step's live address check, debounced, and — for a taken name —
  // each suggestion checked before it is shown.
  const [avail, setAvail] = useState<{ name: string; ok: boolean | null; reason?: string } | null>(null);
  const [chips, setChips] = useState<{ name: string; list: string[] }>({ name: "", list: [] });
  useEffect(() => {
    if (step !== "name" || !USERNAME_RE.test(username)) return;
    let stale = false;
    const timer = setTimeout(async () => {
      const result = await checkAddress(username);
      if (!stale) setAvail({ name: username, ...result });
    }, 350);
    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [step, username]);
  const status: "empty" | "invalid" | "checking" | "ok" | "taken" | "unknown" =
    username === ""
      ? "empty"
      : !USERNAME_RE.test(username) || (avail?.name === username && avail.reason === "invalid_username")
        ? "invalid"
        : avail?.name !== username
          ? "checking"
          : avail.ok === true
            ? "ok"
            : avail.ok === false
              ? "taken"
              : "unknown";
  const isTaken = status === "taken";
  useEffect(() => {
    if (step !== "name" || !isTaken) return;
    let stale = false;
    (async () => {
      const candidates = suggestionsFor(name).filter((c) => c !== username);
      const checked = await Promise.all(candidates.map(async (c) => ((await checkAddress(c)).ok === true ? c : null)));
      if (!stale) setChips({ name, list: checked.filter((c): c is string => c !== null) });
    })();
    return () => {
      stale = true;
    };
    // The suggestions come from the typed name only; the taken address is
    // just the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, isTaken, name]);

  useEffect(() => {
    if (step === "name") saveDraft({ name, addressEdited, addressInput, titleOverride, listed, currencyPick, defaultLocale });
  }, [step, name, addressEdited, addressInput, titleOverride, listed, currencyPick, defaultLocale]);

  const label =
    "block font-mono text-[11px] uppercase tracking-[0.08em] text-ink-secondary";
  const field =
    "mt-4 min-h-11 rounded-xl border border-line-strong bg-surface-base px-4 py-2 " +
    "focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-500";
  const input =
    "block w-full border-0 bg-transparent p-0 text-base text-ink-strong focus:outline-none focus:ring-0";
  const quietLink = "min-h-11 text-base text-ink-secondary underline underline-offset-4";
  const select =
    "mt-1 block min-h-11 w-full rounded-xl border border-line-strong bg-surface-base px-3 py-2 text-base text-ink-strong";

  /** One six-digit box: paste works, and the sixth digit submits. */
  function codeBox(id: string, value: string, setValue: (v: string) => void, submit: (digits: string) => void) {
    return (
      <div className={field}>
        <label className={label} htmlFor={id}>
          {t("me.signInCode")}
        </label>
        <input
          id={id}
          name="code"
          autoComplete="one-time-code"
          inputMode="numeric"
          pattern="[0-9]*"
          required
          disabled={busy}
          value={value}
          onChange={(e) => {
            const digits = e.target.value.replace(/\D/g, "").slice(0, 6);
            setValue(digits);
            if (digits.length === 6) submit(digits);
          }}
          className={`${input} font-mono text-2xl tracking-[0.3em]`}
        />
      </div>
    );
  }
  const checking = (text: string) => (
    <p className="mt-3 flex items-center gap-2 text-base leading-7 text-ink-body" role="status">
      {busy && <span aria-hidden className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-line-strong border-t-transparent" />}
      {busy ? text : " "}
    </p>
  );
  const countdown = (again: () => void, wrong: () => void, wrongLabel: string) => (
    <p className="mt-3 flex flex-wrap items-center gap-x-4 text-base text-ink-secondary">
      <button type="button" onClick={wrong} className={quietLink}>
        {wrongLabel}
      </button>
      {resendLeft > 0 ? (
        <span>{t("signupPage.resendIn", { time: clock(resendLeft) })}</span>
      ) : (
        <button type="button" onClick={again} className={quietLink}>
          {t("signupPage.resend")}
        </button>
      )}
    </p>
  );

  const stepNumber = step === "email" || step === "code" || step === "owns" ? 1 : step === "name" || step === "signing-in" ? 3 : 2;
  const stepLabels = [t("signupPage.stepEmail"), t("signupPage.stepPhone"), t("signupPage.stepName")];

  const addressTakenText = t("signupPage.addressTaken", { address: `${host}${journalPath(username)}`, name: name.trim() });
  const showAddressField = isTaken || addressEdited || (suggested === "" && name.trim() !== "");
  const addressField = (
    <div>
      <div className={field}>
        <label className={label} htmlFor="signup-username">
          {t("signupPage.addressChoose")}
        </label>
        <div className="flex items-baseline text-base text-ink-strong">
          <span className="shrink-0 text-ink-secondary">{host}/@</span>
          <input
            id="signup-username"
            value={username}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            onChange={(e) => {
              setAddressEdited(true);
              setAddressInput(e.target.value.toLowerCase());
              setError(null);
            }}
            aria-invalid={status === "invalid" || isTaken}
            className={input}
          />
        </div>
      </div>
      <p className="mt-2 text-sm leading-6 text-ink-secondary" role="status">
        {status === "ok"
          ? t("signupPage.addressFree")
          : status === "checking"
            ? t("signupPage.addressChecking")
            : status === "invalid"
              ? t("agent.error.invalid_username")
              : t("signupPage.addressRules")}
      </p>
      {isTaken && chips.name === name && chips.list.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
          {chips.list.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => {
                setAddressEdited(true);
                setAddressInput(c);
              }}
              className="min-h-11 rounded-full border border-line-strong bg-surface-base px-4 text-sm text-ink-strong"
            >
              {c}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  const knownCurrency = (c: string) => COMMON_CURRENCIES.includes(c) || c === defaults.currency;
  const currencyOptions = defaults.currency && !COMMON_CURRENCIES.includes(defaults.currency) ? [defaults.currency, ...COMMON_CURRENCIES] : COMMON_CURRENCIES;
  const currencyName = (c: string) => {
    try {
      return new Intl.DisplayNames([locale], { type: "currency" }).of(c);
    } catch {
      return undefined;
    }
  };
  const selectValue = otherCurrency || (currency !== "" && !knownCurrency(currency)) ? "__other" : currency;
  const canCreate = !busy && name.trim() !== "" && title.trim() !== "" && (status === "ok" || status === "unknown") && /^[A-Z]{3}$/.test(currency);

  return (
    <section className="rounded-2xl border border-line-quiet bg-surface-base p-5 sm:p-6">
      {step !== "owns" && step !== "signing-in" && (
        <ol aria-label={t("signupPage.stepsLabel")} className="mb-5 flex gap-1.5 text-[13px] font-semibold text-ink-secondary">
          {stepLabels.map((text, index) => (
            <li key={text} className="flex-1" aria-current={index + 1 === stepNumber ? "step" : undefined}>
              <span className={`mb-1.5 block h-1.5 rounded-full ${index + 1 <= stepNumber ? "bg-blue-500" : "bg-line-quiet"}`} />
              {index + 1} {text}
              {index + 1 < stepNumber ? " ✓" : ""}
            </li>
          ))}
        </ol>
      )}
      <h2 className="font-display text-xl font-semibold text-ink-strong">
        {step === "owns"
          ? t("agent.haveJournal")
          : step === "phone" || step === "phone-code" || step === "phone-wa"
            ? t("signupPage.phoneTitle")
            : step === "name"
              ? t("signupPage.nameTitle")
              : t(step === "code" ? "codeWait.title" : "agent.startTitle")}
      </h2>

      {welcomeBack && (step === "phone" || step === "phone-wa" || step === "name") && (
        <p className="mt-2 text-base leading-7 text-ink-body">{t("signupPage.welcomeBack")}</p>
      )}

      {error && (
        <p role="alert" className="mt-4 text-base leading-7 text-coral-600">
          {error}
        </p>
      )}
      {telTaken && (
        <p role="alert" className="mt-4 text-base leading-7 text-coral-600">
          {t("signupPage.telTaken")}{" "}
          <Link href="/?start=1" className="underline underline-offset-4">
            {t("signupPage.telTakenLink")}
          </Link>
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
              without firing `onChange`, leaving that state stale. */}
          <BusyButton
            busy={busy}
            type="submit"
            className={`mt-4 w-full ${PILL_PRIMARY} disabled:opacity-50`}
            busyLabel={proven ? undefined : t("me.signInSending")}
          >
            {t("agent.startVerify")}
          </BusyButton>
          <p className="mt-3 text-sm leading-6 text-ink-secondary">
            {proven ? t("signupPage.provenAs", { email: prefillEmail! }) : t("signupPage.reminderNotice")}
          </p>
          {inviteRequest && (
            <p className="mt-3 text-sm leading-6">
              <Link href="/invite" className="underline underline-offset-4">
                {t("signupPage.requestInvite")}
              </Link>
            </p>
          )}
        </form>
      )}

      {step === "code" && (
        <CodeWaitPanel
          id="signup-code"
          email={email}
          minutes={codeMinutes}
          hedged={inviteOnly}
          code={code}
          onCodeChange={setCode}
          onSubmit={(digits) => void verifyCode(digits)}
          onResend={resendEmailCode}
          onWrongAddress={() => {
            setError(null);
            setStep("email");
          }}
          busy={busy}
          buttonClassName={`mt-4 w-full ${PILL_PRIMARY} disabled:opacity-50`}
        />
      )}

      {step === "owns" && (
        <div>
          <p className="mt-2 text-base leading-7 text-ink-body">
            {ownedUser ? t("signupPage.welcomeStudio", { user: ownedUser }) : t("agent.error.too_many_journals")}
          </p>
          {ownedUser ? (
            <a
              href={`${journalPath(encodeURIComponent(ownedUser))}/studio`}
              className={`mt-4 block w-full text-center ${PILL_PRIMARY}`}
            >
              {t("signupPage.welcomeStudioOpen")}
            </a>
          ) : (
            <button type="button" onClick={onAlreadyOwns} className={`mt-4 w-full ${PILL_PRIMARY}`}>
              {t("agent.haveJournalYes")}
            </button>
          )}
        </div>
      )}

      {step === "phone-wa" && (
        <div>
          <p className="mt-2 text-base leading-7 text-ink-body">{t("signupPage.phoneWhy")}</p>
          {!waOpened ? (
            <>
              <a
                href={waLink}
                target="_blank"
                rel="noreferrer"
                onClick={() => setWaOpened(true)}
                className={`mt-4 block w-full text-center ${PILL_PRIMARY}`}
              >
                {t("agent.phoneWaOpen")}
              </a>
              <p className="mt-2 text-sm leading-6 text-ink-secondary">{t("signupPage.waHint")}</p>
              {smsFallback && (
                <button
                  type="button"
                  onClick={() => {
                    setSmsChannel(true);
                    setStep("phone");
                  }}
                  className={`mt-4 block w-full text-center ${PILL_GHOST}`}
                >
                  {t("signupPage.smsInstead")}
                </button>
              )}
            </>
          ) : (
            <>
              <p className="mt-4 flex items-center gap-2 text-base leading-7 text-ink-body" role="status">
                {!waExpired && (
                  <span aria-hidden className="inline-block h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-line-strong border-t-transparent" />
                )}
                {waExpired ? t("agent.phoneWaExpired") : t("agent.phoneWaWaiting")}
              </p>
              <div className="mt-3 flex flex-wrap gap-x-5">
                {waExpired ? (
                  <button type="button" onClick={() => void requestWaLink()} className={quietLink}>
                    {t("agent.phoneWaRetry")}
                  </button>
                ) : (
                  <>
                    <a href={waLink} target="_blank" rel="noreferrer" className={`${quietLink} inline-flex items-center`}>
                      {t("signupPage.waOpenAgain")}
                    </a>
                    <button type="button" onClick={() => void pollRef.current?.()} className={quietLink}>
                      {waChecking ? t("signupPage.waChecking") : t("signupPage.waCheck")}
                    </button>
                  </>
                )}
                {smsFallback && (
                  <button
                    type="button"
                    onClick={() => {
                      setSmsChannel(true);
                      setStep("phone");
                    }}
                    className={quietLink}
                  >
                    {t("signupPage.smsInsteadShort")}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {step === "phone" && (
        <form onSubmit={sendPhoneCode}>
          <p className="mt-2 text-base leading-7 text-ink-body">{t("signupPage.phoneWhy")}</p>
          <div className="mt-4">
            <span className={label}>{t("agent.phoneLabel")}</span>
            <TelField
              id="signup-tel"
              cc={telCc}
              iso2={telPick === null ? (defaults.region ?? undefined) : telIso}
              national={telNational}
              onChange={(cc, national, iso) => {
                setTelPick(cc);
                setTelIso(iso);
                setTelNational(national);
              }}
              labelCountry={t("contact.telCountry")}
              searchPlaceholder={t("contact.telSearchPlaceholder")}
              noMatches={t("contact.telNoMatches")}
              locale={locale}
            />
          </div>
          <p className="mt-3 text-base leading-7 text-ink-body">
            {smsChannel
              ? phoneCountryCode
                ? t("agent.phoneSmsIntroCountry", { cc: `+${phoneCountryCode}` })
                : t("agent.phoneSmsIntro")
              : t("agent.phoneWhatsapp")}
          </p>
          <p className="mt-2 text-sm leading-6 text-ink-secondary">
            {contactEmail
              ? t("agent.phoneNoWhatsapp", { email: contactEmail })
              : t("agent.phoneNoWhatsappNoAddress")}
          </p>
          <BusyButton
            busy={busy}
            type="submit"
            className={`mt-4 w-full ${PILL_PRIMARY} disabled:opacity-50`}
            busyLabel={t("me.signInSending")}
          >
            {smsChannel ? t("signupPage.smsSend") : t("agent.phoneSend")}
          </BusyButton>
          {mode === "whatsapp-inbound" && (
            <button type="button" onClick={() => void requestWaLink()} className={`mt-3 ${quietLink}`}>
              {t("agent.phoneWaOpen")}
            </button>
          )}
        </form>
      )}

      {step === "phone-code" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (phoneCode.length === 6) void verifyPhoneCode(phoneCode);
          }}
        >
          <p className="mt-2 text-base leading-7 text-ink-body">
            {t("signupPage.telSent", { tel: `+${telCc} ${telNational}` })}
            {" — "}
            {smsChannel ? t("agent.phoneSmsCodeSent") : t("agent.phoneCodeSent")}
          </p>
          {codeBox("signup-phone-code", phoneCode, setPhoneCode, verifyPhoneCode)}
          {checking(t("signupPage.codeChecking"))}
          {countdown(
            () => void sendPhoneCode(),
            () => {
              setError(null);
              setStep("phone");
            },
            t("signupPage.telWrong"),
          )}
        </form>
      )}

      {step === "name" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (canCreate) void createJournal();
          }}
        >
          <div className={field}>
            <label className={label} htmlFor="signup-name">
              {t("signupPage.stepName")}
            </label>
            <input
              id="signup-name"
              required
              autoComplete="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={input}
            />
          </div>

          {!advancedOpen && (
            <>
              {isTaken ? (
                <p role="alert" className="mt-3 text-sm leading-6 text-coral-600">
                  {addressTakenText}
                </p>
              ) : (
                <p className="mt-3 text-sm leading-6 text-ink-secondary">{t("signupPage.nameHint")}</p>
              )}
              {!isTaken && username !== "" && !showAddressField && (
                <p className="mt-1 break-all text-sm leading-6 text-ink-strong" role="status">
                  <span className="font-semibold">{host}{journalPath(username)}</span>
                  {" · "}
                  {status === "ok" ? t("signupPage.addressAvailable") : status === "checking" ? t("signupPage.addressChecking") : ""}
                  <br />
                  <span className="text-ink-secondary">{t("signupPage.addressPermanent")}</span>{" "}
                  <button type="button" onClick={() => { setAddressEdited(true); setAddressInput(username); }} className="text-ink-secondary underline underline-offset-4">
                    {t("signupPage.addressChange")}
                  </button>
                </p>
              )}
              {showAddressField && <div className="mt-2">{addressField}</div>}

              <div className="mt-5 rounded-xl border border-line-quiet bg-surface-base p-4">
                <p className="text-base font-semibold text-ink-strong">{t("signupPage.cardTitle")}</p>
                <dl className="mt-2 divide-y divide-line-quiet text-base">
                  <div className="flex justify-between gap-3 py-2">
                    <dt className="text-ink-secondary">{t("signupPage.cardLanguage")}</dt>
                    <dd className="text-ink-strong">{LOCALE_LABEL[defaultLocale] ?? defaultLocale}</dd>
                  </div>
                  <div className="flex justify-between gap-3 py-2">
                    <dt className="text-ink-secondary">{t("signupPage.cardCurrency")}</dt>
                    <dd className="text-ink-strong">
                      {currency ? (
                        currency
                      ) : (
                        <button type="button" onClick={() => setAdvancedOpen(true)} className="underline underline-offset-4">
                          {t("signupPage.cardChoose")}
                        </button>
                      )}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-3 py-2">
                    <dt className="text-ink-secondary">{t("signupPage.cardSearch")}</dt>
                    <dd className="text-ink-strong">{listed ? t("signupPage.cardSearchOn") : t("signupPage.cardSearchOff")}</dd>
                  </div>
                </dl>
                <button
                  type="button"
                  onClick={() => setAdvancedOpen(true)}
                  className="mt-2 flex min-h-12 w-full items-center justify-between rounded-xl border border-line-quiet px-4 text-left text-base font-semibold text-ink-strong"
                >
                  {t("signupPage.editAdvanced")}
                  <span aria-hidden>›</span>
                </button>
              </div>
              <p className="mt-3 text-sm leading-6 text-ink-secondary">{t("signupPage.tripNote")}</p>
            </>
          )}

          {advancedOpen && (
            <div className="mt-5 rounded-xl border border-line-quiet bg-surface-base p-4">
              <p className="text-base font-semibold text-ink-strong">{t("signupPage.advTitle")}</p>
              <div className="mt-2">{addressField}</div>
              {status !== "ok" && <p className="mt-1 text-sm leading-6 text-ink-secondary">{t("signupPage.addressPermanent")}</p>}
              <div className={field}>
                <label className={label} htmlFor="signup-title">
                  {t("signupPage.advTitleLabel")}
                </label>
                <input
                  id="signup-title"
                  value={title}
                  onChange={(e) => setTitleOverride(e.target.value)}
                  className={input}
                />
              </div>
              <label className="mt-5 flex items-start gap-3 text-base text-ink-strong">
                <input
                  id="signup-listed"
                  type="checkbox"
                  checked={listed}
                  onChange={(e) => setListed(e.target.checked)}
                  className="mt-1 h-5 w-5"
                />
                <span>
                  <span className="block font-semibold">{t("me.journalListed")}</span>
                  <span className="block text-sm leading-6 text-ink-secondary">{t("signupPage.advListedHint")}</span>
                </span>
              </label>
              <label className="mt-5 block text-base font-semibold text-ink-strong" htmlFor="signup-locale">
                {t("signupPage.cardLanguage")}
              </label>
              <select id="signup-locale" value={defaultLocale} onChange={(e) => chooseLanguage(e.target.value)} className={select}>
                {MAINTAINED_LOCALES.map((code) => (
                  <option key={code} value={code}>
                    {LOCALE_LABEL[code] ?? code}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-sm leading-6 text-ink-secondary">{t("signupPage.advLocaleHint")}</p>
              <label className="mt-5 block text-base font-semibold text-ink-strong" htmlFor="signup-currency">
                {t("signupPage.cardCurrency")}
              </label>
              <select
                id="signup-currency"
                value={selectValue}
                onChange={(e) => {
                  if (e.target.value === "__other") {
                    setOtherCurrency(true);
                    setCurrencyPick("");
                  } else {
                    setOtherCurrency(false);
                    setCurrencyPick(e.target.value);
                  }
                }}
                className={select}
              >
                {currency === "" && !otherCurrency && <option value="">{t("signupPage.cardChoose")}</option>}
                {currencyOptions.map((code) => (
                  <option key={code} value={code}>
                    {currencyName(code) ? `${code} — ${currencyName(code)}` : code}
                  </option>
                ))}
                <option value="__other">{t("signupPage.currencyOther")}</option>
              </select>
              {selectValue === "__other" && (
                <>
                  <input
                    id="signup-currency-other"
                    list="signup-currency-codes"
                    maxLength={3}
                    autoComplete="off"
                    autoCapitalize="characters"
                    placeholder={t("signupPage.currencySearch")}
                    value={currency}
                    onChange={(e) => setCurrencyPick(e.target.value.toUpperCase())}
                    className={`${select} font-mono`}
                  />
                  <datalist id="signup-currency-codes">
                    {ALL_CURRENCIES.map((code) => (
                      <option key={code} value={code}>
                        {currencyName(code)}
                      </option>
                    ))}
                  </datalist>
                </>
              )}
              <p className="mt-1 text-sm leading-6 text-ink-secondary">{t("signupPage.advCurrencyHint")}</p>
              <button type="button" onClick={() => setAdvancedOpen(false)} className={`mt-4 ${quietLink}`}>
                {t("signupPage.backToSummary")}
              </button>
            </div>
          )}

          <BusyButton
            busy={busy}
            type="submit"
            disabled={!canCreate}
            className={`mt-5 w-full ${PILL_PRIMARY} disabled:opacity-50`}
            busyLabel={t("agent.creatingJournal")}
          >
            {t("agent.createJournal")}
          </BusyButton>
        </form>
      )}

      {step === "signing-in" && (
        <p className="mt-4 text-base leading-7 text-ink-body">
          {t("agent.signingIn")}
        </p>
      )}
    </section>
  );
}
