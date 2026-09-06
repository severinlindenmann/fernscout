"use client";

import { motion } from "motion/react";
import { REACTIONS, type Reaction } from "@/lib/reactionSet";
import { useI18n } from "./LocaleProvider";
import { useReactions } from "./ReactionsProvider";

/**
 * Three taps' worth of feedback on a day.
 *
 * On identity: this is a random id kept in localStorage, not a browser
 * fingerprint. Canvas/font fingerprinting would be no harder to defeat — clear
 * storage, open a private window, and either approach lets you vote again —
 * but it collects data about the reader without asking, which for visitors in
 * the EU needs consent we have no way to obtain here. The random id does the
 * same job for the same cost and knows nothing about anyone. Rate limiting on
 * the server covers the scripted case; a determined person voting twice is not
 * a threat worth engineering against on a family travel blog.
 */
export default function DayReactions({ daySlug }: { daySlug: string }) {
  const { t, tn } = useI18n();
  const reactions = useReactions();
  if (!reactions) return null;

  const { countsFor, mineFor, react, ready } = reactions;
  const counts = countsFor(daySlug);
  const mine = mineFor(daySlug);
  const total = Object.values(counts).reduce((n, c) => n + (c ?? 0), 0);

  return (
    // The rule and the space above it belong to the day card, which is the
    // only thing that renders this — a second border here drew two lines a
    // few pixels apart.
    <div>
      {/* The prompt on its own line rather than inline with the choices: at
          390px a question plus three of them wraps, and what wraps is the last
          choice — which then reads as a stray control under the other two. */}
      <span className="block text-xs text-navy-600">{t("react.prompt")}</span>
      <div className="mt-1 flex flex-wrap items-center gap-1">
        {REACTIONS.map((emoji) => (
          <ReactionButton
            key={emoji}
            emoji={emoji}
            count={counts[emoji] ?? 0}
            selected={mine === emoji}
            disabled={!ready}
            onClick={() => react(daySlug, emoji)}
          />
        ))}
      </div>
      {/*
        The running total, for a screen reader and for nobody else.

        It used to render: a bare `1` in 11px, after three buttons that each
        already carry their own count, wrapping onto a line of its own where it
        read as a stray digit dropped under the day. Every number a sighted
        reader needs is on the buttons. What the element is actually for is the
        `aria-live` announcement — which needs words, not a digit, so it says
        how many and stays out of the layout.
      */}
      <span className="sr-only" aria-live="polite">
        {total > 0 ? tn("react.total", total, { count: String(total) }) : ""}
      </span>
    </div>
  );
}

function ReactionButton({
  emoji,
  count,
  selected,
  disabled,
  onClick,
}: {
  emoji: Reaction;
  count: number;
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const { t } = useI18n();
  return (
    <motion.button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      aria-label={selected ? `${emoji} — ${t("react.yours")}` : emoji}
      whileTap={{ scale: 0.92 }}
      // No border and no fill: three outlined pills at the foot of somebody's
      // day looked like a form, and a form is the one thing this software
      // does not have. What marks the reader's own choice is the emoji sitting
      // in a waymark-yellow disc — the same accent as the day marker at the
      // top of the page, and the only place the colour appears down here.
      className="group flex min-h-11 items-center gap-1.5 rounded-full px-1.5 transition-colors disabled:opacity-50"
    >
      <span
        aria-hidden
        className={`flex h-8 w-8 items-center justify-center rounded-full text-xl leading-none transition-colors ${
          selected ? "bg-yellow-400" : "group-hover:bg-cream-100"
        }`}
      >
        {emoji}
      </span>
      <span
        className={`font-display text-sm font-semibold tabular-nums ${
          selected ? "text-navy-900" : "text-navy-600 group-hover:text-navy-900"
        }`}
      >
        {count}
      </span>
    </motion.button>
  );
}
