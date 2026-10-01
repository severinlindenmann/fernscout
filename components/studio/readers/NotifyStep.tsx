"use client";

import { useEffect, useState } from "react";
import BusyButton from "@/components/BusyButton";
import { useI18n } from "@/components/LocaleProvider";
import type { TranslationKey } from "@/lib/i18n";
import ShareLink from "./ShareLink";

// B2597: SMS retired as an invite channel — readers sign in by email only.
type Channel = "email" | "self";
type Block = "no_email" | "mail_off" | "link_lost";

/** `GET /api/web/<user>/readers/notify` — `InviteOptions` in lib/contacts/welcome.ts.
 *  Every channel is free since B2597 (SMS, the one paid channel, is
 *  retired) — `cost`/`charged` stay on the wire so an older client reads a
 *  plain `0` rather than a missing field, but nothing here prices anything
 *  any more. */
type Options = {
  name: string | null;
  url: string | null;
  to: { email: string | null; mobile: string | null };
  channels: { channel: Channel; cost: number; blocked: Block | null; preview: string }[];
  opened: boolean;
};

type Sent = { channel: Channel; url: string; backend: string | null; charged: number };

const LABEL: Record<Channel, TranslationKey> = {
  email: "notifyStep.email",
  self: "notifyStep.self",
};
const SEND: Record<Channel, TranslationKey> = {
  email: "notifyStep.send.email",
  self: "notifyStep.send.self",
};
const BLOCK: Record<Block, TranslationKey> = {
  no_email: "notifyStep.blocked.noEmail",
  mail_off: "notifyStep.blocked.mailOff",
  link_lost: "notifyStep.blocked.linkLost",
};
const ERROR: Record<string, TranslationKey> = {
  rate_limited: "notifyStep.error.rateLimited",
  daily_limit: "notifyStep.error.dailyLimit",
  link_lost: "notifyStep.linkLost",
  send_failed: "notifyStep.error.sendFailed",
  already_opened: "notifyStep.opened",
};
/** Transports that write the message to a local file instead of sending it. */
const LOCAL_BACKENDS = new Set(["dry-run", "file", "console"]);

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
  journalTitle = username,
  siteName = "Fernscout",
}: {
  username: string;
  contactId: string;
  /** "Not now — decide later", and "Done" after sending. */
  onLater?: () => void;
  /** The journal's own title — B2444's share text's "{trip}". */
  journalTitle?: string;
  siteName?: string;
}) {
  const { t } = useI18n();
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
        // B2444 (D4) — sharing it yourself is the preferred invite, so the
        // first unblocked channel wins the default; `self` is never blocked
        // and sorts first in `INVITE_CHANNELS`, so it is the default unless
        // the link was already opened (nothing left to send at all then).
        const first = data.opened ? undefined : data.channels.find((c) => !c.blocked);
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
          </p>
        )}
        {sent.channel === "self" ? (
          <div className="mt-4">
            <ShareLink
              username={username}
              contactId={contactId}
              url={sent.url}
              title={journalTitle}
              text={t("readers.share.text", { trip: journalTitle, site: siteName })}
              t={t}
            />
          </div>
        ) : (
          <>
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
          </>
        )}
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
      const json = (await res.json().catch(() => null)) as (Sent & { ok?: boolean; error?: string }) | null;
      if (!res.ok || !json?.ok) {
        const key = ERROR[json?.error ?? ""] ?? "notifyStep.error.generic";
        setError(t(key, { name }));
        return;
      }
      // no-refresh: this step stays open to show what was sent; both callers
      // (ReaderCard, AddPersonDoor) wire `onLater` — pressed next, whether to
      // decline or once this screen's "Done" is pressed — to their own
      // router.refresh(), which is when the page behind this step needs to
      // be current, not mid-step.
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
        {options.channels.map(({ channel, blocked }) => {
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

      {error && (
        <p role="alert" className="mt-2 text-sm text-coral-600">
          {error}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-4">
        <BusyButton busy={busy} type="button" onClick={send} className={PRIMARY}>
          {t(SEND[choice])}
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
