import PageHeader from "@/components/PageHeader";
import StepIndicator from "@/components/extract/StepIndicator";
import CapabilityOffStep from "@/components/studio/CapabilityOffStep";
import GroupMark from "@/components/studio/GroupMark";
import { StudioBarPage } from "@/components/studio/StudioBar";
import SubmitError from "@/components/studio/SubmitError";
import type { StudioGroup } from "@/lib/studio/groups";

const WIDTH = { flow: "max-w-xl", board: "max-w-3xl", wide: "max-w-5xl" } as const;

/**
 * The shell every studio page renders through — B2061. Header crumb back to
 * the studio, the group's mark, one h1 naming the thing, an optional step
 * indicator (wizards only; derive `total` from the steps array), one lede
 * sentence, the body, and one `role="alert"` error line at its end (B2070:
 * `SubmitError`, directly above the bar) — or, when the
 * capability the page needs is switched off, `CapabilityOffStep` instead of
 * the body (never a 404).
 *
 * `StudioBarPage` tells the layout's bar which group this page belongs to
 * (its back link returns to that group's anchor, B2069) and how wide the
 * column is (the bar's desktop row lines up under it, B2076). No
 * `min-h-screen`: that desktop row follows the page, and a full-height
 * frame would push it below the fold of a short page.
 *
 * No hooks and not async, so a server page and a client flow can both render
 * it. A width other than "flow" needs a reason in test/studio-shape.test.ts.
 */
export default function StudioPage({
  username,
  group,
  title,
  lede,
  width = "flow",
  indicator,
  error,
  capabilityOff,
  back = true,
  children,
}: {
  username: string;
  group?: StudioGroup;
  title: string;
  lede?: string;
  width?: keyof typeof WIDTH;
  indicator?: { total: number; current: number; label: string };
  error?: string | null;
  /** CapabilityOffStep's own copy: what cannot happen, and why. */
  capabilityOff?: { banner: string; body: string };
  /** False only on the hub, which is the studio and has nowhere to go back to. */
  back?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div>
      <StudioBarPage group={group} width={width} />
      <PageHeader backTo={back ? { href: `/${username}/studio`, labelKey: "nav.studio" } : undefined} />
      <main id="main" tabIndex={-1} className={`mx-auto w-full ${WIDTH[width]} px-4 py-8`}>
        {group && <GroupMark group={group} size="sm" />}
        <h1 className="font-display text-2xl font-semibold text-ink-strong">{title}</h1>
        {indicator && (
          <div className="mt-3">
            <StepIndicator {...indicator} />
          </div>
        )}
        {lede && <p className="mt-2 text-sm text-ink-body">{lede}</p>}
        {capabilityOff ? <CapabilityOffStep {...capabilityOff} /> : children}
        <SubmitError message={error} />
      </main>
    </div>
  );
}
