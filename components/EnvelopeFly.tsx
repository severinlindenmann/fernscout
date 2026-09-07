"use client";

import { motion } from "motion/react";

/**
 * The letter that leaves — B753.
 *
 * Pressing "Send me a code" is the only moment in signing in where something
 * actually leaves the building, and until this the interface gave no sign of
 * it: the button went disabled and the code field arrived, often too fast on
 * a good connection to register as anything having happened at all. This is
 * the answer — a short flight up and away, under half a second, drawn rather
 * than imported: flat fills and a hairline stroke in the same vocabulary as
 * `components/travel/Vehicle.tsx`, with one small corner of airmail stripe as
 * the envelope's own detail. That is a different use of the motif from the
 * striped panel border B751 retired — there it was decorative framing around
 * quiet content; here it is the one thing an airmail corner has always meant,
 * on the one object in this product that is actually being posted.
 *
 * **Fires once per mount** — the caller keys this component (or conditionally
 * renders it) so a fresh `key` restarts the flight on every send, and un-
 * mounts it once the transition ends. It does not know whether the send
 * succeeded or failed: `IdentitySignIn` starts it the moment a request goes
 * out and lets it finish on its own short clock, so a slow failure is never
 * something the envelope is still flying over (B753's acceptance).
 *
 * **It is positioned against the button, not the panel** — B762. It used to
 * anchor `right-4 top-4` against the section, which carries `relative`, so it
 * always started in the panel's top corner however far the button was from
 * there, and the section's `overflow-hidden` then trimmed the flight partway.
 * The gesture only reads as "this left because I pressed that" if it starts
 * at the thing pressed, so the caller wraps its button in the positioned
 * container and this centres itself on it.
 *
 * `prefers-reduced-motion` skips the flight outright — `useReducedMotion`
 * returns true and this renders nothing, which is also why the caller's own
 * state change (the code field arriving) can never depend on this having
 * played.
 */
export default function EnvelopeFly({
  origin,
  onDone,
}: {
  /** Where the flight starts, in the positioned ancestor's coordinates — the
   *  centre of the button that was pressed. See `IdentitySignIn`. */
  origin: { x: number; y: number };
  /** Called once the flight finishes, so the caller can unmount this. Not
   * called at all when reduced motion skips the flight — the caller decides
   * whether to render this in the first place from its own
   * `useReducedMotion()` read, so nothing here depends on `onDone` firing. */
  onDone?: () => void;
}) {
  return (
    <motion.svg
      viewBox="0 0 48 32"
      width="40"
      height="27"
      aria-hidden="true"
      className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2"
      style={{ left: origin.x, top: origin.y }}
      initial={{ opacity: 1, x: 0, y: 0, rotate: 0 }}
      animate={{ opacity: 0, x: 60, y: -56, rotate: -12 }}
      transition={{ duration: 0.45, ease: "easeIn" }}
      onAnimationComplete={onDone}
    >
      {/* Envelope body */}
      <rect
        x="1"
        y="1"
        width="46"
        height="30"
        rx="3"
        fill="var(--color-cream-50)"
        stroke="var(--color-navy-900)"
        strokeWidth="1.5"
      />
      {/* The open flap */}
      <path
        d="M2 3 L24 19 L46 3"
        fill="none"
        stroke="var(--color-navy-900)"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      {/* One corner of airmail stripe — the motif's actual meaning, not a
          border around something else. */}
      <path d="M36 1 L47 1 L47 8.5 Z" fill="var(--color-coral-600)" />
      <path d="M42 1 L47 1 L47 4.8 Z" fill="var(--color-sky-500)" />
    </motion.svg>
  );
}
