"use client";

import { useState } from "react";
import BusyButton from "@/components/BusyButton";

/**
 * The operator writes one SMS — B1316. English like the rest of /admin, and
 * no `window.confirm` (AGENTS.md; `test/no-browser-dialogs.test.ts`): the
 * outcome is a line under the form, with the provider's own refusal where
 * there is one. The list above it is server-rendered, so a sent message
 * appears there on the next load rather than being faked into it here.
 */
export default function SmsSend({ initialTo = "" }: { initialTo?: string }) {
  const [to, setTo] = useState(initialTo);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setSaid(null);
    try {
      const response = await fetch("/api/admin/sms", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to, body }),
      });
      const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (response.ok) {
        setSaid({
          ok: true,
          text:
            json.backend === "dry-run"
              ? "Written to disk by the dry-run backend — nothing was sent."
              : `Handed to ${String(json.backend)} (${String(json.reference ?? "no reference")}). Reload to see it in the list.`,
        });
        setBody("");
      } else {
        setSaid({
          ok: false,
          text: typeof json.message === "string" ? json.message : `Refused (${response.status}).`,
        });
      }
    } catch {
      setSaid({ ok: false, text: "The request did not reach the server." });
    } finally {
      setBusy(false);
    }
  }

  const field =
    "mt-2 block w-full rounded-xl border border-line-strong bg-surface-base px-4 py-2 text-base text-ink-strong " +
    "focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500";

  return (
    <form onSubmit={submit} className="max-w-md">
      <label className="block font-mono text-[11px] uppercase tracking-[0.08em] text-ink-secondary" htmlFor="sms-to">
        To
      </label>
      <input
        id="sms-to"
        type="tel"
        required
        placeholder="+41 76 000 00 00"
        value={to}
        onChange={(e) => setTo(e.target.value)}
        className={field}
      />
      <label
        className="mt-4 block font-mono text-[11px] uppercase tracking-[0.08em] text-ink-secondary"
        htmlFor="sms-body"
      >
        Message
      </label>
      <textarea
        id="sms-body"
        required
        rows={3}
        maxLength={1600}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        className={field}
      />
      <BusyButton
        busy={busy}
        type="submit"
        busyLabel="Sending…"
        className="mt-4 min-h-11 rounded-xl bg-action-strong px-5 font-semibold text-on-action disabled:opacity-50"
      >
        Send the SMS
      </BusyButton>
      {said && (
        <p role="status" className={`mt-3 text-sm leading-6 ${said.ok ? "text-ink-body" : "text-coral-600"}`}>
          {said.text}
        </p>
      )}
    </form>
  );
}
