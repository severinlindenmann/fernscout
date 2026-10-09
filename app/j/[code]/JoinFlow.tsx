"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import BusyButton from "@/components/BusyButton";
import TelField, { joinTel } from "@/components/TelField";
import {
  AddressFields,
  Alert,
  CodeArt,
  CodeField,
  EMPTY,
  FIELD,
  Heading,
  LABEL,
  PostcardArt,
  PRIMARY,
  QUIET,
  Screen,
  Ticks,
  WaitingArt,
  type Address,
} from "@/components/guide/GuideParts";
import { translate, type TranslationKey } from "@/lib/i18n";
import { toE164 } from "@/lib/phone";
import { regionDefaults } from "@/lib/regionDefaults";

import { journalPath } from "@/lib/journalPath";
const subscribeNothing = () => () => {};
const browserLanguages = () => (typeof navigator === "undefined" ? "" : [...(navigator.languages ?? [navigator.language])].join(","));

/** The server's own rule (`isEmail` in lib/auth), copied because that module
 * is server-only. A mismatch can only make the browser stricter or looser
 * than the server; the server always has the last word. */
const looksLikeEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());

/** B-2933: the name typed before the confirm mail went out, kept in this
 * browser so the mail's link (which reopens this page signed in) does not ask
 * for it again. Never in the link itself: `safeDestination` drops a query
 * string, and a name has no business in a mailed URL. */
const nameKey = (code: string) => `fernscout.join.${code}.name`;
function storedName(code: string): string {
  try {
    return localStorage.getItem(nameKey(code)) ?? "";
  } catch {
    return "";
  }
}
function storeName(code: string, name: string | null) {
  try {
    if (name) localStorage.setItem(nameKey(code), name);
    else localStorage.removeItem(nameKey(code));
  } catch {
    // Private mode or blocked storage: the visitor types the name again.
  }
}

type Step = "who" | "pick" | "prove" | "address" | "done";
type Way = "whatsapp" | "sms" | "email";

const ERRORS: Record<string, TranslationKey> = {
  rate_limited: "guide.error.rateLimited",
  invalid_code: "guide.error.code",
  unavailable: "guide.error.unavailable",
  invalid_phone: "guide.error.phone",
  invalid_email: "guide.error.email",
  invalid_name: "join.error.name",
  expired: "join.error.expired",
};

const POLL_MS = 2000;

/**
 * `/j/<code>` — somebody opened a group link (B2293, B2291 "Group-link
 * visitor", B2941): whose journal · name, email and/or mobile on one page ·
 * how to confirm (WhatsApp, SMS or email, only what can work) · the proof ·
 * where postcards go · in. A reader link lets a confirmed person in at once
 * (B-2940); a buddy link still waits for the owner.
 */
export default function JoinFlow({
  code,
  owner,
  title,
  ownerName,
  kind,
  tripTitle,
  knownEmail,
  caps,
  dictionary,
  locale,
  locales,
  addressLookupEnabled,
}: {
  code: string;
  owner: string;
  title: string;
  ownerName: string;
  kind: "guest" | "buddy";
  tripTitle: string | null;
  /** Signed in already with this address — masked; no second code. */
  knownEmail: string | null;
  caps: { mail: boolean; sms: boolean; whatsapp: boolean; postcards: boolean };
  dictionary: Record<string, string>;
  locale: string;
  /** The journal's own languages — B2452, passed to `CountryField` for
   * resolving a legacy stored country string. */
  locales: string[];
  /** `isEnabled("addressLookup", owner)`, from the page. */
  addressLookupEnabled: boolean;
}) {
  const t = (key: TranslationKey, vars?: Record<string, string>) => translate(dictionary, key, vars);
  const vars = { owner: ownerName, title, trip: tripTitle ?? "" };

  const remembered = useSyncExternalStore(subscribeNothing, () => storedName(code), () => "");
  const [typedName, setName] = useState<string | null>(null);
  const name = typedName ?? remembered;
  const [email, setEmail] = useState("");
  const [touched, setTouched] = useState({ email: false, tel: false });
  // The flag and dialling code (`TelField`), guessed from the browser's
  // languages the way signup does until the visitor picks one.
  const languages = useSyncExternalStore(subscribeNothing, browserLanguages, () => "");
  const region = useMemo(() => regionDefaults(languages ? languages.split(",") : []), [languages]);
  const [telPick, setTelPick] = useState<{ cc: string; iso2?: string } | null>(null);
  const cc = telPick?.cc ?? region.cc ?? "";
  const [national, setNational] = useState("");
  const tel = joinTel(cc, national);

  const emailTyped = email.trim() !== "";
  const telTyped = national.trim() !== "";
  const emailOk = emailTyped && looksLikeEmail(email);
  // With a dialling code picked the number is international, so no configured
  // default is needed here: the server's own rule (`toE164`).
  const telOk = telTyped && toE164(tel) !== null;
  const ways: Way[] = [
    ...(telOk && caps.whatsapp ? (["whatsapp"] as const) : []),
    ...(telOk && caps.sms ? (["sms"] as const) : []),
    ...(emailOk && caps.mail ? (["email"] as const) : []),
  ];

  const [steps, setSteps] = useState<Step[]>(["who", "prove", "done"]);
  const [step, setStep] = useState<Step>("who");
  const [way, setWay] = useState<Way>("email");
  const index = steps.indexOf(step);
  const dots = { total: steps.length - 1, current: index, label: t("guide.dots", { n: String(index + 1), total: String(steps.length - 1) }) };
  // B-2933: a step change never carries the last step's error along.
  const go = (to: Step) => {
    setError(null);
    setStep(to);
  };
  const seen = useRef<Step>("who");
  useEffect(() => {
    if (seen.current !== step) document.getElementById(`join-${step}`)?.focus();
    seen.current = step;
  }, [step]);

  const [sentTo, setSentTo] = useState("");
  const [typed, setTyped] = useState("");
  const [address, setAddress] = useState<Address>(EMPTY);
  const [status, setStatus] = useState<"in" | "waiting">("waiting");
  // Somebody already on the page (`known`) keeps what is stored.
  const [known, setKnown] = useState(false);
  // The day letter is a choice, never assumed; news from Fernscout starts
  // ticked, the owner's decision of 27 Sep (B2504), and unticking records nothing.
  const [digest, setDigest] = useState(false);
  const [news, setNews] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [whatsapp, setWhatsapp] = useState<{ id: string; link: string } | null>(null);

  async function call(body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/j/${encodeURIComponent(code)}/step`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, locale, ...body }),
      });
      const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) {
        setError(t(ERRORS[String(json.error)] ?? "guide.error.generic"));
        return null;
      }
      return json;
    } catch {
      setError(t("guide.error.generic"));
      return null;
    } finally {
      setBusy(false);
    }
  }

  const valueFor = (w: Way) => (w === "email" ? email.trim() : tel.trim());

  async function afterWho() {
    if (!name.trim()) {
      setError(t("join.error.name"));
      return;
    }
    if (knownEmail) {
      setSteps(["who", ...(caps.postcards ? (["address"] as const) : []), "done"]);
      const joined = await call({ action: "join" });
      if (joined) proved(joined, ["who", ...(caps.postcards ? (["address"] as const) : []), "done"]);
      return;
    }
    if (!ways.length) {
      setError(t("join.who.needOne"));
      return;
    }
    const withPick = ways.length > 1;
    setSteps(["who", ...(withPick ? (["pick"] as const) : []), "prove", ...(caps.postcards ? (["address"] as const) : []), "done"]);
    if (withPick) go("pick");
    else await start(ways[0]);
  }

  async function start(chosen: Way) {
    setWay(chosen);
    setTyped("");
    if (chosen === "whatsapp") {
      const started = await call({ action: "wa-start", value: valueFor("whatsapp") });
      if (started && typeof started.id === "string" && typeof started.link === "string") {
        setWhatsapp({ id: started.id, link: started.link });
        storeName(code, name.trim());
        go("prove");
      }
      return;
    }
    const sent = await call({ action: "send", channel: chosen, value: valueFor(chosen) });
    if (sent) {
      storeName(code, name.trim());
      setSentTo(String(sent.to ?? valueFor(chosen)));
      go("prove");
    }
  }

  async function verify(digits = typed) {
    if (digits.length !== 6) return;
    const answer = await call({ action: "verify", channel: way, value: valueFor(way), code: digits });
    if (answer) proved(answer);
  }

  /** Somebody already on the page keeps what is stored: no address screen for
   * them, straight to where they stand. */
  function proved(answer: Record<string, unknown>, order: Step[] = steps) {
    storeName(code, null);
    setStatus(answer.status === "in" ? "in" : "waiting");
    setKnown(Boolean(answer.known));
    setWhatsapp(null);
    if (answer.known) go("done");
    else go(order[order.indexOf(step) + 1] ?? "done");
  }

  // The WhatsApp proof arrives by itself: the guest sends a message from their
  // phone and the server sees it, so this page asks until it has.
  const waId = whatsapp?.id ?? null;
  useEffect(() => {
    if (step !== "prove" || way !== "whatsapp" || !waId) return;
    let stopped = false;
    const timer = setInterval(async () => {
      try {
        const response = await fetch(`/j/${encodeURIComponent(code)}/step`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "wa-poll", id: waId, name, locale }),
        });
        const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
        if (stopped) return;
        const state = String(json.status ?? "");
        if (response.ok && json.ok === true && (state === "in" || state === "waiting")) {
          clearInterval(timer);
          proved(json);
        } else if (state === "mismatch") {
          clearInterval(timer);
          setWhatsapp(null);
          setError(t("join.wa.mismatch"));
        } else if (state === "expired" || state === "tel_taken" || response.status === 404) {
          clearInterval(timer);
          setWhatsapp(null);
          setError(t("join.wa.expired"));
        }
      } catch {
        // A dropped request: the next tick asks again.
      }
    }, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
    // `proved` and `t` close over state this effect must not restart on.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, way, waId, code]);

  const hasAddress = Boolean(address.line1.trim() && address.city.trim() && address.country.trim());
  async function saveAddress() {
    if (!hasAddress) {
      setError(t("guide.address.incomplete"));
      return;
    }
    // Giving a postal address is asking for postcards.
    if (await call({ action: "save", address, wantsPostcard: true })) go("done");
  }

  const mailError = touched.email && emailTyped && !emailOk ? t("join.who.errEmail") : null;
  const telError = touched.tel && telTyped && !telOk ? t("join.who.errPhone") : null;
  const emailOnly = emailOk && !telOk;

  if (step === "who") {
    const blocked = !knownEmail && (!ways.length || (emailTyped && !emailOk) || (telTyped && !telOk));
    return (
      <Screen
        labelledBy="join-who"
        dots={dots}
        footer={
          <BusyButton busy={busy} type="button" className={PRIMARY} disabled={blocked} onClick={afterWho}>
            {t("join.who.go")}
          </BusyButton>
        }
      >
        <p className="text-sm font-semibold text-ink-secondary">{title}</p>
        <Heading id="join-who" big>
          {kind === "buddy" ? t("join.who.buddyTitle", vars) : t("join.who.title")}
        </Heading>
        <p className="text-base text-ink-body">{kind === "buddy" ? t("join.who.buddyBody", vars) : t("join.who.body", vars)}</p>
        <label className={LABEL}>
          {t("join.who.name")}
          <input className={FIELD} autoComplete="name" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        {knownEmail ? (
          <p className="text-sm text-ink-secondary">{t("join.who.signedIn", { email: knownEmail })}</p>
        ) : (
          <>
            <p className="text-sm text-ink-secondary">{t("join.who.contactHint")}</p>
            <label className={LABEL}>
              {t("join.reach.emailLabel")}
              <input
                className={FIELD}
                type="email"
                inputMode="email"
                autoComplete="email"
                autoCapitalize="off"
                placeholder="name@example.com"
                aria-invalid={mailError ? true : undefined}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                onBlur={() => setTouched((x) => ({ ...x, email: true }))}
              />
              {mailError && <span className="mt-1 block text-sm text-coral-600">{mailError}</span>}
            </label>
            <div className="flex flex-col gap-1">
              <label htmlFor="join-tel" className={LABEL}>
                {t("join.who.mobileLabel")}
              </label>
              <TelField
                id="join-tel"
                cc={cc}
                iso2={telPick ? telPick.iso2 : (region.region ?? undefined)}
                national={national}
                onChange={(nextCc, nextNational, iso2) => {
                  setTelPick({ cc: nextCc, iso2 });
                  setNational(nextNational);
                }}
                labelCountry={t("contact.telCountry")}
                searchPlaceholder={t("contact.telSearchPlaceholder")}
                noMatches={t("contact.telNoMatches")}
                locale={locale}
              />
              {telError && <span className="text-sm text-coral-600">{telError}</span>}
            </div>
            {emailOnly && <p className="text-sm text-ink-secondary">{t("join.who.onlyEmail")}</p>}
            {!ways.length && (emailTyped || telTyped) && !mailError && !telError && (
              <p className="text-sm text-ink-secondary">{t("join.who.needOne")}</p>
            )}
          </>
        )}
        <Alert text={error} />
      </Screen>
    );
  }

  if (step === "pick") {
    const labels: Record<Way, { name: TranslationKey; hint: TranslationKey }> = {
      whatsapp: { name: "join.pick.whatsapp", hint: "join.pick.whatsappHint" },
      sms: { name: "join.pick.sms", hint: "join.pick.smsHint" },
      email: { name: "join.pick.email", hint: "join.pick.emailHint" },
    };
    return (
      <Screen labelledBy="join-pick" dots={dots} footer={<button type="button" className={QUIET} onClick={() => go("who")}>{t("join.code.change")}</button>}>
        <Heading id="join-pick">{t("join.pick.title")}</Heading>
        <p className="text-base text-ink-body">{t("join.pick.body")}</p>
        <div className="flex flex-col gap-3">
          {ways.map((w, i) => (
            <button
              key={w}
              type="button"
              disabled={busy}
              onClick={() => start(w)}
              className={`flex min-h-16 flex-col items-start gap-0.5 rounded-2xl border-2 bg-surface-raised p-4 text-left ${i === 0 ? "border-blue-500" : "border-line-strong"}`}
            >
              <span className="flex w-full items-center gap-2 text-lg font-semibold text-ink-strong">
                {t(labels[w].name)}
                {i === 0 && <span className="ml-auto rounded-full bg-yellow-400 px-2 py-0.5 text-xs font-bold text-yellow-950">{t("join.pick.quick")}</span>}
              </span>
              <span className="text-sm text-ink-secondary">{t(labels[w].hint, { to: w === "email" ? email.trim() : tel.trim() })}</span>
              {w === "email" && <span className="text-sm font-semibold text-yellow-900">{t("join.pick.emailWarn")}</span>}
            </button>
          ))}
        </div>
        <Alert text={error} />
      </Screen>
    );
  }

  if (step === "prove") {
    const other = ways.filter((w) => w !== way);
    const another = other.length ? (
      <button type="button" className={QUIET} onClick={() => go("pick")}>
        {t("join.code.another")}
      </button>
    ) : null;
    if (way === "whatsapp") {
      return (
        <Screen
          labelledBy="join-prove"
          dots={dots}
          footer={
            <>
              {another}
              <button type="button" className={QUIET} onClick={() => go("who")}>
                {t("join.code.changeNumber")}
              </button>
            </>
          }
        >
          <CodeArt />
          <Heading id="join-prove">{t("join.wa.title")}</Heading>
          <p className="text-base text-ink-body">{t("join.wa.body")}</p>
          {whatsapp ? (
            <>
              <a href={whatsapp.link} target="_blank" rel="noopener noreferrer" className={`${PRIMARY} grid place-items-center text-center`}>
                {t("join.wa.open")}
              </a>
              <p role="status" className="text-base font-semibold text-ink-strong">
                {t("join.wa.waiting")}
              </p>
              <p className="text-sm text-ink-secondary">{t("join.wa.from", { number: tel.trim() })}</p>
            </>
          ) : (
            <BusyButton busy={busy} type="button" className={PRIMARY} onClick={() => start("whatsapp")}>
              {t("join.wa.open")}
            </BusyButton>
          )}
          <Alert text={error} />
        </Screen>
      );
    }
    return (
      <Screen
        labelledBy="join-prove"
        dots={dots}
        footer={
          <>
            <BusyButton busy={busy} type="button" className={PRIMARY} disabled={typed.length !== 6} onClick={() => verify()}>
              {t("guide.code.confirm")}
            </BusyButton>
            {another}
            <button type="button" className={QUIET} onClick={() => go("who")}>
              {way === "email" ? t("join.code.change") : t("join.code.changeNumber")}
            </button>
          </>
        }
      >
        <CodeArt />
        <Heading id="join-prove">{way === "email" ? t("join.code.inbox") : t("join.code.textTitle")}</Heading>
        <p className="text-base text-ink-body">{way === "email" ? t("join.code.bodyEmail", { to: sentTo }) : t("join.code.bodySms", { to: sentTo })}</p>
        {way === "email" && (
          <div className="flex flex-col gap-1 rounded-2xl border-2 border-yellow-400 bg-yellow-50 p-4 text-base text-yellow-950">
            <span className="font-semibold">{t("join.code.spamTitle")}</span>
            <ol className="list-decimal pl-5">
              <li>{t("join.code.spam1")}</li>
              <li>{t("join.code.spam2", vars)}</li>
              <li>{t("join.code.spam3")}</li>
            </ol>
          </div>
        )}
        <CodeField id="join-code-input" label={t("guide.code.label")} value={typed} onChange={setTyped} onComplete={(digits) => verify(digits)} />
        <Alert text={error} />
      </Screen>
    );
  }

  if (step === "address") {
    return (
      <Screen
        labelledBy="join-address"
        dots={dots}
        footer={
          <>
            <BusyButton busy={busy} type="button" className={PRIMARY} onClick={saveAddress}>
              {t("guide.address.save")}
            </BusyButton>
            <button type="button" className={QUIET} onClick={() => go("done")}>
              {t("guide.address.skip")}
            </button>
          </>
        }
      >
        <PostcardArt />
        <Heading id="join-address">{t("guide.address.title")}</Heading>
        <p className="text-base text-ink-body">{t("guide.address.body", vars)}</p>
        <AddressFields
          value={address}
          onChange={setAddress}
          hint={t("guide.address.lookupHint")}
          labels={{
            street: t("guide.address.street"),
            postcode: t("guide.address.postcode"),
            city: t("guide.address.city"),
            country: t("guide.address.country"),
            countrySearchPlaceholder: t("contact.addrCountrySearchPlaceholder"),
            countryNoMatches: t("contact.addrCountryNoMatches"),
            addressLookupAttribution: t("contact.addressLookupAttribution"),
            addressLookupUnavailable: t("contact.addressLookupUnavailable"),
          }}
          enabled={addressLookupEnabled}
          username={owner}
          locale={locale}
          locales={locales}
        />
        <p className="text-sm text-ink-secondary">{t("guide.address.private", vars)}</p>
        <Alert text={error} />
      </Screen>
    );
  }

  if (status === "in") {
    // B2943: the owner is not asked and is not named as having approved:
    // the link was the invitation. Only what was really confirmed is said.
    const withEmail = Boolean(knownEmail) || way === "email";
    const fullName = name.trim() || "—";
    // Somebody already on the page keeps what is stored: no choices to save.
    const askChoices = withEmail && caps.mail && !known;
    async function open() {
      if (askChoices && !(await call({ action: "save", wantsEmailDigest: digest, wantsNews: news }))) return;
      window.location.assign(journalPath(owner));
    }
    return (
      <Screen
        labelledBy="join-done"
        footer={
          <BusyButton busy={busy} type="button" className={PRIMARY} onClick={open}>
            {t("guide.notify.open")}
          </BusyButton>
        }
      >
        <Heading id="join-done">
          <span aria-hidden="true" className="mr-2 inline-grid size-7 place-items-center rounded-full bg-green-700 align-middle text-base text-white">
            ✓
          </span>
          {t("join.ready.title", vars)}
        </Heading>
        <p className="text-base font-semibold text-ink-secondary">{t("join.ready.by", vars)}</p>
        <p className="text-base text-ink-body">
          {t(withEmail ? "join.ready.bodyEmail" : "join.ready.bodyPhone", { name: fullName })}
          {address.line1 && hasAddress && address.city ? ` ${t("join.ready.addressSaved")}` : ""}
        </p>
        {askChoices && (
          <Ticks
            ticks={[
              { key: "wantsEmailDigest", label: t("join.ready.digest", vars), hint: t("join.ready.digestHint"), checked: digest, disabled: false },
              { key: "wantsNews", label: t("join.notify.news"), hint: t("join.notify.newsHint", vars), checked: news, disabled: false },
            ]}
            onChange={(key, checked) => (key === "wantsNews" ? setNews(checked) : setDigest(checked))}
          />
        )}
        <Alert text={error} />
        <details className="text-base text-ink-body">
          <summary className="min-h-11 cursor-pointer py-2 font-semibold text-ink-strong">{t("join.ready.howTitle")}</summary>
          <p className="pb-2">{t(withEmail ? "join.ready.howBodyEmail" : "join.ready.howBodyPhone")}</p>
        </details>
      </Screen>
    );
  }

  return (
    <Screen labelledBy="join-done" footer={null}>
      <WaitingArt />
      <Heading id="join-done">{t("join.done.title")}</Heading>
      <p className="text-base text-ink-body">{t("join.done.bodyEmail", vars)}</p>
    </Screen>
  );
}
