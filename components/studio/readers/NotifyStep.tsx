"use client";

import { useEffect, useState } from "react";
import BusyButton from "@/components/BusyButton";
import { useI18n } from "@/components/LocaleProvider";
import type { TranslationKey } from "@/lib/i18n";
import { formatCredits } from "@/lib/creditsFormat";

type Channel = "email" | "whatsapp" | "sms" | "self";
type Block = "no_email" | "no_mobile" | "mail_off" | "whatsapp_off" | "sms_off" | "unreachable" | "link_lost";

/** `GET /api/web/<user>/readers/notify` — `InviteOptions` in lib/contacts/welcome.ts. */
type Options = {
  name: string | null;
  url: string | null;
  to: { email: string | null; mobile: string | null };
  channels: { channel: Channel; cost: number; blocked: Block | null; preview: string }[];
  balance: number | null;
  creditPrice: string | null;
  opened: boolean;
};

type Sent = { channel: Channel; url: string; backend: string | null; charged: number; balance: number | null };

const LABEL: Record<Channel, TranslationKey> = {
  email: "notifyStep.email",
  whatsapp: "notifyStep.whatsapp",
  sms: "notifyStep.sms",
  self: "notifyStep.self",
};
const SEND: Record<Channel, TranslationKey> = {
  email: "notifyStep.send.email",
  whatsapp: "notifyStep.send.whatsapp",
  sms: "notifyStep.send.sms",
  self: "notifyStep.send.self",
};
const BLOCK: Record<Block, TranslationKey> = {
  no_email: "notifyStep.blocked.noEmail",
  no_mobile: "notifyStep.blocked.noMobile",
  mail_off: "notifyStep.blocked.mailOff",
  whatsapp_off: "notifyStep.blocked.whatsappOff",
  sms_off: "notifyStep.blocked.smsOff",
  unreachable: "notifyStep.blocked.unreachable",
  link_lost: "notifyStep.blocked.linkLost",
};
const ERROR: Record<string, TranslationKey> = {
  no_credits: "notifyStep.error.noCredits",
  rate_limited: "notifyStep.error.rateLimited",
  daily_limit: "notifyStep.error.dailyLimit",
  link_lost: "notifyStep.linkLost",
  send_failed: "notifyStep.error.sendFailed",
  already_opened: "notifyStep.opened",
};
/** Transports that write the message to a local file instead of sending it. */
const LOCAL_BACKENDS = new Set(["dry-run", "file", "console"]);

const PILL = "ml-auto shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold";
const FREE_PILL = `${PILL} bg-green-100 text-green-700`;
const PAID_PILL = `${PILL} bg-yellow-400 text-navy-900`;
const PRIMARY =
  "min-h-12 rounded-xl bg-yellow-400 px-5 text-base font-semibold text-navy-900 transition-colors hover:bg-yellow-300 disabled:opacity-50";

/**
 * Step 2 of "Add a person" — how the person hears about it (B2292, B2291
 * "Two doors"). Self-contained on purpose: B2291 mounts it in the rebuilt
 * Readers page, and every card's "Resend" can mount it again for the same
 * contact.
 *
 * Nothing is charged until the owner presses the button, and the button says
 * what it costs. Afterwards it says what actually happened — "sent" only when
 * a transport accepted the message, and plainly that nothing left the
 * machine when this server only writes messages to a file.
 */
export default function NotifyStep({
  username,
  contactId,
  onLater,
}: {
  username: string;
  contactId: string;
  /** "Not now — decide later", and "Done" after sending. */
  onLater?: () => void;
}) {
  const { t, tn } = useI18n();
  const url = `/api/web/${encodeURIComponent(username)}/readers/notify`;
  const [options, setOptions] = useState<Options | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [choice, setChoice] = useState<Channel | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<Sent | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`${url}?contactId=${encodeURIComponent(contactId)}`)
      .then((r) => (r.ok ? (r.json() as Promise<Options>) : Promise.reject(new Error(String(r.status)))))
      .then((data) => {
        if (cancelled) return;
        setOptions(data);
        const first = data.opened ? undefined : data.channels.find((c) => !c.blocked && c.channel !== "self");
        setChoice(first?.channel ?? "self");
      })
      .catch(() => !cancelled && setLoadFailed(true));
    return () => {
      cancelled = true;
    };
  }, [url, contactId]);

  if (loadFailed) return <p role="alert" className="mt-4 text-sm text-coral-600">{t("notifyStep.error.generic")}</p>;
  if (!options || !choice) return <p className="mt-4 text-sm text-ink-secondary">{t("notifyStep.loading")}</p>;

  const name = options.name?.trim() || t("notifyStep.them");
  // Shown once already, on a server that kept only its hash: say so, send nothing.
  if (!options.url) return <p className="mt-4 text-sm text-ink-body">{t("notifyStep.linkLost", { name })}</p>;
  const costText = (cost: number) =>
    cost === 0 ? t("notifyStep.free") : tn("notifyStep.credits", cost, { count: String(cost) });

  async function copy(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  if (sent) {
    const local = sent.backend !== null && LOCAL_BACKENDS.has(sent.backend);
    const title =
      sent.channel === "self"
        ? t("notifyStep.selfTitle", { name })
        : local
          ? t("notifyStep.dryRunTitle")
          : t("notifyStep.sentTitle", { name });
    return (
      <section className="mt-4 rounded-2xl border border-line-quiet bg-surface-raised p-5" aria-live="polite">
        <h3 className="font-display text-lg font-semibold text-ink-strong">{title}</h3>
        {sent.channel !== "self" && (
          <p className="mt-2 text-sm text-ink-body">
            {local ? t("notifyStep.dryRunBody") : t("notifyStep.accepted", { channel: t(LABEL[sent.channel]) })}
            {sent.charged > 0 &&
              ` ${t("notifyStep.charged", {
                spent: tn("notifyStep.credits", sent.charged, { count: String(sent.charged) }),
                balance: formatCredits(sent.balance ?? 0),
              })}`}
          </p>
        )}
        <p className="mt-4 text-xs font-semibold uppercase tracking-wide text-ink-secondary">
          {t("notifyStep.linkLabel", { name })}
        </p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 break-all rounded-lg border border-line-strong bg-surface-base px-3 py-2 text-sm text-ink-strong">
            {sent.url}
          </code>
          <button
            type="button"
            onClick={() => copy(sent.url)}
            className="min-h-11 rounded-xl border border-line-strong px-4 text-sm font-semibold text-ink-strong hover:bg-surface-subtle"
          >
            {copied ? t("notifyStep.copied") : t("notifyStep.copy")}
          </button>
        </div>
        <p className="mt-3 text-sm text-ink-body">{t("notifyStep.next", { name })}</p>
        {onLater && (
          <button
            type="button"
            onClick={onLater}
            className="mt-4 text-sm font-semibold text-ink-strong underline underline-offset-2"
          >
            {t("notifyStep.done")}
          </button>
        )}
      </section>
    );
  }

  const selected = options.channels.find((c) => c.channel === choice)!;
  const paidOffered = options.balance !== null && options.channels.some((c) => c.cost > 0 && !c.blocked);
  const short = options.balance !== null && selected.cost > options.balance;
  const to = (channel: Channel) =>
    channel === "email" ? options.to.email : channel === "self" ? null : options.to.mobile;

  async function send() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contactId, channel: choice }),
      });
      const json = (await res.json().catch(() => null)) as (Sent & { ok?: boolean; error?: string; balance?: number | null }) | null;
      if (!res.ok || !json?.ok) {
        const key = ERROR[json?.error ?? ""] ?? "notifyStep.error.generic";
        setError(t(key, { name, balance: formatCredits(json?.balance ?? options?.balance ?? 0) }));
        return;
      }
      setSent(json);
    } catch {
      setError(t("notifyStep.error.generic"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-4" aria-labelledby="notify-step-heading">
      <p className="text-xs font-bold uppercase tracking-wide text-ink-secondary">{t("notifyStep.step")}</p>
      <h3 id="notify-step-heading" className="mt-1 font-display text-lg font-semibold text-ink-strong">
        {t("notifyStep.heading", { name })}
      </h3>
      {options.opened && <p className="mt-2 text-sm text-ink-body">{t("notifyStep.opened", { name })}</p>}

      <fieldset className="mt-3 flex flex-col gap-2" aria-labelledby="notify-step-heading">
        {options.channels.map(({ channel, cost, blocked }) => {
          const off = blocked !== null || (options.opened && channel !== "self");
          const on = choice === channel;
          const address = to(channel);
          return (
            <label
              key={channel}
              className={`flex items-start gap-3 rounded-xl border p-3 ${
                on ? "border-2 border-ink-strong bg-surface-subtle" : "border-line-quiet bg-surface-raised"
              } ${off ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
            >
              <input
                type="radio"
                name={`notify-${contactId}`}
                className="mt-1 size-4"
                checked={on}
                disabled={off}
                onChange={() => setChoice(channel)}
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-semibold text-ink-strong">{t(LABEL[channel])}</span>
                <span className="block text-xs text-ink-secondary">
                  {blocked
                    ? t(BLOCK[blocked])
                    : channel === "self"
                      ? t("notifyStep.selfHint")
                      : address
                        ? t("notifyStep.to", { to: address })
                        : null}
                </span>
              </span>
              <span className={cost > 0 ? PAID_PILL : FREE_PILL}>{costText(cost)}</span>
            </label>
          );
        })}
      </fieldset>

      {choice !== "self" && (
        <div className="mt-4 rounded-xl border border-line-quiet bg-surface-subtle p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-secondary">
            {t("notifyStep.previewLabel", { name })}
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-ink-body">{selected.preview}</p>
        </div>
      )}

      {paidOffered && (
        <p className="mt-3 text-xs text-ink-body">
          {options.creditPrice
            ? t("notifyStep.creditNote", { price: options.creditPrice, balance: formatCredits(options.balance ?? 0) })
            : t("notifyStep.creditNoteNoPrice", { balance: formatCredits(options.balance ?? 0) })}
        </p>
      )}
      {short && (
        <p role="alert" className="mt-2 text-sm text-coral-600">
          {t("notifyStep.error.noCredits", { balance: formatCredits(options.balance ?? 0) })}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm text-coral-600">
          {error}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-4">
        <BusyButton busy={busy} type="button" onClick={send} disabled={short} className={PRIMARY}>
          {choice === "self" ? t(SEND.self) : `${t(SEND[choice])} · ${costText(selected.cost)}`}
        </BusyButton>
        {onLater && (
          <button
            type="button"
            onClick={onLater}
            className="text-sm font-semibold text-ink-strong underline underline-offset-2"
          >
            {t("notifyStep.later")}
          </button>
        )}
      </div>
    </section>
  );
}
