"use client";

import { useState } from "react";
import ConfirmPanel from "@/components/ConfirmPanel";

/**
 * One switch, one key, one call to `/api/admin/messages/switches` — B2446.
 *
 * **Locked** (a required family) never renders a control at all — the
 * caller passes `locked` rather than this component guessing from the key,
 * since only the registry knows a template's class.
 *
 * **Service-class templates confirm first.** `confirmQuestion` present
 * means turning the switch *off* opens `ConfirmPanel` with an
 * action-specific button (never `window.confirm` — AGENTS.md) before the
 * request goes out; turning one back *on* never needs to ask.
 */
export default function MessageSwitch({
  messageKey,
  initialOff,
  locked,
  confirmQuestion,
  confirmDetails,
  confirmLabel,
  onChanged,
}: {
  messageKey: string;
  initialOff: boolean;
  locked?: boolean;
  confirmQuestion?: string;
  confirmDetails?: string;
  confirmLabel?: string;
  onChanged?: (off: boolean) => void;
}) {
  const [off, setOff] = useState(initialOff);
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function apply(nextOff: boolean) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/messages/switches", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key: messageKey, off: nextOff }),
      });
      const json = (await response.json().catch(() => ({}))) as { off?: boolean; message?: string };
      if (!response.ok) {
        setError(typeof json.message === "string" ? json.message : "That switch could not be changed.");
        return;
      }
      const result = json.off ?? nextOff;
      setOff(result);
      onChanged?.(result);
    } catch {
      setError("The request did not reach the server.");
    } finally {
      setBusy(false);
      setAsking(false);
    }
  }

  if (locked) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-secondary" title="Required: cannot be switched off">
        <span aria-hidden className="h-5 w-9 rounded-full border border-line-quiet bg-surface-subtle" />
        Locked on
      </span>
    );
  }

  return (
    <div className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        role="switch"
        aria-checked={!off}
        disabled={busy}
        onClick={() => {
          if (!off && confirmQuestion) {
            setAsking(true);
            return;
          }
          void apply(!off);
        }}
        className={`relative h-5 w-9 rounded-full transition-colors disabled:opacity-50 ${off ? "bg-line-strong" : "bg-green-600"}`}
      >
        <span
          aria-hidden
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${off ? "left-0.5" : "left-4"}`}
        />
      </button>
      {asking ? (
        <ConfirmPanel
          label="Switch this off"
          question={confirmQuestion!}
          details={confirmDetails}
          confirmLabel={confirmLabel ?? "Turn it off"}
          busyLabel="Turning off…"
          busy={busy}
          onConfirm={() => void apply(true)}
          onCancel={() => setAsking(false)}
        />
      ) : null}
      {error ? <p className="text-xs text-coral-600">{error}</p> : null}
    </div>
  );
}
