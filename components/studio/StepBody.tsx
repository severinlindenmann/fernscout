"use client";

import { useEffect, useRef } from "react";

/**
 * A wizard's step, as one box that is new every time the step changes —
 * B2094. The `key` is what makes it new: the fade in `app/globals.css`
 * (`.studio-step`) is a CSS animation, which runs when an element is
 * inserted and never on a re-render, so a remount per step is exactly one
 * fade per step change. State kept in the flow above survives; nothing in a
 * step should hold state it needs in the next one.
 *
 * On every step change after the first render, focus moves to the new
 * step's heading (B2136) — its h2, or the page's h1 for a step with none —
 * so a keyboard or screen-reader user starts on the new question instead of
 * on `body`. Not on the first render: loading a page does not steal focus.
 */
export default function StepBody({ step, children }: { step: string; children: React.ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const shown = useRef(step);
  useEffect(() => {
    if (shown.current === step) return;
    shown.current = step;
    const heading = box.current?.querySelector<HTMLElement>("h2") ?? document.querySelector<HTMLElement>("h1");
    if (!heading) return;
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }, [step]);
  return (
    <div key={step} ref={box} className="studio-step">
      {children}
    </div>
  );
}
