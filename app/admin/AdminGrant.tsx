"use client";

import { useState } from "react";
import BusyButton from "@/components/BusyButton";

/**
 * "Add credits" — B746, and it does not add credits.
 *
 * The button files a request and causes a mail; the credits land when the
 * operator opens the single-use link in their own mailbox. The wording here
 * says exactly that, because a button that says "granted" when a mail is
 * waiting is the one failure this shape exists to avoid.
 *
 * B992 moved it out of a section at the foot of the page and into the journal's
 * own panel, which is why there is no longer a journal to pick: the operator
 * opened this journal, so the one field left is the number. A form that asked
 * again which journal — after the question had already been answered by
 * opening one — was a place to add credits to the wrong one.
 *
 * No `window.confirm` and no `alert`: AGENTS.md forbids both, and
 * `test/no-browser-dialogs.test.ts` enforces it. The outcome is a line in the
 * panel instead.
 */
export default function AdminGrant({ journal }: { journal: string }) {
  const [credits, setCredits] = useState("50");
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setSaid(null);
    try {
      const response = await fetch("/api/admin/grants", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ user: journal, credits: Number(credits) }),
      });
      const body = (await response.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      setSaid(
        response.ok
          ? {
              ok: true,
              text: `A confirmation mail is on its way to the operator. ${credits} credits reach ${journal} when that link is opened — not before.`,
            }
          : {
              ok: false,
              text:
                typeof body.message === "string"
                  ? body.message
                  : `Refused (${response.status}).`,
            },
      );
    } catch {
      setSaid({ ok: false, text: "The request did not reach the server." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-t border-navy-200 px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-navy-600">
        Add credits
      </p>
      <p className="mt-1 text-sm text-navy-700">
        This files a request and mails you a single-use link. Nothing reaches
        the balance until that link is opened.
      </p>
      <form onSubmit={submit} className="mt-3 flex flex-wrap items-end gap-3">
        <label className="block min-w-0 text-sm text-navy-700">
          Credits
          <input
            type="number"
            min={1}
            max={10000}
            step={1}
            value={credits}
            onChange={(event) => setCredits(event.target.value)}
            className="mt-1 w-28 rounded-lg border border-navy-200 bg-white px-3 py-2 text-navy-900"
          />
        </label>
        <BusyButton
          busy={busy}
          type="submit"
          disabled={!(Number(credits) > 0)}
          className="rounded-lg bg-navy-900 px-4 py-2 font-semibold text-white disabled:opacity-50"
          busyLabel="Sending…"
        >
          Send confirmation mail
        </BusyButton>
        {said ? (
          <p
            className={`w-full text-sm ${said.ok ? "text-navy-700" : "text-red-700"}`}
          >
            {said.text}
          </p>
        ) : null}
      </form>
    </div>
  );
}
