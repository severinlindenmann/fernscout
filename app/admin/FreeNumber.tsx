"use client";

import { useState } from "react";
import ConfirmPanel from "@/components/ConfirmPanel";

/**
 * Free one journal's proven phone number — B2833. Operator only; an owner
 * cannot release their own number. Names the journal, shows the last two
 * digits bound to it, asks, and reports what the route actually did.
 */
export default function FreeNumber() {
  const [user, setUser] = useState("");
  const [masked, setMasked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);

  async function look() {
    setBusy(true);
    setSaid(null);
    setMasked(null);
    setAsking(false);
    try {
      const response = await fetch(`/api/admin/owner-tel?user=${encodeURIComponent(user.trim())}`);
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) {
        setSaid({ ok: false, text: response.status === 404 && body.message ? String(body.message) : `Refused (${response.status}).` });
      } else if (typeof body.masked === "string") {
        setMasked(body.masked);
      } else {
        setSaid({ ok: true, text: `“${user.trim()}” has no phone number bound.` });
      }
    } catch {
      setSaid({ ok: false, text: "The request did not reach the server." });
    } finally {
      setBusy(false);
    }
  }

  async function free() {
    setBusy(true);
    try {
      const response = await fetch("/api/admin/owner-tel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ user: user.trim() }),
      });
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) {
        setSaid({ ok: false, text: typeof body.message === "string" ? body.message : `Refused (${response.status}).` });
      } else {
        setSaid({
          ok: true,
          text: body.freed
            ? `The number ending ${masked?.slice(-2)} is free — another journal may prove it now.`
            : `“${user.trim()}” had no phone number bound.`,
        });
        setMasked(null);
      }
      setAsking(false);
    } catch {
      setSaid({ ok: false, text: "The request did not reach the server." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h2 className="font-display text-lg font-semibold text-ink-strong">Free a phone number</h2>
      <p className="mt-1 text-xs text-ink-body">
        A journal&rsquo;s proven number is locked to it, and only you can lift that. Owners cannot
        remove it themselves. Nothing the journal wrote is touched.
      </p>
      <form
        className="mt-2 flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void look();
        }}
      >
        <input
          value={user}
          onChange={(event) => setUser(event.target.value)}
          placeholder="journal name"
          aria-label="Journal name"
          className="min-h-11 min-w-0 flex-1 rounded-xl border border-line-quiet bg-surface-base px-3 font-mono text-sm"
        />
        <button
          type="submit"
          disabled={busy || !user.trim()}
          className="min-h-11 rounded-xl border border-line-quiet px-4 text-sm font-semibold text-ink-strong disabled:opacity-50"
        >
          Look up
        </button>
      </form>
      {masked && !asking && (
        <p className="mt-2 text-sm text-ink-body">
          <span className="font-mono">{user.trim()}</span> holds <span className="font-mono">{masked}</span>{" "}
          <button
            type="button"
            onClick={() => setAsking(true)}
            className="min-h-11 text-sm font-semibold text-coral-600 underline underline-offset-2"
          >
            Free this phone number
          </button>
        </p>
      )}
      {masked && asking && (
        <div className="mt-2">
          <ConfirmPanel
            label="Free this phone number"
            question={`Free the number ending ${masked.slice(-2)} from “${user.trim()}”?`}
            details="The journal lets go of the number, so it can be proven again for this or another journal. WhatsApp messages from it stop reaching the journal's assistant, and the owner's copy of a published day is no longer sent there."
            confirmLabel="Free the number"
            busyLabel="Freeing…"
            busy={busy}
            error={said && !said.ok ? said.text : undefined}
            tone="destructive"
            onConfirm={() => void free()}
            onCancel={() => setAsking(false)}
          />
        </div>
      )}
      {said && !asking && (
        <p className={`mt-2 text-xs ${said.ok ? "text-ink-body" : "text-coral-600"}`}>{said.text}</p>
      )}
    </section>
  );
}
