"use client";

import { useState } from "react";

/**
 * "Add credits" — B746, and it does not add credits.
 *
 * The button files a request and causes a mail; the credits land when the
 * operator opens the single-use link in their own mailbox. The wording here
 * says exactly that, because a button that says "granted" when a mail is
 * waiting is the one failure this shape exists to avoid.
 *
 * No `window.confirm` and no `alert`: AGENTS.md forbids both, and
 * `test/no-browser-dialogs.test.ts` enforces it. The outcome is a line in the
 * panel instead.
 */
export default function AdminGrant({ journals }: { journals: string[] }) {
  const [user, setUser] = useState(journals[0] ?? "");
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
        body: JSON.stringify({ user, credits: Number(credits) }),
      });
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      setSaid(
        response.ok
          ? {
              ok: true,
              text: `A confirmation mail is on its way to the operator. ${credits} credits reach ${user} when that link is opened — not before.`,
            }
          : { ok: false, text: typeof body.message === "string" ? body.message : `Refused (${response.status}).` },
      );
    } catch {
      setSaid({ ok: false, text: "The request did not reach the server." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-4 grid gap-3 sm:grid-cols-[1fr_8rem_auto] sm:items-end">
      <label className="block text-sm text-navy-700">
        Journal
        <select
          value={user}
          onChange={(event) => setUser(event.target.value)}
          className="mt-1 w-full rounded-lg border border-navy-200 bg-white px-3 py-2 text-navy-900"
        >
          {journals.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm text-navy-700">
        Credits
        <input
          type="number"
          min={1}
          max={10000}
          step={1}
          value={credits}
          onChange={(event) => setCredits(event.target.value)}
          className="mt-1 w-full rounded-lg border border-navy-200 bg-white px-3 py-2 text-navy-900"
        />
      </label>
      <button
        type="submit"
        disabled={busy || !user}
        className="rounded-lg bg-navy-900 px-4 py-2 font-semibold text-white disabled:opacity-50"
      >
        {busy ? "Sending…" : "Send confirmation mail"}
      </button>
      {said ? (
        <p className={`text-sm sm:col-span-3 ${said.ok ? "text-navy-700" : "text-red-700"}`}>{said.text}</p>
      ) : null}
    </form>
  );
}
