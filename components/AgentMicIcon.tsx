/**
 * Speaking to the agent — B986.
 *
 * A microphone with the agent's spark where a plain microphone would have
 * nothing, because on the search page what is said does not fill the box: it
 * goes to a model and comes back as an answer. A bare `Mic` promised the
 * first thing and did the second.
 *
 * Drawn to sit among the lucide icons beside it rather than beside them: the
 * same 24 viewBox, the same round caps and joins, the same 2.2 stroke this
 * codebase passes those, and `currentColor` throughout — so it inherits its
 * colour from the button and needs no palette of its own. Nothing here is the
 * brand mark; the waymark is never redrawn (see the `apply-the-brand` skill),
 * and this is a control's icon.
 *
 * The microphone is drawn smaller than lucide's `Mic` and pushed left, so the
 * spark has the top right corner to itself. Both halves have to survive 20px,
 * which is the only size this is ever drawn at: the first attempt cut the
 * cradle short to make room and read as a hook.
 */
export default function AgentMicIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {/* A whole microphone, drawn small and to the left: capsule, a cradle
          that is symmetrical about it (a half-drawn one reads as a hook, which
          is what the first attempt looked like at 20px), stem, base. */}
      <rect x="7" y="2" width="6" height="9.5" rx="3" />
      <path d="M4.8 10.6v1.1a5.2 5.2 0 0 0 10.4 0v-1.1" />
      <path d="M10 16.9V20" />
      <path d="M7 20h6" />
      {/* The spark, clear of the cradle in the top right corner — the same
          four-pointed star this product draws for the agent, one of them and
          large, so it is still a star at 20px rather than three specks. */}
      <path d="M19 2.4 20.1 5l2.6 1.1-2.6 1.1L19 9.8l-1.1-2.6L15.3 6.1 17.9 5z" />
    </svg>
  );
}
