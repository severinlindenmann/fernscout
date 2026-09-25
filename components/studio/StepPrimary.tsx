"use client";

import BusyButton from "@/components/BusyButton";
import { haptic } from "@/components/nativeShell";
import { useStudioBar } from "@/components/studio/StudioBar";

const SHAPE = "min-h-11 rounded-full text-base font-semibold";

/**
 * The one look of a disabled primary, whatever its tone — B2137. It used to
 * be the tone at half opacity: pale navy on one page, pale yellow on the next,
 * and in dark mode the pale yellow read as a lit button. A grey fill with
 * secondary ink reads as "not yet" on both grounds. Not while busy: a working
 * button keeps its colour (BusyButton's own `aria-busy` rule).
 */
const DISABLED_PRIMARY =
  "disabled:not-aria-busy:cursor-not-allowed disabled:not-aria-busy:bg-surface-neutral-strong disabled:not-aria-busy:text-ink-secondary";

/**
 * A step's one primary action — B2002, B2076. It lives in the studio's shared
 * bar at every width: beside "← Studio" in the sticky bottom bar on a phone,
 * and in the same bar's static right-aligned row under the page from `md`
 * (`useStudioBar`'s `desktop`). One element in one place, so there is only
 * ever one copy of the button in the document and its label, handler,
 * `disabled` and `busy` cannot drift. (B2002 mounted it twice — inline from
 * `md` and in the bar below it — before the bar had a desktop row.)
 *
 * A caller mounts this only for the step (and only the one, if any) that
 * has a single primary — a step with two equal choices keeps its decline
 * or secondary link inline and never passes it here; a step with no
 * primary at all (a picker that advances on selection) mounts nothing, and
 * the bar falls back to the provider's own default back link.
 */
export default function StepPrimary({
  label,
  onClick,
  disabled,
  busy,
  busyLabel,
  done,
  shake,
  tone = "bg-action-strong text-on-action",
}: {
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  busy?: boolean;
  busyLabel?: string;
  /** B2325 — see `BusyButton`'s own doc comment. Set by the caller only
   *  after a 2xx, never on tap. */
  done?: boolean;
  /** B2325 — see `BusyButton`'s own doc comment. */
  shake?: unknown;
  /** Colour classes only — DecideList's "do it" step keeps its own yellow
   *  commit colour while sharing this one element definition. */
  tone?: string;
}) {
  useStudioBar(
    <BusyButton
      type="button"
      busy={busy}
      busyLabel={busyLabel}
      done={done}
      shake={shake}
      disabled={disabled}
      onClick={() => {
        void haptic("light");
        onClick?.();
      }}
      className={`flex min-w-0 flex-1 items-center justify-center px-3 text-sm md:flex-none md:px-5 ${SHAPE} ${tone} ${DISABLED_PRIMARY}`}
    >
      <span className="truncate">{label}</span>
    </BusyButton>,
    { desktop: true },
  );
  return null;
}
