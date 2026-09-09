"use client";

import { useState } from "react";
import BusyButton from "@/components/BusyButton";
import { useI18n } from "@/components/LocaleProvider";

/**
 * The button on the gate, for a reader who has signed in and is still shut out
 * — B601.
 *
 * Until this existed, every branch of `TripGate` ended in *"ask whoever writes
 * this journal to let you in"* with no way to ask from the page the reader was
 * standing on. Asking meant knowing who the owner was and having another way
 * to reach them, which is precisely what somebody who followed a link and met
 * a lock does not have.
 *
 * **Only a name.** The address is already on the session and the server reads
 * it from there, never from this form — so there is nothing here that could
 * put a third party in front of the owner. Nothing else is asked: a postal
 * address and a phone number belong on the reader's own manage page, after
 * somebody has decided to let them in, and asking for them at the door is what
 * made the form B37 removed worth spamming.
 *
 * **It grants nothing and never claims to.** The answer is the same sentence
 * whether the row was new, already waiting, already approved, or blocked —
 * "the owner has been told, they decide" — because anything more specific
 * turns a button into a way of asking what this journal thinks of you. The
 * endpoint answers all four identically, so there is nothing here to branch
 * on even if this component wanted to.
 */
export default function AskToBeLetIn({ username }: { username: string }) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<"sent" | "failed" | null>(null);

  async function ask(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    const response = await fetch("/api/contacts/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ user: username, name }),
    }).catch(() => null);
    setBusy(false);
    if (!response?.ok) {
      // A 404 (contacts off for this journal), a 429, a 401 from a session
      // that expired while this page was open, or no network at all. One
      // sentence for all of them: none of the four is something the reader
      // can act on differently, and the one that matters — "it did not get
      // through" — is the same.
      setDone("failed");
      return;
    }
    setDone("sent");
  }

  if (done === "sent") {
    return (
      <p
        role="status"
        className="mt-6 rounded-2xl border border-navy-200 bg-white p-5 text-base leading-7 text-navy-700"
      >
        {t("gate.askSent")}
      </p>
    );
  }

  return (
    <form
      onSubmit={ask}
      className="mt-6 rounded-2xl border border-navy-200 bg-white p-5 sm:p-6"
    >
      <h2 className="font-display text-xl font-semibold text-navy-900">
        {t("gate.askTitle")}
      </h2>
      <p className="mt-2 text-base leading-7 text-navy-700">
        {t("gate.askBody")}
      </p>
      <label
        htmlFor="ask-name"
        className="mt-4 block text-base font-medium text-navy-700"
      >
        {t("gate.askName")}
      </label>
      <input
        id="ask-name"
        name="name"
        autoComplete="name"
        required
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="mt-2 w-full rounded-xl border border-navy-200 bg-white px-4 py-3 text-base text-navy-900"
      />
      <p role="alert" className="mt-3 text-base text-coral-600 empty:mt-0">
        {done === "failed" ? t("gate.askFailed") : ""}
      </p>
      <BusyButton
        busy={busy}
        type="submit"
        disabled={name.trim() === ""}
        className="mt-4 min-h-12 w-full rounded-xl bg-navy-900 px-4 py-3 text-lg font-medium text-cream-50 disabled:opacity-50"
        busyLabel={t("gate.askSending")}
      >
        {t("gate.askSubmit")}
      </BusyButton>
    </form>
  );
}
