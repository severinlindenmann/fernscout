"use client";

import { useState, useSyncExternalStore } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Camera, Keyboard, Mic, Volume2, type LucideIcon } from "lucide-react";
import RecordButton from "@/components/RecordButton";
import { useI18n } from "@/components/LocaleProvider";
import StepPrimary from "@/components/studio/StepPrimary";
import StepBody from "@/components/studio/StepBody";
import StepIndicator from "@/components/extract/StepIndicator";
import { useOnline } from "@/components/studio/useOnline";
import { MINUTES_PER_CREDIT, creditsForSeconds } from "@/lib/helper/speech";
import { useStep } from "@/lib/studio/useStep";
import { assembleSpokenDay, SPEAK_QUESTIONS, type SpeakQuestion, type TellBy } from "@/lib/studio/speak";
import { hasOutbox, newIntent, openOutboxStore } from "@/lib/outbox";

const LINK = "min-h-11 text-left text-sm font-semibold text-ink-body underline underline-offset-2";
const noSubscribe = () => () => {};

/**
 * "How do you like to tell it?" — B2194. Asked once, on Add a day, only when
 * transcription is on; the host saves the answer and it is changed in
 * Journal settings afterwards.
 */
export function TellByChoice({ onChoose }: { onChoose: (choice: TellBy) => void }) {
  const { t } = useI18n();
  const options: { value: TellBy; Icon: LucideIcon }[] = [
    { value: "photos", Icon: Camera },
    { value: "speak", Icon: Mic },
    { value: "type", Icon: Keyboard },
  ];
  return (
    <StepBody step="tellBy">
      <h2 className="mt-6 font-display text-2xl font-semibold text-ink-strong">{t("studio.day.tellBy.heading")}</h2>
      <p className="mt-1 text-sm text-ink-body">{t("studio.day.tellBy.hint")}</p>
      <div className="mt-4 grid gap-3">
        {options.map(({ value, Icon }) => (
          <button
            key={value}
            type="button"
            data-tell-by={value}
            onClick={() => onChoose(value)}
            className="flex min-h-16 items-center gap-4 rounded-2xl border border-line-strong bg-surface-raised px-4 py-4 text-left hover:bg-surface-subtle"
          >
            <Icon aria-hidden className="h-7 w-7 flex-none text-ink-strong" />
            <span>
              <span className="block font-display text-xl font-semibold text-ink-strong">{t(`studio.day.tellBy.${value}`)}</span>
              <span className="block text-sm text-ink-secondary">{t(`studio.day.tellBy.${value}Hint`)}</span>
            </span>
          </button>
        ))}
      </div>
    </StepBody>
  );
}

/**
 * A day by voice — B2194. One question per screen; each answer is the
 * person's own transcript, shown in a box they can correct before moving on.
 * `onDone` gets exactly those answers as paragraphs (`assembleSpokenDay`);
 * the host puts them in the composer, where saving is the usual "Save
 * privately". Nothing is written from here.
 */
export default function SpeakFlow({
  username,
  date,
  speech,
  photoFact,
  onDone,
  onType,
}: {
  username: string;
  /** B2331 — the day this recording is for, so a note taken while offline
   *  can be queued against a date the owner will recognise once it comes
   *  back transcribed, rather than needing the day itself to exist yet. */
  date: string;
  /** `credits` is `null` when the host does not know the balance (helper's
   *  own gate is off) — B2234, the same "unknown means unchecked" `null`
   *  `RecordButton`'s own `credits` prop takes. */
  speech: { consented: boolean; provider: string; credits: number | null; priceChf: string | null };
  /** A real fact from the chosen photographs — how many carry this place —
   *  or `null`. Only ever cited, never used to suggest an answer. */
  photoFact: { count: number; place: string } | null;
  onDone: (text: string) => void;
  onType: () => void;
}) {
  const { t, tn, locale } = useI18n();
  const [answers, setAnswers] = useState<Partial<Record<SpeakQuestion, string>>>({});
  // B2331, D4 — the server's own reachability (shared with the pill), not
  // just `navigator.onLine`: a recording made with the wifi up and this
  // server unreachable is exactly the case that has to queue rather than
  // fail. `queuedNotice` says once per answer that this one is waiting
  // rather than transcribed yet — cleared the moment a new question loads.
  const online = useOnline();
  const [queuedNotice, setQueuedNotice] = useState(false);
  const { step, index, total, go, reset } = useStep(SPEAK_QUESTIONS, {
    flowId: `addDay:speak:${username}`,
    param: "q",
    draft: {
      get: () => ({ answers }),
      set: (d) => {
        const a = d.answers;
        if (!a || typeof a !== "object") return;
        setAnswers(
          Object.fromEntries(
            SPEAK_QUESTIONS.flatMap((q) => {
              const v = (a as Record<string, unknown>)[q];
              return typeof v === "string" ? [[q, v]] : [];
            }),
          ),
        );
      },
    },
  });
  // The browser's own voice, free and optional: absent where there is none.
  const canReadAloud = useSyncExternalStore(noSubscribe, () => "speechSynthesis" in window, () => false);

  const question =
    step === "did" && photoFact
      ? tn("studio.day.speak.q.didPhotos", photoFact.count, { count: String(photoFact.count), place: photoFact.place })
      : t(`studio.day.speak.q.${step}`);
  const answer = answers[step] ?? "";
  const last = index === total - 1;
  const price = new Intl.NumberFormat(locale).format(1 / MINUTES_PER_CREDIT);
  // B2288 — computed server-side (`speech.priceChf`), same pattern as
  // `PolishText`'s own price (B2254): pricing is paid-only code after the
  // open-core split, so this component never imports it. `null` on a public
  // build or whenever pricing is unavailable, and the line below goes quiet
  // with it rather than showing a wrong CHF 0.00.
  const money = speech.priceChf;
  // B2234 — the same floor `RecordButton`'s own `credits` prop refuses the
  // tap on; the price line below is the button's, so it goes quiet with it
  // rather than quoting a price beside a notice that there is nothing to pay
  // it with.
  const insufficientCredits = speech.credits != null && speech.credits < creditsForSeconds(0);

  function next(a: Partial<Record<SpeakQuestion, string>>) {
    setQueuedNotice(false);
    if (!last) return go(SPEAK_QUESTIONS[index + 1]);
    reset();
    onDone(assembleSpokenDay(a));
  }

  /**
   * B2331, D4 — a recording made with no server reachable: still records
   * (`RecordButton` itself never changes), but the audio waits in the
   * outbox as its own `Blob` rather than going nowhere. Nothing is written
   * into `answers` here — there is no transcript yet, and D4 refuses to
   * insert one silently once there is: the owner moves on (skip, type, or
   * the next question) and sees this one on the day itself, later, to
   * confirm.
   */
  function queueVoiceNote(blob: Blob, heldSeconds: number, language: string, recordedLocale: string) {
    if (!hasOutbox()) return;
    void openOutboxStore().add(
      newIntent({
        user: username,
        kind: "voice.note",
        method: "POST",
        url: `/api/helper/${encodeURIComponent(username)}/transcribe`,
        body: {
          date,
          mediaType: blob.type,
          seconds: heldSeconds,
          language,
          locale: recordedLocale,
          idempotency_key: `${username}/${date}/${Date.now()}`,
        },
        blob,
      }),
    );
    setQueuedNotice(true);
  }
  function skip() {
    const rest = { ...answers };
    delete rest[step];
    setAnswers(rest);
    next(rest);
  }
  function readAloud() {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(question);
    utterance.lang = locale;
    window.speechSynthesis.speak(utterance);
  }

  return (
    <StepBody step={step}>
      <div className="mt-4">
        <StepIndicator total={total} current={index + 1} label={t("studio.day.firstRun.stepLabel", { current: String(index + 1), total: String(total) })} />
      </div>
      <h2 className="mt-6 font-display text-3xl font-semibold leading-tight text-ink-strong">{question}</h2>
      <p className="mt-2 text-base text-ink-body">{t("studio.day.speak.hint")}</p>
      {canReadAloud && (
        <button type="button" data-read-aloud onClick={readAloud} className={`mt-1 inline-flex items-center gap-2 ${LINK}`}>
          <Volume2 aria-hidden className="h-4 w-4" />
          {t("studio.day.speak.readAloud")}
        </button>
      )}

      <div className="fs-ask-dark mt-4 rounded-2xl px-4 py-5">
        <RecordButton
          username={username}
          consented={speech.consented}
          provider={speech.provider}
          credits={speech.credits}
          hero
          hold={false}
          onText={(said) => setAnswers((prev) => ({ ...prev, [step]: prev[step] ? `${prev[step]} ${said}` : said }))}
          onOffline={online ? undefined : queueVoiceNote}
        />
        {queuedNotice && (
          <p role="status" className="mt-1 text-center text-sm text-cream-50">
            {t("studio.day.speak.queued")}
          </p>
        )}
        {!insufficientCredits && !queuedNotice && (
          <p className="mt-1 text-center text-sm text-cream-50">
            {money == null
              ? t("studio.day.speak.priceNoMoney", { price })
              : t("studio.day.speak.price", { price, money })}
          </p>
        )}
      </div>

      <label htmlFor="studio-speak-answer" className="mt-4 block text-sm font-semibold text-ink-strong">
        {answer ? t("studio.day.speak.answerLabel") : t("studio.day.speak.typeLabel")}
      </label>
      <textarea
        id="studio-speak-answer"
        value={answer}
        onChange={(e) => setAnswers((prev) => ({ ...prev, [step]: e.target.value }))}
        className="mt-1 block min-h-28 w-full rounded-xl border border-line-strong bg-surface-base px-3 py-2 text-base text-ink-body"
      />

      <div className="mt-3 flex flex-col items-start">
        <button type="button" onClick={skip} className={LINK}>
          {t("studio.day.speak.skip")}
        </button>
        <button type="button" onClick={onType} className={LINK}>
          {t("studio.day.speak.type")}
        </button>
      </div>
      <StepPrimary
        disabled={!answer.trim()}
        onClick={() => next(answers)}
        label={last ? t("studio.day.speak.finish") : t("studio.day.speak.next")}
      />
    </StepBody>
  );
}

/**
 * "Rather talk?" — B2236. Once "How do you like to tell it?" has been
 * answered with anything but Speak, the only way back was Journal settings —
 * Ruth would never find that. A quiet line near the composer's own text box
 * opens the spoken questions instead, and remembers the choice the same way
 * the original question does, through the one tell-by PATCH (B2194).
 *
 * Self-contained — its own fetch and its own navigation — so the composer
 * that mounts it does so in a single line rather than wiring a callback
 * through state it does not otherwise need.
 */
export function RatherTalk({
  username,
  speech,
  tellBy,
}: {
  username: string;
  speech: { consented: boolean; provider: string; credits: number | null; priceChf: string | null } | null;
  tellBy: TellBy | null;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const params = useSearchParams();
  if (!speech || tellBy === "speak") return null;

  function choose() {
    void fetch(`/api/web/${encodeURIComponent(username)}/studio/tell-by`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tellBy: "speak" }),
    }).catch(() => {});
    const q = new URLSearchParams(params.toString());
    q.set("mode", "speak");
    router.replace(`/${username}/studio/day/new?${q.toString()}`);
  }

  return (
    <button type="button" data-rather-talk onClick={choose} className={LINK}>
      {t("studio.day.speak.ratherTalk")}
    </button>
  );
}
