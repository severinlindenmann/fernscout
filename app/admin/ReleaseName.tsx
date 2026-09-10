"use client";

import { useState } from "react";
import ConfirmPanel from "@/components/ConfirmPanel";

/**
 * Hand one deleted journal's name back — B1354.
 *
 * The question has to say what it does *not* do. "Release" beside a deleted
 * journal reads like undelete to anybody who has not read the route, and the
 * content is long gone by the time this row exists — so the panel says the
 * name is the only thing that comes back, and that the next person to type it
 * gets it.
 */
export default function ReleaseName({ username, title }: { username: string; title: string }) {
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ ok: boolean; text: string } | null>(null);

  async function release() {
    setBusy(true);
    try {
      const response = await fetch("/api/admin/tombstones", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ user: username }),
      });
      const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
      if (!response.ok) {
        setSaid({
          ok: false,
          text: typeof body.message === "string" ? body.message : `Refused (${response.status}).`,
        });
        return;
      }
      setSaid({ ok: true, text: `“${username}” is free — anybody can sign up as it now.` });
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
          label="Release this name"
          question={`Give the name “${username}” back? Anybody signing up may take it, and its old links stop saying the journal was deleted.`}
          details={
            `This does not restore anything. “${title}” and its photographs went when it was ` +
            "deleted and are not here to bring back — the only thing that changes is that the " +
            "name is claimable again, and that /" +
            username +
            " answers “not found” rather than “gone”."
          }
          confirmLabel="Release the name"
          busyLabel="Releasing…"
          busy={busy}
          error={said && !said.ok ? said.text : undefined}
          onConfirm={release}
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
        className="text-xs font-semibold text-navy-700 underline underline-offset-2 hover:opacity-75"
      >
        Release
      </button>
      {said && !said.ok && <p className="mt-1 text-xs text-coral-600">{said.text}</p>}
    </>
  );
}
