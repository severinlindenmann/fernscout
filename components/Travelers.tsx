"use client";

import { motion, useReducedMotion } from "motion/react";
import { arrangeParty, fitPartyWidth } from "@/lib/travellers/layout";
import { renderFigure } from "@/lib/travellers/render";
import type { Figure } from "@/lib/travellers/vocabulary";

/**
 * The people on this trip, walking.
 *
 * There are no colours in this file. Every one of them used to be a module
 * constant here — `const HIM = { skin: "#f7d7bb", … }` — drawn as a likeness
 * of one particular couple and then hard-coded into every journal on earth, so
 * that a solo traveller's site showed two people and anybody who was not white
 * showed two white people, on the first screen, before a word had been read.
 * They live in `lib/travellers/vocabulary.ts` now, and which ones a journal
 * uses is `travellers:` in its trip or its config.
 *
 * The drawing is `lib/travellers/render.ts` and the arrangement is
 * `lib/travellers/layout.ts`; both are pure so that the preview endpoint and
 * the sheet script can use them without a browser. This component is the
 * wrapper that gives them a gait.
 */
export default function Travelers({
  figures,
  size = 76,
  /**
   * How much room there is. Figures shrink together rather than the party
   * overflowing, because a hero on a phone is narrower than five travellers
   * at their nominal size.
   */
  available,
}: {
  figures?: Figure[];
  size?: number;
  available?: number;
}) {
  const reduced = useReducedMotion();

  // One neutral figure when nothing has been configured — never the two that
  // used to be here. `partyFor` says the same thing on the server side; this
  // is the last line of it, for a caller that passes nothing at all.
  const party = figures && figures.length > 0 ? figures : [{}];

  const width = available ? fitPartyWidth(party.length, available, size) : size;
  const { placements, width: total, height } = arrangeParty(party, width);

  return (
    <div
      className="relative"
      style={{ width: total, height }}
      role="group"
      aria-label={
        party.length === 1 ? "an illustrated traveller" : `${party.length} illustrated travellers`
      }
    >
      {placements.map((p) => (
        <motion.div
          key={p.index}
          className="absolute origin-bottom"
          style={{ left: p.x, bottom: p.bottom, scale: p.scale }}
          // The gait offset is per figure and comes from its index, so a group
          // never bobs in lockstep and never bobs differently on two loads.
          animate={reduced ? undefined : { y: [0, -2.5, 0] }}
          transition={
            reduced
              ? undefined
              : { duration: 1.8, repeat: Infinity, ease: "easeInOut", delay: p.delay }
          }
          // The renderer returns a complete <svg> element as a string. It has
          // to: the same function answers the preview route and the sheet
          // script, neither of which has React.
          dangerouslySetInnerHTML={{
            __html: renderFigure(p.figure, { width, decorative: true }),
          }}
        />
      ))}
    </div>
  );
}
