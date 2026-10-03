"use client";

import { useState } from "react";
import BusyButton from "@/components/BusyButton";
import type { InviteRequestEntry } from "@/lib/inviteRequest";

const MAIL_NOTE: Record<string, string> = {
  sent: "Invited — mail sent",
  failed: "Invited — the mail failed, send it again or tell them yourself",
  off: "Invited — no mail on this server, tell them yourself",
  has_journal: "Invited — this address already has a journal",
};

/**
 * Strangers asking to be let in — B2507.
 *
 * Sits beside `Invites` rather than inside it: a request is not permission,
 * only a name and an address to act on. "Invite this address" is the same
 * `POST /api/admin/invites` call `Invites` itself makes (action `add`) —
 * there is no second door into the invite list, only a second way to reach
 * this one. `already` is worked out from the `Invites` list this page
 * already loaded, so an address invited by any route (this button, or
 * typed directly into `Invites`) shows as done without a second table.
 */
export default function InviteRequests({
  entries,
  already,
}: {
  entries: InviteRequestEntry[];
  already: string[];
}) {
  const alreadySet = new Set(already.map((e) => e.toLowerCase()));
  // What happened to the mail for each address this session acted on.
  const [invited, setInvited] = useState<Map<string, string>>(new Map());
  const [busy, setBusy] = useState<string | null>(null);
  const [wrong, setWrong] = useState<string | null>(null);

  async function invite(email: string) {
    setBusy(email);
    setWrong(null);
    try {
      const response = await fetch("/api/admin/invites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email, action: "add", notify: true }),
      });
      if (!response.ok) {
        const said = (await response.json().catch(() => ({}))) as Record<string, unknown>;
        setWrong(typeof said.message === "string" ? said.message : `Refused (${response.status}).`);
        return;
      }
      const said = (await response.json().catch(() => ({}))) as { mail?: string };
      setInvited((prev) => new Map(prev).set(email, said.mail ?? "off"));
    } catch {
      setWrong("The request did not reach the server.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section>
      <h2 className="font-display text-lg font-semibold text-ink-strong">Invite requests</h2>
      <p className="mt-1 text-sm text-ink-body">
        Addresses that asked, at <code>/invite</code>, to be let in. &ldquo;Invite this address&rdquo;
        adds it to &ldquo;Who may sign up&rdquo; above and mails a link that opens the signup for that
        address alone (single use, 7 days). It does not skip the phone step.
      </p>
      {wrong ? <p className="mt-2 text-sm text-coral-600">{wrong}</p> : null}
      {entries.length === 0 ? (
        <p className="mt-3 text-sm text-ink-body">Nobody has asked yet.</p>
      ) : (
        <ul className="mt-3 divide-y divide-line-quiet rounded-lg border border-line-quiet">
          {entries.map((entry) => {
            const result = invited.get(entry.email);
            const done = result !== undefined || alreadySet.has(entry.email);
            return (
              <li key={entry.email} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2">
                <span className="w-full min-w-0 break-words text-sm text-ink-strong sm:w-auto sm:flex-1">
                  {entry.email}
                </span>
                <span className="text-xs text-ink-body">
                  {entry.createdAt.slice(0, 10)}
                  {entry.locale ? ` · ${entry.locale}` : ""}
                </span>
                {done ? (
                  <>
                    <span className="text-sm text-ink-body">{MAIL_NOTE[result ?? ""] ?? "Invited"}</span>
                    {result !== "has_journal" ? (
                      <BusyButton
                        busy={busy === entry.email}
                        type="button"
                        onClick={() => void invite(entry.email)}
                        className="rounded-lg border border-line-quiet px-3 py-1 text-sm font-semibold text-ink-strong"
                        busyLabel="Sending…"
                      >
                        Send again
                      </BusyButton>
                    ) : null}
                  </>
                ) : (
                  <BusyButton
                    busy={busy === entry.email}
                    type="button"
                    onClick={() => void invite(entry.email)}
                    className="rounded-lg bg-action-strong px-3 py-1 text-sm font-semibold text-on-action"
                    busyLabel="Inviting…"
                  >
                    Invite this address
                  </BusyButton>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
