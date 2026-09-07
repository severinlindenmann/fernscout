"use client";

import { useState } from "react";
import ConfirmPanel from "@/components/ConfirmPanel";
import RecordButton from "@/components/RecordButton";
import { useI18n } from "@/components/LocaleProvider";
import type { TranslationKey } from "@/lib/i18n";

/**
 * The box at the top of a journal's card — B685, §3 of the plan.
 *
 * **An accelerator over a menu that already works.** With the `helper`
 * capability off this component is not rendered at all and the buttons beside
 * it are the whole interface; nothing on the card depends on it. That is why
 * `unknown` lands quietly on those buttons rather than on an apology — the
 * fallback is the page the person was already looking at.
 *
 * What comes back from `/api/helper/<user>/ask` is one of four things, and the
 * discipline is in the difference:
 *
 * - **read** — a sentence, shown. Nothing to confirm about being told a number.
 * - **open** — a screen, navigated to. It writes nothing; the screen has its
 *   own buttons.
 * - **write** — the fields, prefilled and editable, in a `ConfirmPanel`.
 *   **However confident the router was.** Nothing is written until the person
 *   presses, and what they press is a button that says what it does.
 * - **unknown** — a line above the buttons.
 *
 * One intent per turn: there is no queue here and no plan. "Make a trip and
 * add yesterday" does the trip, and the person asks again.
 */

type Field = { name: string; value: string; date: boolean };

type Answer =
  | { kind: "read"; answer: string }
  | { kind: "write"; intent: string; endpoint: string; fields: Field[] }
  | { kind: "unknown" };

export default function HelperAsk({
  username,
  consented: initialConsent,
  speech,
  consentedSpeech,
  speechProvider,
}: {
  username: string;
  /** Whether this journal has already agreed to a model being spoken to
   *  (`lib/helper/consent.ts`). Read on the server, so the panel is not shown
   *  to somebody who has already read it. */
  consented: boolean;
  /** Whether the `transcription` capability is on for this journal — B686.
   *  Off, the box takes typed sentences exactly as it did. */
  speech: boolean;
  /** Whether this journal has agreed to its owner's voice being sent. */
  consentedSpeech: boolean;
  /** Who a recording actually goes to — B744. Passed through to
   *  `RecordButton`, which reads it rather than assuming Deepgram. */
  speechProvider: string;
}) {
  const { t } = useI18n();
  const [said, setSaid] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [fields, setFields] = useState<Field[]>([]);
  const [consented, setConsented] = useState(initialConsent);
  const [consenting, setConsenting] = useState(false);

  async function post(url: string, body?: unknown): Promise<Record<string, unknown>> {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body ?? {}),
    });
    const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) throw new Error(String(json.error ?? response.status));
    return json;
  }

  async function ask() {
    setBusy(true);
    setError("");
    setAnswer(null);
    try {
      const body = await post(`/api/helper/${encodeURIComponent(username)}/ask`, {
        said,
        // Their today, not the server's: "in March" is answered from where
        // the person is standing.
        today: new Date().toISOString().slice(0, 10),
      });
      if (body.kind === "open") {
        window.location.href = String(body.href);
        return;
      }
      if (body.kind === "read") {
        setAnswer({ kind: "read", answer: String(body.answer) });
      } else if (body.kind === "write") {
        const given = (body.fields ?? []) as Field[];
        setFields(given);
        setAnswer({
          kind: "write",
          intent: String(body.intent),
          endpoint: String(body.endpoint),
          fields: given,
        });
      } else {
        setAnswer({ kind: "unknown" });
      }
    } catch (thrown) {
      setError(t("agent.failed", { error: (thrown as Error).message }));
    } finally {
      setBusy(false);
    }
  }

  async function consentThenAsk() {
    setBusy(true);
    setError("");
    try {
      await post(`/api/helper/${encodeURIComponent(username)}/consent`);
      setConsented(true);
      setConsenting(false);
      setBusy(false);
      await ask();
    } catch (thrown) {
      setError(t("agent.failed", { error: (thrown as Error).message }));
      setBusy(false);
    }
  }

  async function confirmWrite() {
    if (answer?.kind !== "write") return;
    setBusy(true);
    setError("");
    try {
      const body = await post(
        answer.endpoint,
        Object.fromEntries(fields.map((field) => [field.name, field.value])),
      );
      window.location.href = String(body.href ?? window.location.href);
    } catch (thrown) {
      setError(t("agent.failed", { error: (thrown as Error).message }));
      setBusy(false);
    }
  }

  return (
    <div className="mt-4">
      <label
        htmlFor={`ask-${username}`}
        className="font-mono text-[11px] uppercase tracking-[0.18em] text-navy-600"
      >
        {t("agent.askLabel")}
      </label>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <input
          id={`ask-${username}`}
          type="text"
          value={said}
          onChange={(event) => setSaid(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || said.trim() === "" || busy) return;
            if (consented) void ask();
            else setConsenting(true);
          }}
          placeholder={t("agent.askPlaceholder")}
          className="min-h-11 w-full rounded-full border border-navy-300 bg-white px-4 text-base text-navy-900 placeholder:text-navy-500"
        />
        <button
          type="button"
          disabled={busy || said.trim() === ""}
          onClick={() => (consented ? void ask() : setConsenting(true))}
          className="min-h-11 shrink-0 rounded-full border border-navy-300 px-5 text-base font-semibold text-navy-800 transition-colors hover:bg-cream-100 disabled:opacity-50"
        >
          {busy ? t("agent.askWorking") : t("agent.askGo")}
        </button>
      </div>

      {/* B686 — the same record button the wizard's words step mounts, so the
          microphone drives the whole product rather than one field. What comes
          back fills the box; it is not asked until the person presses Ask. */}
      {speech && (
        <RecordButton
          username={username}
          consented={consentedSpeech}
          provider={speechProvider}
          disabled={busy}
          onText={(heard) => setSaid(heard)}
        />
      )}

      {consenting && (
        <div className="mt-3">
          <ConfirmPanel
            label={t("agent.helperConsentLabel")}
            question={t("agent.askConsent")}
            confirmLabel={t("agent.helperConsentConfirm")}
            busy={busy}
            onConfirm={() => void consentThenAsk()}
            onCancel={() => setConsenting(false)}
          />
        </div>
      )}

      {answer?.kind === "read" && (
        <p role="status" className="mt-3 rounded-xl bg-cream-100 p-3 text-base leading-6 text-navy-800">
          {answer.answer}
        </p>
      )}

      {answer?.kind === "unknown" && (
        <p role="status" className="mt-3 text-sm leading-6 text-navy-700">
          {t("agent.askUnknown")}
        </p>
      )}

      {answer?.kind === "write" && (
        <div className="mt-3">
          <ConfirmPanel
            label={t("agent.askConfirmLabel")}
            question={t("agent.askConfirm")}
            confirmLabel={t(`agent.confirm.${answer.intent}` as TranslationKey)}
            busy={busy}
            onConfirm={() => void confirmWrite()}
            onCancel={() => setAnswer(null)}
          >
            <div className="mt-3 space-y-3">
              {fields.map((field, index) => (
                <div key={field.name}>
                  <label
                    htmlFor={`ask-${username}-${field.name}`}
                    className="block text-sm font-semibold text-navy-800"
                  >
                    {t(`agent.slot.${field.name}` as TranslationKey)}
                  </label>
                  <input
                    id={`ask-${username}-${field.name}`}
                    type={field.date ? "date" : "text"}
                    value={field.value}
                    onChange={(event) =>
                      setFields((was) =>
                        was.map((one, n) =>
                          n === index ? { ...one, value: event.target.value } : one,
                        ),
                      )
                    }
                    className="mt-1 min-h-11 w-full rounded-xl border border-navy-300 bg-white px-3 text-base text-navy-900"
                  />
                </div>
              ))}
            </div>
          </ConfirmPanel>
        </div>
      )}

      {error && (
        <p role="status" className="mt-2 text-sm text-coral-600">
          {error}
        </p>
      )}
    </div>
  );
}
