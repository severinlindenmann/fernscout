"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type Draft = { get: () => Record<string, unknown>; set: (d: Record<string, unknown>) => void };

/**
 * A wizard's current step, in the URL — B2065.
 *
 * The step is `?step=<id>`; a missing or unknown one is `steps[0]`. `go` and
 * `next` push a history entry, so the browser's Back (or a swipe) lands on
 * the previous step instead of leaving the flow, and a reload lands where it
 * was. `back()` is `router.back()`: the step before is the entry before.
 * `total` is `steps.length`, for the step indicator, never a literal.
 *
 * With `draft`, the typed fields survive that reload too: after every render
 * `draft.get()` is written as JSON to sessionStorage under `studio:<flowId>`,
 * and on mount a stored one is handed to `draft.set` once. `reset()` removes
 * it and stops writing until the next `go`/`next` (call it on done, so a
 * finished invite does not come back half-filled), and replaces the URL
 * without `?step=`, so a reload after done starts the flow fresh instead of
 * on an emptied last step. Storage failing — private mode, quota — only
 * means the draft is not kept; the flow still works.
 *
 * A step change scrolls the page to the top (B2079): the new step's heading
 * otherwise lands wherever the last step's button was, under the sticky
 * header. Focus moves to that heading in `StepBody` (B2136).
 *
 * `complete(step)` (B2136) says whether a step the flow cannot go past
 * without has been answered; it returns `true` for a step that is optional
 * or does not apply to this run. A `?step=` beyond the first step before it
 * that is not complete is clamped to that step — rendered there at once and
 * the URL replaced — so a deep link to the last step with nothing answered
 * lands on the first question instead of on a write that must fail. With a
 * `draft`, the clamp waits for the draft to be restored, so a reload is not
 * clamped against the empty fields of its first render.
 *
 * `param` names the query parameter (default `step`), for a flow drawn
 * inside another flow that already owns `?step=` (the figure creator inside
 * "Who was there"). `go(step, extra)` sets `extra` query parameters in the
 * same history entry (people's `?mode=`).
 */
export function useStep<S extends string>(
  steps: readonly S[],
  opts: { flowId: string; draft?: Draft; complete?: (step: S) => boolean; param?: string },
): {
  step: S;
  index: number;
  total: number;
  go: (s: S, extra?: Record<string, string>) => void;
  next: () => void;
  back: () => void;
  reset: () => void;
} {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const param = opts.param ?? "step";
  const asked = Math.max(0, steps.indexOf(params.get(param) as S));
  const [hydrated, setHydrated] = useState(!opts.draft);
  const open = hydrated && opts.complete ? steps.findIndex((s, i) => i < asked && !opts.complete!(s)) : -1;
  const index = open >= 0 ? open : asked;
  const key = `studio:${opts.flowId}`;
  const restored = useRef(false);
  const stopped = useRef(false);
  const shownIndex = useRef(index);

  useEffect(() => {
    if (open < 0) return;
    const q = new URLSearchParams(params.toString());
    q.set(param, steps[open]);
    router.replace(`${pathname}?${q.toString()}`);
    // Only when the clamp itself changes; the URL it writes is what re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (shownIndex.current === index) return;
    shownIndex.current = index;
    // Optional calls: jsdom has no Element.scrollTo, and a test has no page to scroll.
    document.scrollingElement?.scrollTo?.(0, 0);
  }, [index]);

  // No deps on purpose: the first run restores, every later one saves.
  useEffect(() => {
    if (!opts.draft) return;
    if (!restored.current) {
      restored.current = true;
      let stored: string | null = null;
      try {
        stored = sessionStorage.getItem(key);
      } catch {}
      if (stored) {
        try {
          opts.draft.set(JSON.parse(stored) as Record<string, unknown>);
        } catch {}
      }
      return;
    }
    if (stopped.current) return;
    try {
      sessionStorage.setItem(key, JSON.stringify(opts.draft.get()));
    } catch {}
  });

  // After the restore above, in the same commit: the restored fields land in
  // the same render as this, so the clamp judges the draft, not the empty
  // first render.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setHydrated(true), []);

  function go(s: S, extra?: Record<string, string>) {
    stopped.current = false;
    const q = new URLSearchParams(params.toString());
    q.set(param, s);
    for (const [k, v] of Object.entries(extra ?? {})) q.set(k, v);
    router.push(`${pathname}?${q.toString()}`);
  }

  return {
    step: steps[index],
    index,
    total: steps.length,
    go,
    next: () => {
      if (index < steps.length - 1) go(steps[index + 1]);
    },
    back: () => {
      if (index > 0) router.back();
    },
    reset: () => {
      stopped.current = true;
      try {
        sessionStorage.removeItem(key);
      } catch {}
      const q = new URLSearchParams(params.toString());
      q.delete(param);
      const rest = q.toString();
      router.replace(rest ? `${pathname}?${rest}` : pathname);
    },
  };
}
