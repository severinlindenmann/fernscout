"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, Camera, Heart, Mail, PenLine, Stamp, Users } from "lucide-react";
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
  SECONDARY,
  Ticks,
  WelcomeArt,
  type Address,
  type Tick,
} from "@/components/guide/GuideParts";
import { translate, type TranslationKey } from "@/lib/i18n";

type StepName = "welcome" | "code" | "what" | "check" | "address" | "notify";

/** What the owner typed, handed over only once the person proved it is them. */
export type GuideDetails = {
  name: string;
  email: string | null;
  phone: string | null;
  emailProven: boolean;
  phoneProven: boolean;
  address: Address;
  wantsEmailDigest: boolean;
  wantsWhatsapp: boolean;
  wantsSms: boolean;
  wantsPostcard: boolean;
};

export type GuideProps = {
  code: string;
  owner: string;
  title: string;
  ownerName: string;
  firstName: string;
  kind: "reader" | "buddy";
  trip: { id: string; title: string } | null;
  signedIn: boolean;
  /** Finished the guide before: only the code stands between them and the journal. */
  onboarded: boolean;
  /** Came through a group link and already gave their details there. */
  joined: boolean;
  /** Masked, for "to le•••@gmail.com" — never the address itself. */
  prove: { email: string | null; mobile: string | null; preferred: "email" | "sms" };
  details: GuideDetails | null;
  caps: { mail: boolean; sms: boolean; whatsapp: boolean; postcards: boolean };
  dictionary: Record<string, string>;
};

const ERRORS: Record<string, TranslationKey> = {
  rate_limited: "guide.error.rateLimited",
  invalid_code: "guide.error.code",
  unavailable: "guide.error.unavailable",
  no_channel: "guide.error.unavailable",
  invalid_phone: "guide.error.phone",
  invalid_email: "guide.error.email",
};

/**
 * `/w/<code>` — the welcome guide for a person the owner added (B2293, B2291
 * "What the person sees"): welcome · the code · what you can do · is this
 * right? · where postcards go · how we tell you. Runs once (`onboarded_at`).
 *
 * The page hands this nothing personal until the person proved the channel:
 * `details` is null before the code, and a forwarded link shows a first name
 * and a masked address at most.
 */
export default function WelcomeGuide(props: GuideProps) {
  const { code, owner, kind, trip, caps, joined, onboarded } = props;
  const router = useRouter();
  const t = (key: TranslationKey, vars?: Record<string, string>) => translate(props.dictionary, key, vars);
  const vars = { name: props.firstName, owner: props.ownerName, title: props.title, trip: trip?.title ?? "" };

  // The steps, fixed at first render so the dots do not jump once the code
  // is in and the page re-renders signed in.
  const [steps] = useState<StepName[]>(() => {
    const code: StepName[] = props.signedIn ? [] : ["code"];
    if (onboarded) return ["welcome", ...code];
    if (joined) return [...code, "what"];
    return ["welcome", ...code, "what", "check", ...(caps.postcards ? (["address"] as const) : []), "notify"];
  });
  const [step, setStep] = useState<StepName>(steps[0]);
  const index = steps.indexOf(step);
  const dots = { total: steps.length, current: index, label: t("guide.dots", { n: String(index + 1), total: String(steps.length) }) };
  const next = () => setStep(steps[index + 1] ?? step);
  const heading = useRef<string>("");
  useEffect(() => {
    // Moving on moves focus to the new screen's heading, so it is read out.
    if (heading.current && heading.current !== step) document.getElementById(`guide-${step}`)?.focus();
    heading.current = step;
  }, [step]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function call(body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/w/${encodeURIComponent(code)}/step`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
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

  function finish(to: string) {
    window.location.assign(to);
  }

  // ── 2 · the code ─────────────────────────────────────────────────────────
  const [channel, setChannel] = useState<"email" | "sms">(
    props.prove.preferred === "sms" && props.prove.mobile ? "sms" : props.prove.email ? "email" : "sms",
  );
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  const other: "email" | "sms" | null =
    channel === "email" ? (props.prove.mobile && caps.sms ? "sms" : null) : props.prove.email ? "email" : null;

  async function sendCode(using = channel) {
    const sent = await call({ action: "send", channel: using });
    if (sent) {
      setChannel(using);
      setSentTo(String(sent.to ?? ""));
      setTyped("");
    }
  }
  async function verify() {
    if (!(await call({ action: "verify", channel, code: typed }))) return;
    if (onboarded || steps.indexOf("code") === steps.length - 1) {
      finish(`/${owner}`);
      return;
    }
    router.refresh();
    next();
  }

  // ── 4 · is this right? ───────────────────────────────────────────────────
  const d = props.details;
  const [name, setName] = useState<string | null>(null);
  const [changing, setChanging] = useState(false);
  const missing: "email" | "sms" | null = !d ? null : !d.email ? "email" : !d.phone && caps.sms ? "sms" : null;
  const [proofValue, setProofValue] = useState("");
  const [proofSent, setProofSent] = useState<string | null>(null);
  const [proofCode, setProofCode] = useState("");

  async function sendProof() {
    const sent = await call({ action: "proof", kind: missing, value: proofValue });
    if (sent) setProofSent(String(sent.to ?? ""));
  }
  async function confirmProof() {
    if (await call({ action: "proof", kind: missing, value: proofValue, code: proofCode })) {
      setProofSent(null);
      router.refresh();
    }
  }
  async function saveCheck() {
    if (changing && name !== null && name.trim() && !(await call({ action: "save", name }))) return;
    setChanging(false);
    router.refresh();
    next();
  }

  // ── 5 · address ──────────────────────────────────────────────────────────
  const [address, setAddress] = useState<Address | null>(null);
  const shownAddress = address ?? d?.address ?? EMPTY;
  const hasAddress = Boolean(shownAddress.line1.trim() && shownAddress.city.trim() && shownAddress.country.trim());
  async function saveAddress() {
    if (!hasAddress) {
      setError(t("guide.address.incomplete"));
      return;
    }
    if (await call({ action: "save", address: shownAddress })) {
      router.refresh();
      next();
    }
  }

  // ── 6 · how we tell you ─────────────────────────────────────────────────
  const [wants, setWants] = useState<Record<string, boolean> | null>(null);
  const current = wants ?? {
    wantsEmailDigest: d?.wantsEmailDigest || Boolean(d?.email),
    wantsWhatsapp: d?.wantsWhatsapp ?? false,
    wantsSms: d?.wantsSms ?? false,
    wantsPostcard: d?.wantsPostcard || hasAddress,
  };
  const postalLine = hasAddress ? `${shownAddress.line1}, ${shownAddress.city}` : "";
  const ticks: Tick[] = [
    caps.mail && {
      key: "wantsEmailDigest",
      label: t("guide.notify.email"),
      hint: d?.email ?? t("guide.notify.needsEmail"),
      checked: current.wantsEmailDigest,
      disabled: !d?.email,
    },
    caps.whatsapp && {
      key: "wantsWhatsapp",
      label: t("guide.notify.whatsapp"),
      hint: d?.phone ?? t("guide.notify.needsMobile"),
      checked: current.wantsWhatsapp,
      disabled: !d?.phone,
    },
    caps.sms && {
      key: "wantsSms",
      label: t("guide.notify.sms"),
      hint: d?.phone ?? t("guide.notify.needsMobile"),
      checked: current.wantsSms,
      disabled: !d?.phone,
    },
    caps.postcards && {
      key: "wantsPostcard",
      label: t("guide.notify.postcards"),
      hint: hasAddress ? t("guide.notify.postcardsTo", { address: postalLine }) : t("guide.notify.needsAddress"),
      checked: current.wantsPostcard,
      disabled: !hasAddress,
    },
  ].filter((tick): tick is Tick => Boolean(tick));

  /** The last press: save the ticks (only where this guide asked them —
   * somebody who joined by a link chose theirs there) and mark it done. */
  async function done(to: string) {
    const choices = step === "notify" ? Object.fromEntries(ticks.map((tick) => [tick.key, tick.checked && !tick.disabled])) : {};
    if (await call({ action: "save", ...choices, done: true })) finish(to);
  }

  // ── the screens ─────────────────────────────────────────────────────────
  const tile = (Icon: typeof Heart, title: string, body: string, tone: string) => (
    <li key={title} className="flex items-start gap-3 rounded-2xl border border-line-quiet bg-surface-raised p-3">
      <span className={`grid size-12 shrink-0 place-items-center rounded-xl ${tone}`}>
        <Icon className="size-6 text-navy-900" aria-hidden />
      </span>
      <span>
        <span className="block font-semibold text-ink-strong">{title}</span>
        <span className="block text-sm text-ink-secondary">{body}</span>
      </span>
    </li>
  );

  if (step === "welcome") {
    return (
      <Screen
        labelledBy="guide-welcome"
        dots={dots}
        footer={
          <button type="button" className={PRIMARY} onClick={next}>
            {t("guide.welcome.go")}
          </button>
        }
      >
        <WelcomeArt />
        <Heading id="guide-welcome" big>
          {kind === "buddy" ? t("guide.welcome.buddyTitle", vars) : t("guide.welcome.readerTitle", vars)}
        </Heading>
        <p className="text-lg text-ink-body">
          {kind === "buddy" && trip ? t("guide.welcome.buddyBody", vars) : t("guide.welcome.readerBody", vars)}
        </p>
      </Screen>
    );
  }

  if (step === "code") {
    const to = channel === "email" ? props.prove.email : props.prove.mobile;
    return (
      <Screen
        labelledBy="guide-code"
        dots={dots}
        footer={
          sentTo ? (
            <BusyButton busy={busy} type="button" className={PRIMARY} disabled={typed.length !== 6} onClick={verify}>
              {t("guide.code.confirm")}
            </BusyButton>
          ) : (
            <BusyButton busy={busy} type="button" className={PRIMARY} disabled={!to} onClick={() => sendCode()}>
              {t("guide.code.send")}
            </BusyButton>
          )
        }
      >
        <CodeArt />
        <Heading id="guide-code">{sentTo ? t("guide.code.sentTitle") : t("guide.code.title")}</Heading>
        <p className="text-base text-ink-body">
          {to
            ? t(channel === "email" ? "guide.code.toEmail" : "guide.code.toMobile", { to: sentTo || to })
            : t("guide.error.unavailable")}{" "}
          {kind === "buddy" ? t("guide.code.whyBuddy") : t("guide.code.why")}
        </p>
        {sentTo && <CodeField id="guide-code-input" label={t("guide.code.label")} value={typed} onChange={setTyped} />}
        <Alert text={error} />
        {sentTo && (
          <button type="button" className={QUIET} disabled={busy} onClick={() => sendCode()}>
            {t("guide.code.again")}
          </button>
        )}
        {other && (
          <button type="button" className={QUIET} disabled={busy} onClick={() => sendCode(other)}>
            {t(other === "sms" ? "guide.code.useSms" : "guide.code.useEmail")}
          </button>
        )}
      </Screen>
    );
  }

  if (step === "what") {
    const last = steps.indexOf("what") === steps.length - 1;
    return (
      <Screen
        labelledBy="guide-what"
        dots={dots}
        footer={
          <BusyButton busy={busy} type="button" className={PRIMARY} onClick={() => (last ? done(`/${owner}`) : next())}>
            {last ? t("guide.notify.open") : t("guide.what.go")}
          </BusyButton>
        }
      >
        <Heading id="guide-what">{kind === "buddy" ? t("guide.what.buddyTitle") : t("guide.what.readerTitle")}</Heading>
        <ul className="flex flex-col gap-2">
          {kind === "buddy"
            ? [
                tile(Camera, t("guide.what.photos"), t("guide.what.photosBody", vars), "bg-cream-100"),
                tile(PenLine, t("guide.what.write"), t("guide.what.writeBody", vars), "bg-green-100"),
                tile(BookOpen, t("guide.what.readAll"), t("guide.what.readAllBody"), "bg-surface-subtle"),
                tile(Users, t("guide.what.byline"), t("guide.what.bylineBody"), "bg-cream-100"),
              ]
            : [
                tile(BookOpen, t("guide.what.read"), t("guide.what.readBody"), "bg-cream-100"),
                tile(Heart, t("guide.what.heart"), t("guide.what.heartBody", vars), "bg-green-100"),
                tile(Mail, t("guide.what.hear"), t("guide.what.hearBody"), "bg-surface-subtle"),
                ...(caps.postcards ? [tile(Stamp, t("guide.what.postcard"), t("guide.what.postcardBody"), "bg-cream-100")] : []),
              ]}
        </ul>
        <p className="text-sm text-ink-secondary">
          {kind === "buddy" ? t("guide.what.buddyLimits", vars) : t("guide.what.readerLimits")}
        </p>
        <Alert text={error} />
      </Screen>
    );
  }

  if (step === "check") {
    const row = (label: string, value: React.ReactNode, extra?: React.ReactNode) => (
      <div className="flex flex-col gap-1 rounded-2xl border border-line-quiet bg-surface-raised p-4">
        <span className="text-xs font-bold uppercase tracking-wide text-ink-secondary">{label}</span>
        <span className="break-words text-base font-semibold text-ink-strong">{value}</span>
        {extra}
      </div>
    );
    const proven = <span className="text-sm font-semibold text-green-700">{t("guide.check.proven")}</span>;
    return (
      <Screen
        labelledBy="guide-check"
        dots={dots}
        footer={
          <>
            <BusyButton busy={busy} type="button" className={PRIMARY} disabled={!d} onClick={saveCheck}>
              {t("guide.check.next")}
            </BusyButton>
            {missing && (
              <button type="button" className={QUIET} onClick={next}>
                {t(missing === "sms" ? "guide.check.skipMobile" : "guide.check.skipEmail")}
              </button>
            )}
          </>
        }
      >
        <Heading id="guide-check">{t("guide.check.title", vars)}</Heading>
        <p className="text-base text-ink-secondary">{t("guide.check.body")}</p>
        {!d ? (
          <p className="text-sm text-ink-secondary">{t("notifyStep.loading")}</p>
        ) : (
          <>
            {row(
              t("guide.check.name"),
              changing ? (
                <input
                  aria-label={t("guide.check.name")}
                  className={FIELD}
                  value={name ?? d.name}
                  maxLength={120}
                  onChange={(e) => setName(e.target.value)}
                />
              ) : (
                (name ?? d.name)
              ),
              !changing && (
                <div className="mt-1 flex gap-2">
                  <span className="inline-flex min-h-11 items-center rounded-xl border-2 border-green-700 bg-green-100 px-3 text-sm font-semibold text-green-700">
                    {t("guide.check.right")}
                  </span>
                  <button type="button" className="min-h-11 rounded-xl border border-line-strong px-3 text-sm font-semibold text-ink-strong" onClick={() => setChanging(true)}>
                    {t("guide.check.change")}
                  </button>
                </div>
              ),
            )}
            {d.email && row(t("guide.check.email"), d.email, d.emailProven && proven)}
            {d.phone && row(t("guide.check.mobile"), d.phone, d.phoneProven && proven)}
            {missing && (
              <div className="flex flex-col gap-2 rounded-2xl border-2 border-yellow-400 bg-surface-raised p-4">
                <span className="text-xs font-bold uppercase tracking-wide text-ink-secondary">
                  {t(missing === "sms" ? "guide.check.mobileMissing" : "guide.check.emailMissing")}
                </span>
                <label className={LABEL}>
                  {t(missing === "sms" ? "guide.check.mobileWhy" : "guide.check.emailWhy", vars)}
                  <input
                    className={FIELD}
                    type={missing === "sms" ? "tel" : "email"}
                    inputMode={missing === "sms" ? "tel" : "email"}
                    autoComplete={missing === "sms" ? "tel" : "email"}
                    value={proofValue}
                    onChange={(e) => setProofValue(e.target.value)}
                  />
                </label>
                <span className="text-sm text-ink-secondary">{t(missing === "sms" ? "guide.check.mobileHint" : "guide.check.emailHint")}</span>
                {proofSent ? (
                  <>
                    <CodeField id="guide-proof-code" label={t("guide.code.label")} value={proofCode} onChange={setProofCode} />
                    <BusyButton busy={busy} type="button" className={SECONDARY} disabled={proofCode.length !== 6} onClick={confirmProof}>
                      {t("guide.code.confirm")}
                    </BusyButton>
                  </>
                ) : (
                  <BusyButton busy={busy} type="button" className={SECONDARY} disabled={!proofValue.trim()} onClick={sendProof}>
                    {t("guide.check.sendProof")}
                  </BusyButton>
                )}
              </div>
            )}
          </>
        )}
        <Alert text={error} />
      </Screen>
    );
  }

  if (step === "address") {
    return (
      <Screen
        labelledBy="guide-address"
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
        <Heading id="guide-address">{t("guide.address.title")}</Heading>
        <p className="text-base text-ink-body">
          {kind === "buddy" ? t("guide.address.buddyBody", vars) : t("guide.address.body", vars)}
        </p>
        <AddressFields
          value={shownAddress}
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

  // notify
  return (
    <Screen
      labelledBy="guide-notify"
      dots={dots}
      footer={
        kind === "buddy" && trip ? (
          <>
            <BusyButton busy={busy} type="button" className={PRIMARY} onClick={() => done(`/${owner}/trips/${trip.id}`)}>
              {t("guide.notify.openTrip", vars)}
            </BusyButton>
            <BusyButton busy={busy} type="button" className={SECONDARY} onClick={() => done(`/${owner}`)}>
              {t("guide.notify.justRead")}
            </BusyButton>
          </>
        ) : (
          <BusyButton busy={busy} type="button" className={PRIMARY} onClick={() => done(`/${owner}`)}>
            {t("guide.notify.open")}
          </BusyButton>
        )
      }
    >
      <Heading id="guide-notify">{kind === "buddy" ? t("guide.notify.buddyTitle") : t("guide.notify.title")}</Heading>
      <p className="text-base text-ink-secondary">{t("guide.notify.body")}</p>
      {ticks.length ? (
        <Ticks ticks={ticks} onChange={(key, checked) => setWants({ ...current, [key]: checked })} />
      ) : (
        <p className="text-sm text-ink-secondary">{t("guide.notify.none")}</p>
      )}
      <Alert text={error} />
    </Screen>
  );
}

