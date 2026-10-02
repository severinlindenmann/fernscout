"use client";

import type { ComponentProps, ReactNode } from "react";
import AddDayFlow from "./AddDayFlow";

/**
 * The Write page's own thin shell — B2676 (V2.1).
 *
 * Everything that used to live here — "with or without the assistant"
 * (asked once, behind a gate that failed silently and came back every time
 * the switch was turned on, P1), the separate "N parts?" interstitial, and
 * the hand-off to a per-part re-mount of `AddDayFlow` — is gone. There is
 * one page now: `AddDayFlow` *is* the Write page, with every part (when the
 * day is split) stacked on it rather than stepped through one at a time,
 * and the microphone follows the `transcription` capability alone, with its
 * own per-use consent (`RecordButton`'s `consented`/`agree()`), never an
 * assistant switch in front of it.
 *
 * All that is left for this wrapper is the one piece of chrome that sits
 * above the composer rather than inside it: the plan's AI-days counter.
 */
export default function DayFlow(
  props: ComponentProps<typeof AddDayFlow> & {
    /** B2649 — the plan's AI-days counter, shown above the composer. */
    aiDays?: ReactNode;
  },
) {
  const { aiDays = null, ...composer } = props;
  return (
    <>
      {aiDays && <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">{aiDays}</div>}
      <AddDayFlow {...composer} />
    </>
  );
}
