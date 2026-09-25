"use client";

import { useState } from "react";
import ConfirmPanel from "@/components/ConfirmPanel";

/**
 * Write to one journal's owner, from its panel.
 *
 * The page never holds the owner's address: this posts the journal's name and
 * `/api/admin/message` looks the address up on the server. The answer is
 * reported as the route gives it — "sent", "written to disk by the file
 * transport", or not sent and whose setting stopped it — never as sent
 * because the button was pressed.
 */
export default function MessageOwner({ username }: { username: string }) {
  const [open, setOpen] = useState(false);
  const [asking, setAsking] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);

  async function send() {
    setBusy(true);
    setSaid(null);
    try {
      const response = await fetch("/api/admin/message", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ user: username, subject, body }),
      });
      const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (response.ok) {
        setSaid({
          ok: true,
          text:
            json.transport === "file"
              ? "Written to disk by the file transport — nothing left this machine."
              : "Sent to the owner. Their reply comes to your own address.",
        });
        setAsking(false);
        setOpen(false);
        setSubject("");
        setBody("");
      } else {
        setSaid({
          ok: false,
          text: typeof json.message === "string" ? json.message : `Refused (${response.status}).`,
        });
        setAsking(false);
      }
    } catch {
      setSaid({ ok: false, text: "The request did not reach the server. Nothing was sent." });
      setAsking(false);
    } finally {
      setBusy(false);
    }
  }

  const field =
    "mt-1.5 block w-full rounded-xl border border-line-strong bg-surface-base px-3 py-2 text-base text-ink-strong";

  return (
    <div className="px-4 pt-3">
      {!open ? (
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            setSaid(null);
          }}
          className="min-h-11 w-full rounded-xl border border-line-quiet bg-surface-raised px-4 text-sm font-semibold text-ink-strong hover:bg-surface-subtle"
        >
          Message the owner
        </button>
      ) : asking ? (
        <ConfirmPanel
          label="Message the owner"
          question={`Mail “${subject}” to the owner of ${username}?`}
          details="It goes to the address in the journal's own config, from this instance's mailbox, with your address as Reply-To. A journal that switched mail off does not get it, and you are told so."
          confirmLabel="Send the mail"
          busyLabel="Sending…"
          busy={busy}
          onConfirm={send}
          onCancel={() => setAsking(false)}
        />
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setAsking(true);
          }}
          className="rounded-2xl border border-line-quiet p-3"
        >
          <label className="block text-xs font-semibold uppercase tracking-wide text-ink-secondary">
            Subject
            <input
              required
              maxLength={140}
              value={subject}
              onChange={(event) => setSubject(event.target.value)}
              className={field}
            />
          </label>
          <label className="mt-3 block text-xs font-semibold uppercase tracking-wide text-ink-secondary">
            Message
            <textarea
              required
              rows={4}
              maxLength={4000}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              className={field}
            />
          </label>
          <div className="mt-3 flex gap-2">
            <button
              type="submit"
              className="min-h-11 rounded-xl bg-action-strong px-4 text-sm font-semibold text-on-action"
            >
              Review
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="min-h-11 rounded-xl border border-line-quiet px-4 text-sm font-semibold text-ink-strong"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {said ? (
        <p role="status" className={`mt-2 text-sm ${said.ok ? "text-ink-body" : "text-coral-600"}`}>
          {said.text}
        </p>
      ) : null}
    </div>
  );
}
