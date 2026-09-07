"use client";

import { type Dispatch, type SetStateAction, useEffect, useState } from "react";

/**
 * A piece of state that adopts a saved value from `localStorage` once
 * mounted, and writes every later change back to the same key — B507 and,
 * before it, B511.
 *
 * **Read after mounting, never in the initialiser.** The server renders this
 * tree too and has no `localStorage`, so reading it during the initial render
 * makes the first client render disagree with the server's and React throws
 * the tree away and rebuilds ("Minified React error #418"). The cost of
 * waiting for an effect is one frame of `initial` before the stored value
 * arrives, which is the standard trade-off and is invisible at this size.
 *
 * **The restored flag is *state*, not a ref.** A ref that flips inside the
 * restore effect reads as true again before the `setValue` it just queued has
 * actually landed in a render — so under React's Strict Mode
 * development-only double-effect invocation, the persist effect below runs
 * with the ref already true and this render's still-`initial` value,
 * overwriting a genuinely saved value with nothing. It happened to the
 * photobook composer: an arrangement written to `localStorage` was gone after
 * the very next reload, in `next dev` only — `next start` never raced,
 * because Strict Mode's double invocation is dev-only. Tying the guard to
 * state instead means the flip and the restored value land in the *same*
 * render, so the persist effect's first meaningful run always sees the
 * restored value and never the `initial` it would otherwise race against.
 * See `test/photobook-persistence.test.tsx` for the regression this fixes.
 */
export function usePersistedState<T>(
  storageKey: string,
  initial: T,
  /** Given the raw string last saved and the value the hook would otherwise
   * start from, return what state should adopt. Called once, in an effect,
   * with whatever `localStorage.getItem(storageKey)` returned — `null` is
   * never passed in; nothing is called when there is nothing saved. */
  restore: (saved: string, current: T) => T,
): [T, Dispatch<SetStateAction<T>>, boolean | null] {
  const [value, setValue] = useState<T>(initial);
  const [restored, setRestored] = useState(false);
  /**
   * Whether anything was actually stored under this key — B704.
   *
   * `null` until the effect below has looked, which is the honest answer for
   * the server's render and for the first client one: nothing has read
   * `localStorage` yet, so nothing can say. A caller that shows one thing to
   * somebody arriving for the first time and another to somebody coming back
   * has to wait for this rather than guess, or it shows the wrong one for a
   * frame and then swaps it out underneath them.
   *
   * Separate from `restored`, which goes true either way and is about when it
   * is safe to start writing.
   */
  const [hadSaved, setHadSaved] = useState<boolean | null>(null);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(storageKey);
      // Both of these are the whole point of the effect: reading an external
      // store after mounting is exactly the case the rule's own note calls
      // "subscribe for updates from some external system".
      /* eslint-disable react-hooks/set-state-in-effect */
      setHadSaved(saved !== null);
      if (saved) {
        setValue((v) => restore(saved, v));
      }
    } catch {
      // A stored value that will not read or parse is one nobody can use —
      // start from `initial` instead, same as a first-ever visit. Which is
      // also what `hadSaved` should say: a store that throws has nothing
      // usable in it.
      setHadSaved(false);
    }
    setRestored(true);
    /* eslint-enable react-hooks/set-state-in-effect */
    // `restore` is deliberately not a dependency: it is a fresh closure on
    // every render of the caller, and this must run exactly once per
    // `storageKey` — the same contract the inline version it replaced had.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  useEffect(() => {
    if (!restored) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      // A full or disabled store is not a reason to stop working; the value
      // simply does not outlive the tab.
    }
  }, [storageKey, value, restored]);

  return [value, setValue, hadSaved];
}
