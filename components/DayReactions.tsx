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
  const { t } = useI18n();
  const reactions = useReactions();
  if (!reactions) return null;

  const { countsFor, mineFor, react, ready } = reactions;
  const counts = countsFor(daySlug);
  const mine = mineFor(daySlug);
  const total = Object.values(counts).reduce((n, c) => n + (c ?? 0), 0);

  return (
    <div className="mt-8 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-navy-200 pt-5">
      <span className="text-xs text-navy-600">{t("react.prompt")}</span>
      <div className="flex flex-wrap gap-2">
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
      {total > 0 && (
        <span className="text-[11px] text-navy-600" aria-live="polite">
          {total}
        </span>
      )}
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
      className={`flex min-h-11 min-w-11 items-center justify-center gap-1.5 rounded-full border px-3.5 text-sm transition-colors disabled:opacity-50 ${
        selected
          ? "border-yellow-600 bg-yellow-400 text-yellow-950"
          : "border-navy-200 bg-white text-navy-700 hover:border-navy-500"
      }`}
    >
      <span aria-hidden className="text-xl leading-none">
        {emoji}
      </span>
      <span className="font-display text-sm font-semibold tabular-nums">{count}</span>
    </motion.button>
  );
}
