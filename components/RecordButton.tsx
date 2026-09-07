"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import ConfirmPanel from "@/components/ConfirmPanel";
import { useI18n } from "@/components/LocaleProvider";
import {
  MAX_SPEECH_SECONDS,
  MINUTES_PER_CREDIT,
  SPEECH_LANGUAGES,
  creditsForSeconds,
} from "@/lib/helper/speech";

/**
 * Hold to talk — B686.
 *
 * **One mechanism, two homes.** The wizard's words step and the ask box both
 * mount this, because speech is a way of driving the whole product rather than
 * a feature of one field: what comes back is handed to `onText` and the host
 * decides what it is — a day's notes in one, a sentence at the front door in
 * the other.
 *
 * Everything about it is a phone first: a full-width target, the price on it
 * before the hold, and the elapsed seconds on it during. It releases on
 * `pointerup`, on `pointercancel` and on the pointer leaving the button, so a
 * thumb that slides off ends the recording rather than leaving the microphone
 * running.
 *
 * **The language is chosen, never detected.** The select below is empty by
 * default, which means "whatever this journal is written in" — the server
 * decides that from the journal's own locale. It is remembered per journal so
 * somebody who speaks a different language than they write in says so once.
 * See `lib/helper/speech.ts` for why detection is not on offer.
 */

/** Language names in their own language, the same convention `LOCALE_LABEL`
 *  in lib/i18n.ts uses — a list of languages is the one list nobody wants
 *  translated. */
const LANGUAGE_LABEL: Record<string, string> = {
  en: "English",
  de: "Deutsch",
  "de-CH": "Schwiizerdütsch",
  hu: "Magyar",
};

function remembered(username: string): string {
  try {
    return window.localStorage.getItem(`fs.speech.${username}`) ?? "";
  } catch {
    return "";
  }
}

export default function RecordButton({
  username,
  consented: initialConsent,
  disabled,
  onText,
}: {
  username: string;
  /** Whether this journal has already agreed to its owner's voice being sent
   *  — the `speech` scope, and never inferred from the other two. */
  consented: boolean;
  disabled?: boolean;
  /** What was said, once. The host decides where it goes; nothing here writes
   *  anything anywhere. */
  onText: (said: string) => void;
}) {
  const { t, tn, locale } = useI18n();
  const [consented, setConsented] = useState(initialConsent);
  const [consenting, setConsenting] = useState(false);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [seconds, setSeconds] = useState(0);
  // Lazily, and never from an effect: the remembered choice is read once when
  // this mounts. `remembered` is guarded, so a server render (where there is
  // no `window`) simply starts empty — which is the journal's own language,
  // the correct default anyway.
  const [language, setLanguage] = useState(() => remembered(username));
  const [error, setError] = useState("");

  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const started = useRef(0);

  // The stopwatch, and the ceiling. A hold that reaches the cap stops itself
  // rather than being refused by the server after the fact.
  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => {
      const elapsed = (Date.now() - started.current) / 1000;
      setSeconds(elapsed);
      if (elapsed >= MAX_SPEECH_SECONDS) recorder.current?.stop();
    }, 200);
    return () => window.clearInterval(timer);
  }, [recording]);

  const send = useCallback(
    async (blob: Blob, held: number) => {
      setBusy(true);
      setError("");
      try {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onerror = () => reject(new Error("read"));
          reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
          reader.readAsDataURL(blob);
        });
        const response = await fetch(`/api/helper/${encodeURIComponent(username)}/transcribe`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            audio: base64,
            mediaType: blob.type,
            seconds: held,
            language,
            locale,
            // One key per recording, so a tap that times out and is retried is
            // answered rather than charged twice.
            idempotency_key: `${started.current}/${blob.size}`,
          }),
        });
        const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
        if (!response.ok) throw new Error(String(body.error ?? response.status));
        const said = String(body.text ?? "").trim();
        if (said !== "") onText(said);
      } catch (thrown) {
        setError(t("agent.failed", { error: (thrown as Error).message }));
      } finally {
        setBusy(false);
        setSeconds(0);
      }
    },
    [language, locale, onText, t, username],
  );

  const start = useCallback(async () => {
    if (busy || recording) return;
    setError("");
    if (typeof MediaRecorder === "undefined" || !navigator.mediaDevices) {
      setError(t("agent.speechUnsupported"));
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      setError(t("agent.speechDenied"));
      return;
    }
    const media = new MediaRecorder(stream);
    chunks.current = [];
    media.ondataavailable = (event) => {
      if (event.data.size > 0) chunks.current.push(event.data);
    };
    media.onstop = () => {
      // The microphone is released the moment the hold ends, not when the
      // answer comes back.
      stream.getTracks().forEach((track) => track.stop());
      setRecording(false);
      const held = (Date.now() - started.current) / 1000;
      const blob = new Blob(chunks.current, { type: media.mimeType });
      chunks.current = [];
      if (blob.size > 0 && held >= 0.5) void send(blob, held);
    };
    recorder.current = media;
    started.current = Date.now();
    setSeconds(0);
    setRecording(true);
    media.start();
  }, [busy, recording, send, t]);

  function stop() {
    if (recorder.current?.state === "recording") recorder.current.stop();
  }

  async function agree() {
    setBusy(true);
    try {
      const response = await fetch(`/api/helper/${encodeURIComponent(username)}/consent`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope: "speech" }),
      });
      if (!response.ok) throw new Error(String(response.status));
      setConsented(true);
      setConsenting(false);
    } catch (thrown) {
      setError(t("agent.failed", { error: (thrown as Error).message }));
    } finally {
      setBusy(false);
    }
  }

  if (consenting) {
    return (
      <ConfirmPanel
        label={t("agent.speechConsentLabel")}
        question={t("agent.speechConsent", { minutes: String(MINUTES_PER_CREDIT) })}
        confirmLabel={t("agent.speechConsentConfirm")}
        busy={busy}
        onConfirm={() => void agree()}
        onCancel={() => setConsenting(false)}
      />
    );
  }

  return (
    <div className="mt-3">
      <button
        type="button"
        disabled={disabled || busy}
        // Consent first, and only then does the microphone ever open.
        onPointerDown={() => (consented ? void start() : setConsenting(true))}
        onPointerUp={stop}
        onPointerLeave={stop}
        onPointerCancel={stop}
        className={`min-h-11 w-full rounded-full border px-5 text-base font-semibold disabled:opacity-50 ${
          recording
            ? "border-coral-400 bg-cream-100 text-coral-600"
            : "border-navy-300 text-navy-800"
        }`}
      >
        {busy
          ? t("agent.speechWorking")
          : recording
            ? tn("agent.speechRecording", creditsForSeconds(seconds), {
                seconds: String(Math.floor(seconds)),
                credits: String(creditsForSeconds(seconds)),
              })
            : /* The price is on the button, before the hold. */
              t("agent.speechHold", { minutes: String(MINUTES_PER_CREDIT) })}
      </button>

      <label
        htmlFor={`speech-language-${username}`}
        className="mt-2 block text-sm font-semibold text-navy-800"
      >
        {t("agent.speechLanguage")}
      </label>
      <select
        id={`speech-language-${username}`}
        value={language}
        onChange={(event) => {
          setLanguage(event.target.value);
          try {
            window.localStorage.setItem(`fs.speech.${username}`, event.target.value);
          } catch {
            // A browser with no storage still records; it just forgets.
          }
        }}
        className="mt-1 min-h-11 w-full rounded-xl border border-navy-300 bg-white px-3 text-base text-navy-900"
      >
        <option value="">{t("agent.speechLanguageDefault")}</option>
        {SPEECH_LANGUAGES.map((code) => (
          <option key={code} value={code}>
            {LANGUAGE_LABEL[code] ?? code}
          </option>
        ))}
      </select>

      {error && (
        <p role="status" className="mt-2 text-sm text-coral-600">
          {error}
        </p>
      )}
    </div>
  );
}
