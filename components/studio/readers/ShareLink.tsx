"use client";

import { useState, useSyncExternalStore } from "react";
import type { Translate } from "./shared";

const noop = () => () => {};

/**
 * Tell the send log there was a share, best-effort — B2444 (W44's send log).
 * Never blocks the owner's own Copy or Share on this, and never throws into
 * the caller: a log row is nice to have, not a receipt the owner is waiting
 * on. `keepalive` so a share that ends with the tab closing (the share sheet
 * hands off to another app) still lands.
 */
function logShared(username: string, contactId: string | undefined): void {
  fetch(`/api/web/${encodeURIComponent(username)}/readers/shared`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(contactId ? { contactId } : {}),
    keepalive: true,
  }).catch(() => {});
}

/**
 * The owner's own invite, in their own words — B2444 (W44 D4: "owner shares
 * it themselves" is the preferred invite). A ready-made text in the owner's
 * language, editable above the link — the owner may reword it, Share and
 * Copy both use what is actually in the box — with Copy (text + URL
 * together) and, where the device has one, the system share sheet
 * (`navigator.share({ title, text, url })`, read through
 * `useSyncExternalStore` so the server render and hydration agree).
 * Fernscout never touches the words or the address here; `readers/shared`
 * only logs that a share happened.
 */
export default function ShareLink({
  username,
  contactId,
  url,
  title,
  text,
  t,
  big = false,
}: {
  username: string;
  /** The person this share was for, when the door knows one — a group link
   *  names nobody. */
  contactId?: string;
  url: string;
  /** The share sheet's own title field. */
  title: string;
  /** The ready-made, editable message — the owner's own words, in the
   *  owner's own language. */
  text: string;
  t: Translate;
  big?: boolean;
}) {
  const [message, setMessage] = useState(text);
  const [copied, setCopied] = useState<boolean | null>(null);
  const canShare = useSyncExternalStore(
    noop,
    () => typeof navigator.share === "function",
    () => false,
  );

  async function copy() {
    try {
      await navigator.clipboard.writeText(`${message}\n\n${url}`);
      setCopied(true);
      logShared(username, contactId);
    } catch {
      setCopied(false);
    }
  }

  async function share() {
    try {
      await navigator.share({ title, text: message, url });
      logShared(username, contactId);
    } catch {
      // Cancelled, or no target picked — not worth telling the owner about.
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1 text-sm font-semibold text-ink-strong">
        {t("readers.share.editLabel")}
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={3}
          maxLength={500}
          className="mt-1 min-h-20 w-full rounded-xl border border-line-strong bg-surface-raised px-3 py-2 text-base font-normal text-ink-strong"
        />
      </label>
      <code
        className={`break-all rounded-xl border border-line-strong bg-surface-base px-3 py-2 font-semibold text-ink-strong ${
          big ? "text-lg" : "text-sm"
        }`}
      >
        {url.replace(/^https?:\/\//, "")}
      </code>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={copy}
          className="min-h-11 rounded-xl bg-yellow-400 px-4 text-sm font-semibold text-navy-900 hover:bg-yellow-300"
        >
          {copied ? t("notifyStep.copied") : t("readers.link.copy")}
        </button>
        {canShare && (
          <button
            type="button"
            onClick={share}
            className="min-h-11 rounded-xl border border-line-strong bg-surface-raised px-4 text-sm font-semibold text-ink-strong hover:bg-surface-subtle"
          >
            {t("readers.link.share")}
          </button>
        )}
      </div>
      {copied === false && (
        <p role="alert" className="text-sm text-coral-600">
          {t("readers.copyFailed")}
        </p>
      )}
    </div>
  );
}
