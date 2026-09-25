"use client";

import { useEffect, useRef, useState } from "react";
import BusyButton from "@/components/BusyButton";
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
  type Tick,
} from "@/components/guide/GuideParts";
import { translate, type TranslationKey } from "@/lib/i18n";

type Step = "who" | "reach" | "code" | "address" | "notify" | "done";

const ERRORS: Record<string, TranslationKey> = {
  rate_limited: "guide.error.rateLimited",
  invalid_code: "guide.error.code",
  unavailable: "guide.error.unavailable",
  invalid_phone: "guide.error.phone",
  invalid_email: "guide.error.email",
  invalid_name: "join.error.name",
  expired: "join.error.expired",
};

/**
 * `/j/<code>` — somebody opened a group link (B2293, B2291 "Group-link
 * visitor"): whose journal · name · email or mobile · the code · where
 * postcards go · how to hear · "You're on the list". Nobody is let in here;
 * the owner decides.
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
}) {
  const t = (key: TranslationKey, vars?: Record<string, string>) => translate(dictionary, key, vars);
  const vars = { owner: ownerName, title, trip: tripTitle ?? "" };
  const [steps] = useState<Step[]>(() => [
    "who",
    ...(knownEmail ? [] : (["reach", "code"] as const)),
    ...(caps.postcards ? (["address"] as const) : []),
    "notify",
    "done",
  ]);
  const [step, setStep] = useState<Step>("who");
  const index = steps.indexOf(step);
  const dots = { total: steps.length - 1, current: index, label: t("guide.dots", { n: String(index + 1), total: String(steps.length - 1) }) };
  const next = () => setStep(steps[index + 1] ?? step);
  const seen = useRef<Step>("who");
  useEffect(() => {
    if (seen.current !== step) document.getElementById(`join-${step}`)?.focus();
    seen.current = step;
  }, [step]);

  const [name, setName] = useState("");
  const [channel, setChannel] = useState<"email" | "sms">(caps.mail ? "email" : "sms");
  const [value, setValue] = useState("");
  const [sentTo, setSentTo] = useState("");
  const [typed, setTyped] = useState("");
  const [address, setAddress] = useState<Address>(EMPTY);
  const [status, setStatus] = useState<"in" | "waiting">("waiting");
  const [wants, setWants] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/j/${encodeURIComponent(code)}/step`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, locale, channel, value, ...body }),
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

  async function afterWho() {
    if (!name.trim()) {
      setError(t("join.error.name"));
      return;
    }
    if (!knownEmail) return next();
    const joined = await call({ action: "join" });
    if (joined) {
      setStatus(joined.status === "in" ? "in" : "waiting");
      next();
    }
  }
  async function send() {
    const sent = await call({ action: "send" });
    if (sent) {
      setSentTo(String(sent.to ?? value));
      setTyped("");
      setStep("code");
    }
  }
  async function verify() {
    const proved = await call({ action: "verify", code: typed });
    if (proved) {
      setStatus(proved.status === "in" ? "in" : "waiting");
      next();
    }
  }
  const hasAddress = Boolean(address.line1.trim() && address.city.trim() && address.country.trim());
  async function saveAddress() {
    if (!hasAddress) {
      setError(t("guide.address.incomplete"));
      return;
    }
    if (await call({ action: "save", address })) next();
  }

  const provedEmail = knownEmail ?? (channel === "email" ? sentTo : null);
  const provedMobile = channel === "sms" && !knownEmail ? sentTo : null;
  const ticks: Tick[] = [
    caps.mail && {
      key: "wantsEmailDigest",
      label: t("guide.notify.email"),
      hint: provedEmail || t("guide.notify.needsEmail"),
      checked: wants.wantsEmailDigest ?? Boolean(provedEmail),
      disabled: !provedEmail,
    },
    caps.whatsapp && {
      key: "wantsWhatsapp",
      label: t("guide.notify.whatsapp"),
      hint: provedMobile || t("guide.notify.needsMobile"),
      checked: wants.wantsWhatsapp ?? false,
      disabled: !provedMobile,
    },
    caps.sms && {
      key: "wantsSms",
      label: t("guide.notify.sms"),
      hint: provedMobile || t("guide.notify.needsMobile"),
      checked: wants.wantsSms ?? false,
      disabled: !provedMobile,
    },
    caps.postcards && {
      key: "wantsPostcard",
      label: t("guide.notify.postcards"),
      hint: hasAddress ? t("guide.notify.postcardsTo", { address: `${address.line1}, ${address.city}` }) : t("guide.notify.needsAddress"),
      checked: wants.wantsPostcard ?? hasAddress,
      disabled: !hasAddress,
    },
  ].filter((tick): tick is Tick => Boolean(tick));

  async function saveTicks() {
    const choices = Object.fromEntries(ticks.map((tick) => [tick.key, tick.checked && !tick.disabled]));
    if (await call({ action: "save", ...choices })) next();
  }

  if (step === "who") {
    return (
      <Screen
        labelledBy="join-who"
        dots={dots}
        footer={
          <BusyButton busy={busy} type="button" className={PRIMARY} onClick={afterWho}>
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
        {knownEmail && <p className="text-sm text-ink-secondary">{t("join.who.signedIn", { email: knownEmail })}</p>}
        <Alert text={error} />
      </Screen>
    );
  }

  if (step === "reach") {
    const tabs = [caps.mail && ("email" as const), caps.sms && ("sms" as const)].filter(Boolean) as ("email" | "sms")[];
    return (
      <Screen
        labelledBy="join-reach"
        dots={dots}
        footer={
          <BusyButton busy={busy} type="button" className={PRIMARY} disabled={!value.trim() || tabs.length === 0} onClick={send}>
            {t("join.reach.send")}
          </BusyButton>
        }
      >
        <Heading id="join-reach">{t("join.reach.title", vars)}</Heading>
        {tabs.length > 1 && (
          <div role="tablist" aria-label={t("join.reach.title", vars)} className="grid grid-cols-2 gap-1 rounded-2xl bg-surface-subtle p-1">
            {tabs.map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                aria-selected={channel === tab}
                className={`min-h-11 rounded-xl text-base font-semibold ${channel === tab ? "bg-surface-raised text-ink-strong shadow-sm" : "text-ink-secondary"}`}
                onClick={() => {
                  setChannel(tab);
                  setValue("");
                  setError(null);
                }}
              >
                {t(tab === "email" ? "join.reach.email" : "join.reach.mobile")}
              </button>
            ))}
          </div>
        )}
        {tabs.length === 0 ? (
          <p className="text-base text-ink-body">{t("guide.error.unavailable")}</p>
        ) : (
          <label className={LABEL}>
            {t(channel === "email" ? "join.reach.emailLabel" : "join.reach.mobileLabel")}
            <input
              className={FIELD}
              type={channel === "email" ? "email" : "tel"}
              inputMode={channel === "email" ? "email" : "tel"}
              autoComplete={channel === "email" ? "email" : "tel"}
              placeholder={channel === "email" ? "name@example.com" : "+41 79 …"}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </label>
        )}
        <p className="text-sm text-ink-secondary">{t(tabs.includes("sms") ? "join.reach.hint" : "join.reach.hintEmail")}</p>
        <Alert text={error} />
      </Screen>
    );
  }

  if (step === "code") {
    return (
      <Screen
        labelledBy="join-code"
        dots={dots}
        footer={
          <BusyButton busy={busy} type="button" className={PRIMARY} disabled={typed.length !== 6} onClick={verify}>
            {t("guide.code.confirm")}
          </BusyButton>
        }
      >
        <CodeArt />
        <Heading id="join-code">{t(channel === "email" ? "join.code.inbox" : "join.code.phone")}</Heading>
        <p className="text-base text-ink-body">{t(channel === "email" ? "join.code.bodyEmail" : "join.code.bodySms", { to: sentTo })}</p>
        <CodeField id="join-code-input" label={t("guide.code.label")} value={typed} onChange={setTyped} />
        <Alert text={error} />
        <button type="button" className={QUIET} onClick={() => setStep("reach")}>
          {t("join.code.change")}
        </button>
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
            <button type="button" className={QUIET} onClick={next}>
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
          labels={{
            street: t("guide.address.street"),
            postcode: t("guide.address.postcode"),
            city: t("guide.address.city"),
            country: t("guide.address.country"),
          }}
        />
        <p className="text-sm text-ink-secondary">{t("guide.address.private", vars)}</p>
        <Alert text={error} />
      </Screen>
    );
  }

  if (step === "notify") {
    return (
      <Screen
        labelledBy="join-notify"
        dots={dots}
        footer={
          <BusyButton busy={busy} type="button" className={PRIMARY} onClick={saveTicks}>
            {t("join.notify.send")}
          </BusyButton>
        }
      >
        <Heading id="join-notify">{t("guide.notify.title")}</Heading>
        <p className="text-base text-ink-secondary">{t("join.notify.body", vars)}</p>
        {ticks.length ? (
          <Ticks ticks={ticks} onChange={(key, checked) => setWants({ ...wants, [key]: checked })} />
        ) : (
          <p className="text-sm text-ink-secondary">{t("guide.notify.none")}</p>
        )}
        <Alert text={error} />
      </Screen>
    );
  }

  return (
    <Screen
      labelledBy="join-done"
      footer={
        status === "in" ? (
          <a href={`/${owner}`} className={`${PRIMARY} grid place-items-center text-center`}>
            {t("guide.notify.open")}
          </a>
        ) : null
      }
    >
      <WaitingArt />
      <Heading id="join-done">{status === "in" ? t("join.done.inTitle") : t("join.done.title")}</Heading>
      <p className="text-base text-ink-body">
        {status === "in"
          ? t("join.done.inBody", vars)
          : t(channel === "sms" && !knownEmail ? "join.done.bodySms" : "join.done.bodyEmail", vars)}
      </p>
    </Screen>
  );
}
