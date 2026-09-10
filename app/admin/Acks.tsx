"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import BusyButton from "@/components/BusyButton";

/**
 * Answering the attention band — B1203.
 *
 * Two controls and one request between them: **Acknowledge** on an entry, and
 * **Unhide** on a row of the history. Both post one id to `/api/admin/acks`
 * and then refresh the page, because everything the band shows is computed on
 * the server and a client that patched its own list would be showing a second
 * opinion about what needs a person.
 *
 * **No `window.confirm`.** AGENTS.md forbids it and
 * `test/no-browser-dialogs.test.ts` enforces it — and nothing here needs one:
 * acknowledging is reversible from the row directly beneath, which is a better
 * answer than a dialog asking whether you meant it.
 *
 * The refusal is a line under the button rather than a toast. There is one
 * thing that can go wrong — the entry stopped being raised between the page
 * rendering and the press — and it deserves a sentence saying so, since the
 * entry then vanishes on the reload and the operator would otherwise have
 * pressed a button and watched something disappear for a reason nobody stated.
 */
export function AckButton({ id, label }: { id: string; label: string }) {
  return <Press id={id} action="acknowledge" label={label} />;
}

export function UnhideButton({ id }: { id: string }) {
  return <Press id={id} action="unhide" label="Unhide" subtle />;
}

function Press({
  id,
  action,
  label,
  subtle,
}: {
  id: string;
  action: "acknowledge" | "unhide";
  label: string;
  subtle?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [wrong, setWrong] = useState<string | null>(null);

  async function press() {
    setBusy(true);
    setWrong(null);
    try {
      const response = await fetch("/api/admin/acks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      if (response.ok) {
        // The server recomputes the band, the history and the counts together.
        router.refresh();
        return;
      }
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      setWrong(
        body.error === "not_raised"
          ? "Nothing is raising this any more — it has already gone."
          : `Refused (${response.status}).`,
      );
    } catch {
      setWrong("The request did not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <BusyButton
        type="button"
        busy={busy}
        onClick={press}
        className={
          subtle
            ? "rounded-full border border-navy-200 bg-white px-2.5 py-1 text-xs font-semibold text-navy-700 hover:bg-cream-100"
            : "rounded-full border border-navy-200 bg-white px-3 py-1 text-xs font-semibold text-navy-700 hover:bg-cream-100"
        }
      >
        {label}
      </BusyButton>
      {wrong ? <span className="text-xs text-coral-600">{wrong}</span> : null}
    </span>
  );
}
