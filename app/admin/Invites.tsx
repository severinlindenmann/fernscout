"use client";

import { useState } from "react";
import BusyButton from "@/components/BusyButton";
import type { Invite } from "@/lib/inviteList";

/**
 * Who may sign up — B1693.
 *
 * On an invite-only instance this list *is* the door: an address that is not
 * here is never sent a signup code, by the web wizard, the API or WhatsApp.
 * It says so above the field rather than in a tooltip, because the operator
 * adding somebody and the operator wondering why nobody can sign up are the
 * same person a fortnight apart.
 *
 * The server answers every press with the whole list, so nothing here keeps a
 * second opinion about what is in it. No `window.confirm` on Remove — AGENTS.md
 * forbids it and adding somebody back is one field away.
 */
export default function Invites({
  inviteOnly,
  initial,
}: {
  inviteOnly: boolean;
  initial: Invite[];
}) {
  const [invites, setInvites] = useState(initial);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [wrong, setWrong] = useState<string | null>(null);

  async function send(body: { email: string; action: "add" | "remove" }) {
    setBusy(body.action === "add" ? "add" : body.email);
    setWrong(null);
    try {
      const response = await fetch("/api/admin/invites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const said = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) {
        setWrong(typeof said.message === "string" ? said.message : `Refused (${response.status}).`);
        return;
      }
      setInvites((said.invites as Invite[]) ?? []);
      if (body.action === "add") setEmail("");
    } catch {
      setWrong("The request did not reach the server.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="mt-8">
      <h2 className="font-display text-lg font-semibold text-ink-strong">Who may sign up</h2>
      <p className="mt-1 text-sm text-ink-body">
        {inviteOnly ? (
          <>
            This instance is invite-only. Only the addresses below can make a journal here — every
            other address is refused at the first step, and never sent a code. They still do the
            whole normal signup: the emailed code, a telephone number, and proving it.
          </>
        ) : (
          <>
            This instance is open: <code>features.signup.inviteOnly</code> is <code>false</code> in{" "}
            <code>site/config.json</code>, so anybody can make a journal and this list is not
            consulted. It is kept for when the instance closes again.
          </>
        )}
      </p>

      <form
        className="mt-3 flex flex-wrap items-end gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void send({ email, action: "add" });
        }}
      >
        <label className="block min-w-0 text-sm text-ink-body">
          Email address
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="them@example.com"
            className="mt-1 w-72 max-w-full rounded-lg border border-line-quiet bg-surface-raised px-3 py-2 text-ink-strong"
          />
        </label>
        <BusyButton
          busy={busy === "add"}
          type="submit"
          disabled={!email.includes("@")}
          className="rounded-lg bg-action-strong px-4 py-2 font-semibold text-on-action disabled:opacity-50"
          busyLabel="Adding…"
        >
          Allow this address
        </BusyButton>
        {wrong ? <p className="w-full text-sm text-red-700">{wrong}</p> : null}
      </form>

      {invites.length === 0 ? (
        <p className="mt-3 text-sm text-ink-muted">
          {inviteOnly
            ? "Nobody is on the list, so nobody can sign up yet."
            : "Nobody is on the list."}
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-line-quiet rounded-lg border border-line-quiet">
          {invites.map((invite) => (
            <li key={invite.email} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
              {/* Full width of its own at phone width: an address squeezed
                  beside the date breaks mid-word, which is unreadable for the
                  one string on the row that has to be read exactly. */}
              <span className="w-full min-w-0 break-words text-sm text-ink-strong sm:w-auto sm:flex-1">
                {invite.email}
              </span>
              <span className="text-xs text-ink-muted">
                added {invite.addedAt.slice(0, 10)}
                {invite.addedBy ? ` by ${invite.addedBy}` : ""}
              </span>
              <BusyButton
                busy={busy === invite.email}
                type="button"
                onClick={() => void send({ email: invite.email, action: "remove" })}
                className="rounded-lg border border-line-quiet px-3 py-1 text-sm text-ink-body"
                busyLabel="Removing…"
              >
                Remove
              </BusyButton>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
