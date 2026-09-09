"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import BusyButton from "@/components/BusyButton";
import { Mic } from "lucide-react";
import ConfirmPanel from "@/components/ConfirmPanel";
import { useI18n } from "@/components/LocaleProvider";
import {
  MAX_SPEECH_SECONDS,
  MINUTES_PER_CREDIT,
  SPEECH_LANGUAGES,
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
 * **Two interaction models on one control, and the second one is not a
 * nicety** — B794. A keyboard fires `click` and never `pointerdown`, so for
 * until B794 the one feature built for somebody who does not want to type was
 * the one feature a keyboard user could not press at all. `onClick`
 * toggles: press to start, press again to stop. See `toggle` for why the two
 * do not fight each other.
 *
 * **The language is chosen, never detected.** The select below is empty by
 * default, which means "whatever this journal is written in" — the server
 * decides that from the journal's own locale. It is remembered per journal so
 * somebody who speaks a different language than they write in says so once.
 * See `lib/helper/speech.ts` for why detection is not on offer.
 *
 * It is also not on the screen until somebody has reached for the microphone
 * — B767. Offered up front it is a question about ASR language codes wearing
 * a friendly label, asked of a person who has not decided to speak yet and
 * whose default is already right. `speaking` is that decision, and a person
 * who never presses the button never sees the select at all.
 *
 * **`compact` is the icon inside the ask box** (B767), where the microphone is
 * a second way to fill one field rather than the point of the screen: no
 * label, no price, 44px, and everything it has to say — consent, the elapsed
 * seconds, the language, an error — rendered in normal flow below the box by
 * the caller's own container rather than floating over it.
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
  provider,
  disabled,
  compact,
  onText,
  label,
  icon,
  compactClassName,
  language: fixedLanguage,
  hold: holdToTalk = true,
  maxSeconds = MAX_SPEECH_SECONDS,
}: {
  username: string;
  /** Whether this journal has already agreed to its owner's voice being sent
   *  — the `speech` scope, and never inferred from the other two. */
  consented: boolean;
  /** Who the recording actually goes to — `speechProvider()`, read on the
   *  server, since the client never has the config to answer this itself.
   *  `"dry-run"` on an instance with no transcriber configured — B744. */
  provider: string;
  disabled?: boolean;
  /** An icon inside somebody else's box rather than a button of its own —
   *  B767. The host must be `relative`, since the icon pins itself to the
   *  host's top right corner. */
  compact?: boolean;
  /** What was said, once. The host decides where it goes; nothing here writes
   *  anything anywhere. */
  onText: (said: string) => void;
  /**
   * What the resting button says, where "hold to talk" is not the whole of it
   * — B981, and so far only the search page, where speaking goes straight to
   * the agent and the button has to say *that*. The price is the host's to
   * include: this replaces the default label, which carried it.
   *
   * Never shown while recording or working — those two lines are this
   * component's own and are the same wherever it is mounted.
   */
  label?: React.ReactNode;
  /**
   * The icon the compact form draws — B986. A microphone by default, because
   * that is what it is everywhere it fills a box; the search page passes its
   * own, where what is said goes to the agent instead.
   */
  icon?: React.ReactNode;
  /**
   * The compact button's own position, size and frame — B986. Defaulted to
   * exactly what the ask box has always had: a bordered 44px circle in a
   * textarea's top right corner. The search page hands over its own, because
   * a bordered circle as tall as a single-line field reads as a second
   * control stuck to the end of it rather than as something in it.
   *
   * The state colours are not overridable and never should be: red while
   * recording is the one thing this control says without words.
   */
  compactClassName?: string;
  /**
   * The language to send, named by the host — B986.
   *
   * When it is given, the select is not drawn at all and this is what is
   * spoken. B767's question ("which language are you speaking?") is right on
   * the wizard, where somebody may well narrate a day in a language they do
   * not write it in. It is wrong in a search box, which the reader has
   * already put into a language, and which is answered in that language.
   */
  language?: string;
  /**
   * Whether a long press is a hold — B1004. True everywhere it always was:
   * the wizard's full-width bar, where a thumb is already on the button and
   * releasing to stop is what a phone does.
   *
   * False in a search field, where it was the whole of "sometimes the
   * microphone works": press, hold a beat, move the mouse away to speak, and
   * `onPointerLeave` ended the recording before the first word. A 44px target
   * in the corner of a text box is not something anybody keeps a pointer on
   * while they talk, so there it is a toggle and nothing but.
   */
  hold?: boolean;
  /**
   * When the recording stops itself — B1006. `MAX_SPEECH_SECONDS` (fifteen
   * minutes) unless a host says otherwise, which is right for dictating a day
   * and absurd for a search box: a search is a sentence, and a microphone
   * left open because somebody walked away is their credits going into
   * silence.
   *
   * The server's own ceiling is unchanged and still the real one; this is the
   * ceiling for *this* use of the control.
   */
  maxSeconds?: number;
}) {
  const { t, locale } = useI18n();
  const [consented, setConsented] = useState(initialConsent);
  const [consenting, setConsenting] = useState(false);
  const [recording, setRecording] = useState(false);
  // Whether speaking has been chosen at all — B767. False until the first
  // press, and the only thing that puts the language select on the screen.
  const [speaking, setSpeaking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [seconds, setSeconds] = useState(0);
  // Lazily, and never from an effect: the remembered choice is read once when
  // this mounts. `remembered` is guarded, so a server render (where there is
  // no `window`) simply starts empty — which is the journal's own language,
  // the correct default anyway.
  const [chosen, setLanguage] = useState(() => remembered(username));
  // The host's choice wins outright where there is one; there is no select to
  // disagree with it, and nothing is remembered from it either.
  const language = fixedLanguage ?? chosen;
  const [error, setError] = useState("");
  // What a screen reader is told, and the only thing about this button that is
  // spoken while it runs — B794.
  const [announced, setAnnounced] = useState("");

  const recorder = useRef<MediaRecorder | null>(null);
  const chunks = useRef<Blob[]>([]);
  const started = useRef(0);
  // When a pointer last pressed this button, so the click that follows a
  // press-and-hold is not read as a second, toggling press. See `toggle`.
  const pressedAt = useRef(0);
  // Whether the recording was already running when that press began — the
  // difference between "a click starts it" and "a click stops it". See `hold`.
  const pressedWhileRecording = useRef(false);
  // Whether the click about to arrive is the tail of a pointer press this
  // component has already acted on. See `toggle`.
  const fromPointer = useRef(false);
  // A stop asked for before there was anything to stop — B995.
  //
  // `start()` awaits `getUserMedia`, which takes tens to hundreds of
  // milliseconds even with the permission already given. A click is shorter
  // than that: `pointerup` arrived while `recorder.current` was still null, so
  // `stop()` found nothing, did nothing, and the recording it was meant to end
  // began a moment later with nobody left to end it. That is the whole of "the
  // microphone does nothing" — it was listening, indefinitely, and the words
  // never went anywhere.
  const wantStop = useRef(false);

  // The stopwatch, and the ceiling. A hold that reaches the cap stops itself
  // rather than being refused by the server after the fact.
  //
  // It ticks at 200ms so the cap is caught promptly, but only *stores* whole
  // seconds — B794. The displayed figure was floored anyway, and the number
  // actually charged is measured at `onstop`, so nothing is lost by it; what
  // is gained is four re-renders a second that nobody could see. The elapsed
  // line is not a live region either, for the same reason: a screen reader
  // cannot speak a counter this fast, and would either flood or drop it. What
  // it hears instead is `announced` below, once at each end of the recording.
  useEffect(() => {
    if (!recording) return;
    const timer = window.setInterval(() => {
      const elapsed = (Date.now() - started.current) / 1000;
      setSeconds(Math.floor(elapsed));
      // The ceiling, and it goes through `stop()` rather than at the recorder
      // directly — B1006. The tick runs every 200ms and the state that ends it
      // arrives a render later, so a bare `recorder.current.stop()` fires
      // again on the next tick: a second `ondataavailable`, a second upload,
      // and a second charge. `stop()` asks whether it is still recording.
      if (elapsed >= maxSeconds) stop();
    }, 200);
    return () => window.clearInterval(timer);
  }, [recording, maxSeconds]);

  const send = useCallback(
    async (blob: Blob, held: number) => {
      setBusy(true);
      setError("");
      try {
        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onerror = () => reject(new Error("read"));
          reader.onload = () =>
            resolve(String(reader.result).split(",")[1] ?? "");
          reader.readAsDataURL(blob);
        });
        const response = await fetch(
          `/api/helper/${encodeURIComponent(username)}/transcribe`,
          {
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
          },
        );
        const body = (await response.json().catch(() => ({}))) as Record<
          string,
          unknown
        >;
        if (!response.ok)
          throw new Error(String(body.error ?? response.status));
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
      setAnnounced(t("agent.speechStopped"));
      const held = (Date.now() - started.current) / 1000;
      const blob = new Blob(chunks.current, { type: media.mimeType });
      chunks.current = [];
      if (blob.size > 0 && held >= 0.5) {
        void send(blob, held);
        return;
      }
      // Half a second of audio is a slip of the finger, not a sentence, and it
      // is not sent. It used to be dropped in silence as well — which, from
      // the outside, is a microphone that listened and then did nothing at
      // all. B995: say so, since it is the whole of what happened.
      setError(t("agent.speechTooShort"));
    };
    recorder.current = media;
    started.current = Date.now();
    setSeconds(0);
    setRecording(true);
    setAnnounced(t("agent.speechStarted"));
    media.start();
    // Somebody let go while the browser was still granting the microphone.
    // Honour it now rather than leaving it open — B995.
    if (wantStop.current) {
      wantStop.current = false;
      media.stop();
    }
  }, [busy, recording, send, t]);

  function stop() {
    if (recorder.current?.state === "recording") {
      recorder.current.stop();
      return;
    }
    // Nothing to stop yet: `start()` is still waiting on the microphone. Say
    // so, and it stops the moment there is something to stop.
    wantStop.current = true;
  }

  async function agree() {
    setBusy(true);
    try {
      const response = await fetch(
        `/api/helper/${encodeURIComponent(username)}/consent`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ scope: "speech" }),
        },
      );
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
        // B781 — one line here, the whole of it behind "why?". The provider is
        // named in both: in the line when there is a real one, and in the
        // expansion always.
        question={
          provider === "dry-run"
            ? t("agent.speechConsentDryRunShort")
            : t("agent.speechConsentShort", { provider })
        }
        details={
          provider === "dry-run"
            ? t("agent.speechConsentDryRun", {
                minutes: String(MINUTES_PER_CREDIT),
              })
            : t("agent.speechConsent", {
                provider,
                minutes: String(MINUTES_PER_CREDIT),
              })
        }
        confirmLabel={t("agent.speechConsentConfirm")}
        busy={busy}
        onConfirm={() => void agree()}
        onCancel={() => setConsenting(false)}
      />
    );
  }

  /** Consent first, and only then does the microphone ever open. The press is
   *  also what says speaking has been chosen, which is what shows the select
   *  below — B767. */
  function press() {
    setSpeaking(true);
    wantStop.current = false;
    if (consented) void start();
    else setConsenting(true);
  }

  /**
   * The keyboard's way in — B794, and the whole reason this control was
   * unreachable. Keyboard and screen-reader activation of a `<button>` fires
   * `click` and never `pointerdown`, so a hold wired only to pointer events is
   * not a hard interaction for somebody driving with a keyboard: it is no
   * interaction at all. Press to start, press again to stop, which is what a
   * native dictation button does and what the accessible name now says.
   *
   * A mouse or a thumb produces `pointerdown` → `pointerup` → `click`, so the
   * trailing click would otherwise restart the recording the release just
   * ended. The guard is the *time* of the last pointer press rather than a
   * flag, because a flag set on `pointerdown` is not always cleared: a pointer
   * that leaves the button ends the hold and never delivers a click, and the
   * stale flag would then swallow the next keyboard press.
   *
   * ponytail: one second is comfortably longer than any pointerdown→click gap
   * and far shorter than any real second press; a per-pointer-id ledger if
   * that ever stops being true.
   */
  function toggle() {
    // The tail of a pointer press, already handled by `hold` below. It used to
    // be a one-second window since the last `pointerdown`, which is fine for a
    // click and wrong for a hold: let go after two seconds and the trailing
    // click sailed past the window and started a *second* recording. A flag is
    // exact, and it cannot go stale — a pointer that leaves the button is
    // delivered no click at all, and clears it on the way out. B995.
    if (fromPointer.current) {
      fromPointer.current = false;
      return;
    }
    if (recording) stop();
    else press();
  }

  /**
   * How long a press has to last to have been a hold — B995.
   *
   * Under this it was a click, and a click is a toggle: press to start, press
   * again to stop, the same thing the keyboard does. Over it, the release ends
   * the recording, which is what "hold to talk" means on a phone.
   *
   * Before this every press was a hold, and a mouse click is forty
   * milliseconds: the release arrived before the microphone had been granted,
   * so nothing stopped and nothing was ever sent.
   *
   * ponytail: 400ms is longer than any click and shorter than any deliberate
   * hold; a pointer-type check (`event.pointerType === "touch"`) if that ever
   * stops being true.
   */
  const HOLD_MS = 400;

  const release = () => {
    // A hold, released — or a click made while it was already running, which
    // is the second half of the toggle. With `hold` off there is no such
    // thing as a hold, so only the second half applies.
    if (
      (holdToTalk && Date.now() - pressedAt.current >= HOLD_MS) ||
      pressedWhileRecording.current
    )
      stop();
  };

  const hold = {
    onPointerDown: () => {
      pressedAt.current = Date.now();
      pressedWhileRecording.current = recording;
      if (!recording) press();
    },
    onPointerUp: release,
    // A pointer leaving ends a hold and must not end a toggle: on a small
    // target it leaves the moment somebody starts speaking — B1004.
    onPointerLeave: holdToTalk ? release : undefined,
    onPointerCancel: release,
    onClick: toggle,
  };

  // The stopwatch, and nothing else. It used to carry what the recording had
  // cost so far — a running price beside a person mid-sentence, which is the
  // same judgement B978 made about the send panel: the tariff belongs where
  // credits are bought, not on somebody's face while they speak. What a hold
  // costs is still said before it, on the button's own label where there is
  // one, and the ledger on `/<user>/me` is what it was actually charged.
  // What the button is called, and it has to be true: with `hold` off there
  // is no holding to talk, and a name that offers it sends somebody looking
  // for an interaction that is not there — B1004.
  const howName = holdToTalk ? t("agent.speechHow") : t("agent.speechHowToggle");

  const heard = busy
    ? t("agent.speechWorking")
    : recording
      ? t("agent.speechRecording", { seconds: String(Math.floor(seconds)) })
      : null;

  /** Only once speaking has been chosen — the default is already the journal's
   *  own language, so this is a correction and never a question. */
  const chooseLanguage = speaking && !fixedLanguage && (
    <>
      <label
        htmlFor={`speech-language-${username}`}
        className="mt-2 block text-sm font-semibold text-navy-800"
      >
        {t("agent.speechLanguage")}
      </label>
      <select
        id={`speech-language-${username}`}
        value={chosen}
        onChange={(event) => {
          setLanguage(event.target.value);
          try {
            window.localStorage.setItem(
              `fs.speech.${username}`,
              event.target.value,
            );
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
    </>
  );

  // `role="alert"` — B813, the same convention B796 gave the wizard's own
  // error line. A denied microphone, an unsupported browser or a recording
  // too short to send are all a problem stopping the one thing this control
  // does; `role="status"` is what the *stopwatch* would be if it were a live
  // region, and announcing a refusal at that same polite priority is how a
  // screen reader user could miss it entirely.
  const failed = error && (
    <p role="alert" className="mt-2 text-sm text-coral-600">
      {error}
    </p>
  );

  /** The one thing spoken aloud about this button, and it changes twice per
   *  recording rather than five times a second — B794. */
  const spoken = (
    <p role="status" className="sr-only">
      {announced}
    </p>
  );

  // The icon in somebody else's box — no words on it, so no price on it
  // either, and nothing to read before the ask box's own line.
  if (compact) {
    return (
      <>
        {/* Not a `BusyButton` — B867 deliberately stops here. A round 44px
            icon button has room for its icon and nothing beside it, and this
            one already reports what it is doing through the icon itself. */}
        <button
          type="button"
          disabled={disabled || busy}
          aria-label={howName}
          {...hold}
          className={`${
            compactClassName ?? "absolute right-2 top-2 h-11 w-11 border"
          } flex items-center justify-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-navy-500 focus-visible:outline-none disabled:opacity-50 ${
            recording
              // Colours that exist — B1004. This used a coral-100 background
              // and coral-700 text when neither was in the palette, so while
              // it was recording the compact button was drawn exactly as it is
              // when it is not: the one state this control has to show,
              // invisible. B1035 has since given coral-100 a value, but these
              // stay as they are — coral-300/30 over coral-600 is the pair
              // that was actually looked at and chosen.
              ? "border-coral-400 bg-coral-300/30 text-coral-600"
              : "border-navy-300 text-navy-700"
          }`}
        >
          {icon ?? <Mic className="h-5 w-5" aria-hidden />}
        </button>
        {heard && <p className="mt-2 text-sm text-navy-700">{heard}</p>}
        {spoken}
        {chooseLanguage}
        {failed}
      </>
    );
  }

  return (
    <div className="mt-3">
      <BusyButton
        // Inverted once, by the codemod that made this a `BusyButton`: it took
        // the first operand of `disabled={disabled || busy}` as the flag
        // without checking it was one, so the button spun while it was
        // disabled and went dead while it was working. The only one of
        // seventy-one it got wrong, and only because this was the only
        // `disabled=` whose busy flag was not written first.
        busy={busy}
        type="button"
        disabled={disabled}
        // The visible text is the price and then the stopwatch; the accessible
        // name is fixed and says how the control is worked — B794. A name that
        // counted seconds would be re-announced on every tick.
        aria-label={howName}
        {...hold}
        className={`min-h-11 w-full rounded-full border px-5 text-base font-semibold disabled:opacity-50 ${
          recording
            ? "border-coral-400 bg-cream-100 text-coral-600"
            : "border-navy-300 text-navy-800"
        }`}
      >
        {/* The price is on the button, before the hold — on the wizard's own
            words step, where speaking is the thing that step is for. */}
        {heard ??
          label ??
          t("agent.speechHold", { minutes: String(MINUTES_PER_CREDIT) })}
      </BusyButton>

      {spoken}
      {chooseLanguage}
      {failed}
    </div>
  );
}
