"use client";

import { useState } from "react";
import ConfirmPanel from "@/components/ConfirmPanel";

/**
 * Refund one settled purchase — B878.
 *
 * **It records; it does not pay.** The money goes back in the payment
 * provider's own dashboard, by the operator, and the question below says so
 * before the button is pressed — a panel that implied this refunded the charge
 * would be the one mistake this flow cannot take back.
 *
 * `ConfirmPanel` rather than `window.confirm`: AGENTS.md forbids the browser's
 * own dialogs and `test/no-browser-dialogs.test.ts` enforces it. It also lets
 * the question name the journal, the amount and the credits, which is exactly
 * what somebody about to press this needs to read.
 */
export default function AdminRefund({
  username,
  payment,
  amount,
  credits,
}: {
  username: string;
  payment: string;
  amount: string;
  credits: number;
}) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);

  async function refund() {
    setBusy(true);
    try {
      const response = await fetch("/api/admin/refunds", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ user: username, payment }),
      });
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) {
        setSaid({
          ok: false,
          text: typeof body.message === "string" ? body.message : `Refused (${response.status}).`,
        });
        return;
      }
      const taken = Number(body.creditsTaken ?? 0);
      const short = Number(body.shortfall ?? 0);
      setSaid({
        ok: true,
        // Never "refunded" on its own: the money is still the operator's to
        // send back, and the shortfall is the number they have to decide about.
        text:
          `Recorded, and ${taken} credits taken back` +
          (short > 0 ? ` — ${short} were already spent and could not be` : "") +
          `. Refund the ${amount} in Stripe; the buyer has been mailed.`,
      });
      setAsking(false);
    } catch {
      setSaid({ ok: false, text: "The request did not reach the server." });
    } finally {
      setBusy(false);
    }
  }

  if (said?.ok) return <p className="mt-1 text-xs text-navy-700">{said.text}</p>;

  if (asking) {
    return (
      <div className="mt-2">
        <ConfirmPanel
          label="Refund this purchase"
          question={`Record ${amount} as refunded to ${username} and take back ${credits} credits?`}
          details={
            "This does not move any money. It marks the purchase refunded, takes the credits off " +
            "the balance (down to zero — credits already spent cannot be taken back), and mails " +
            "the buyer. Refunding the charge itself is done in Stripe."
          }
          confirmLabel="Record the refund"
          busyLabel="Recording…"
          busy={busy}
          error={said && !said.ok ? said.text : undefined}
          onConfirm={refund}
          onCancel={() => setAsking(false)}
        />
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setAsking(true)}
        className="mt-1 rounded-lg border border-navy-200 px-2.5 py-1 text-xs font-semibold text-navy-700 hover:border-navy-500"
      >
        Refund
      </button>
      {said && !said.ok ? <p className="mt-1 text-xs text-red-700">{said.text}</p> : null}
    </>
  );
}
