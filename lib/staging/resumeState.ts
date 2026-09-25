import type { RunManifest } from "./manifest";

/**
 * The expiry clock's own constants and the resume screen's reading of them
 * — split out of `lib/staging/expiry.ts` (not merely re-exported from it)
 * because that module opens with `import "server-only"` and everything else
 * in it — the nightly sweep, the mailer — genuinely needs to stay
 * server-only. This one function does not: `components/extract/ExtractFlow.tsx`
 * is where "the screen is where a person meets the rule" actually happens,
 * and a client component cannot import anything that drags `server-only`
 * in, even for a single pure function. `lib/staging/expiry.ts` re-exports
 * everything here so every existing server-side import of these names still
 * works unchanged.
 */

/** How old a run has to be before the notice goes out. */
export const WARN_AFTER_MS = 24 * 60 * 60 * 1000;
/** What the notice promises, and therefore what it pins. */
export const WARNED_GRACE_MS = 24 * 60 * 60 * 1000;
/** What continuing buys, once. */
export const EXTENSION_MS = 48 * 60 * 60 * 1000;

/** What the resume screen (B1751 Task 4.3) says about one run's clock —
 *  three states, three sentences, pure so a test can reach every one of them
 *  without a clock or a filesystem. */
export type ResumeExpiryState =
  | { kind: "notWarned" }
  | { kind: "justExtended"; hadUntil: string; until: string }
  | { kind: "extended"; until: string };

/**
 * `justExtended` is the caller's own answer of whether *this* touch is what
 * moved `run` from warned-but-not-extended into extended — `GET
 * .../studio/runs` passes exactly what `extendOnTouch` told it a moment
 * earlier. Reading `run.extendedAt` alone cannot tell "just now" from
 * "already, days ago": both leave the same field set. The distinction is the
 * whole reason bullet two ("you had until X, you've now got until Y") and
 * bullet three ("kept until Y, no further extension") are different
 * sentences rather than one — telling somebody an extension is fresh when it
 * is not is exactly the lie R31/Task 4.3's brief warns against for the
 * opposite direction ("can extend" when it already has).
 *
 * `hadUntil` is reconstructed from `warnedAt + WARNED_GRACE_MS` rather than
 * carried separately, because the warning always pins `expiresAt` to exactly
 * that value (`expiryActionFor`'s own `do: "warn"` branch, `lib/staging/expiry.ts`)
 * — the invariant that makes the old deadline recoverable after
 * `extendOnTouch` has already overwritten `expiresAt` with the new one.
 */
export function resumeExpiryState(run: RunManifest, justExtended: boolean): ResumeExpiryState {
  if (!run.warnedAt) return { kind: "notWarned" };
  if (justExtended) {
    return {
      kind: "justExtended",
      hadUntil: new Date(Date.parse(run.warnedAt) + WARNED_GRACE_MS).toISOString(),
      until: run.expiresAt,
    };
  }
  return { kind: "extended", until: run.expiresAt };
}
