"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import { useI18n } from "@/components/LocaleProvider";
import type { TranslationKey } from "@/lib/i18n";

/**
 * B1221 — a ~30-second scripted conversation, behind a quiet control on the
 * signed-out door, so a stranger sees what talking to the room is like
 * before they sign up for anything.
 *
 * **Scripted, not live.** `SCRIPT` below is fixed text, replayed on timers —
 * no model call, no journal, no network. The invented day (a hike at Creux
 * du Van) is fictional by design and named as a demo throughout: a badge
 * above the transcript, and never a claim that anything here was actually
 * written or saved.
 *
 * **`prefers-reduced-motion` skips the timers outright** rather than merely
 * shortening them, the same rule `EnvelopeFly` and `IdentitySignIn` follow —
 * the whole transcript renders at once.
 *
 * **The calm rule holds.** The mock proposal's "accept" button is `disabled`
 * and not part of the tab order: it is furniture describing what a real
 * press looks like, not a second live button beside the door's one bright
 * (yellow) call to action. It is styled navy, the same colour the real
 * accept button in `HelperAsk` uses.
 */

type Beat =
  | { kind: "you"; textKey: TranslationKey }
  | { kind: "room"; textKey: TranslationKey }
  | { kind: "proposal"; titleKey: TranslationKey; sentenceKey: TranslationKey; acceptKey: TranslationKey }
  | { kind: "press" }
  | { kind: "done"; textKey: TranslationKey };

const SCRIPT: Beat[] = [
  { kind: "you", textKey: "agent.demoYou1" },
  { kind: "room", textKey: "agent.demoRoom1" },
  {
    kind: "proposal",
    titleKey: "agent.demoProposalTitle",
    sentenceKey: "agent.demoProposalSentence",
    acceptKey: "agent.demoAccept",
  },
  { kind: "press" },
  { kind: "done", textKey: "agent.demoDone" },
];

/** How long to wait before each beat appears, tuned to read like a real
 *  exchange rather than a list — a short pause before the reply, a longer
 *  beat while the proposal is "read", a brief one for the press itself. */
const DELAY_MS = [600, 1400, 1600, 700, 900];

function DemoBeat({ beat, pressed }: { beat: Beat; pressed: boolean }) {
  const { t } = useI18n();
  switch (beat.kind) {
    case "you":
      return (
        <p className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-navy-800 px-4 py-2 text-base leading-6 text-cream-50">
          {t(beat.textKey)}
        </p>
      );
    case "room":
      return (
        <p className="max-w-[85%] rounded-2xl rounded-bl-sm border border-navy-200 bg-white px-4 py-2 text-base leading-6 text-navy-900">
          {t(beat.textKey)}
        </p>
      );
    case "proposal":
      return (
        <div className="rounded-xl border border-navy-200 bg-white p-4 shadow-sm">
          <p className="text-sm font-semibold text-navy-700">{t(beat.titleKey)}</p>
          <p className="mt-1 text-base leading-6 text-navy-900">{t(beat.sentenceKey)}</p>
          {/* Decorative — this is what a real proposal's accept button looks
              like, not a second live control. `disabled` and out of the tab
              order on purpose; see the module comment. */}
          <button
            type="button"
            disabled
            tabIndex={-1}
            aria-hidden="true"
            className={`mt-3 min-h-11 rounded-full px-5 text-base font-semibold text-cream-50 transition-colors ${
              pressed ? "bg-navy-900" : "bg-navy-800"
            }`}
          >
            {t(beat.acceptKey)}
          </button>
        </div>
      );
    case "press":
      return null;
    case "done":
      return <p className="text-sm leading-6 text-navy-600">{t(beat.textKey)}</p>;
  }
}

export default function DoorDemo() {
  const { t } = useI18n();
  const reduceMotion = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState(0);
  const [pressed, setPressed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  function play() {
    setOpen(true);
    clearTimeout(timer.current);
    if (reduceMotion) {
      setShown(SCRIPT.length);
      setPressed(true);
      return;
    }
    setShown(0);
    setPressed(false);
    let i = 0;
    const step = () => {
      i += 1;
      setShown(i);
      if (SCRIPT[i - 1]?.kind === "press") setPressed(true);
      if (i < SCRIPT.length) timer.current = setTimeout(step, DELAY_MS[i]);
    };
    timer.current = setTimeout(step, DELAY_MS[0]);
  }

  useEffect(() => () => clearTimeout(timer.current), []);

  if (!open) {
    return (
      <button
        type="button"
        onClick={play}
        className="mt-3 min-h-11 text-base text-navy-600 underline underline-offset-4 hover:text-navy-900"
      >
        {t("agent.demoTrigger")}
      </button>
    );
  }

  return (
    <section
      aria-label={t("agent.demoLabel")}
      className="mt-3 rounded-2xl border border-navy-200 bg-cream-50 p-4 sm:p-5"
    >
      <p className="mb-3 inline-flex items-center rounded-full bg-navy-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-navy-700">
        {t("agent.demoBadge")}
      </p>
      <div className="space-y-3">
        {SCRIPT.slice(0, shown).map((beat, i) => (
          <DemoBeat key={i} beat={beat} pressed={pressed} />
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-4">
        <button
          type="button"
          onClick={play}
          className="min-h-11 text-sm text-navy-600 underline underline-offset-4 hover:text-navy-900"
        >
          {t("agent.demoReplay")}
        </button>
        <button
          type="button"
          onClick={() => {
            clearTimeout(timer.current);
            setOpen(false);
          }}
          className="min-h-11 text-sm text-navy-600 underline underline-offset-4 hover:text-navy-900"
        >
          {t("agent.demoClose")}
        </button>
      </div>
    </section>
  );
}
