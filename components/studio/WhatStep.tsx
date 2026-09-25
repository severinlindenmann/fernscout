import StepPrimary from "@/components/studio/StepPrimary";

/**
 * Step 01 of the studio's five-step flow shape — "what this is" — B1824.
 *
 * `spec.md` §4: "one sentence of consequence, plus any promise that must be
 * made at the moment of asking rather than in a footer." This component is
 * exactly that shape and nothing more: a title, one line of consequence, an
 * optional promise (rendered with visible emphasis rather than buried below
 * the fold — the location flow's L1 promise is the reason this field exists
 * at all), and one continue affordance. It never fetches anything and never
 * reads context from elsewhere in the app — "steps are self-sufficient" is
 * one of the skeleton's nine binding rules (spec §4), and this is the step
 * most tempted to break it by linking out to a guide instead of saying the
 * thing itself.
 *
 * `StepIndicator` (`components/extract/StepIndicator.tsx`) is reused
 * directly by every flow that wears this skeleton rather than duplicated
 * here — the Reuses column in B1824/B1829's briefs is binding, and a second
 * step indicator would be a park, not a shortcut.
 */
export default function WhatStep({
  title,
  hideHeading = false,
  consequence,
  promise,
  cta,
  inStudioBar = false,
}: {
  title: string;
  /**
   * B1900 — every flow that wears this skeleton also shows its own page
   * title immediately above this step (the flow's own `<h1>`), identical or
   * near-identical to `title`. Announced twice in a row that heading is a
   * navigation landmark that means nothing, so a caller whose page title
   * already says this sets `hideHeading` and lets that `<h1>` stand alone.
   * A caller with no heading of its own (`ComingSoonFlow`, which mounts
   * this as the page's only heading) leaves it at the default.
   */
  hideHeading?: boolean;
  /** One sentence: what a person gets from finishing this flow. */
  consequence: string;
  /** A promise that has to be made now, not in a footer — e.g. the location
   *  flow's "kept privately on this server". Absent for flows with nothing
   *  sensitive enough to promise up front. */
  promise?: string;
  /** The one continue affordance step 01 offers. `href` for a flow whose
   *  step 02 is a real linkable URL of its own (H5); `onContinue` for a flow
   *  that keeps its own step in client state instead. */
  cta: { label: string } & ({ href: string } | { onContinue: () => void });
  /**
   * B2110 — a caller mounted under `app/[user]/studio/layout.tsx`'s
   * `StudioBarProvider` (every studio flow's intro) sets this, and the
   * continue button becomes the bar's one primary via `StepPrimary` (rule 5)
   * instead of sitting inline. The server-rendered stub pages have no
   * provider — `useStudioBar` throws there (B2002) — so the default stays
   * inline, the same opt-in `DecideList` uses. Only an `onContinue` CTA goes
   * to the bar; no studio caller passes an `href` one.
   */
  inStudioBar?: boolean;
}) {
  return (
    <div className="mt-4">
      {!hideHeading && <h2 className="font-display text-xl font-semibold text-ink-strong">{title}</h2>}
      <p className="mt-2 text-sm text-ink-body">{consequence}</p>
      {promise && (
        <p className="mt-3 rounded-xl border border-line-strong bg-surface-subtle px-3 py-2 text-sm text-ink-body">
          {promise}
        </p>
      )}
      {inStudioBar && "onContinue" in cta ? (
        <StepPrimary label={cta.label} onClick={cta.onContinue} />
      ) : (
        <StepCta cta={cta} />
      )}
    </div>
  );
}

function StepCta({ cta }: { cta: { label: string } & ({ href: string } | { onContinue: () => void }) }) {
  const className =
    "mt-4 inline-flex min-h-11 items-center rounded-full bg-action-strong px-5 text-base font-semibold text-on-action";
  if ("href" in cta) {
    // Plain anchor, not `next/link` — this component is shared by server-
    // rendered stub pages that never mount a client bundle at all.
    return (
      <a href={cta.href} className={className}>
        {cta.label}
      </a>
    );
  }
  return (
    <button type="button" onClick={cta.onContinue} className={className}>
      {cta.label}
    </button>
  );
}
