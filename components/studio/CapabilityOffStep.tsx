/**
 * The screen a studio flow shows when the capability it needs is switched
 * off at this instance — B1969, spec §7.8, drawing K3✗.
 *
 * Genuinely new rather than reused: no flow before "A postcard" has had
 * anything server-configured to be off. The photobook is a link, not a
 * wrapped flow (D6), and every People/Plan/Bring-in flow needs no operator
 * provider to run at all — `StudioHub`'s own three "cannot run" reasons
 * (`lib/studio/hub.ts`) grey a *card*, but nothing before this rendered a
 * *page* for the case where a person followed the link anyway (a bookmark, a
 * deep link from an agent's own suggestion — spec §4's "each flow has its
 * own linkable URL").
 *
 * **Absent, not broken.** AGENTS.md: "Every optional capability is off by
 * default and must be absent, not broken, when disabled" — and "switched off
 * is shown with its reason, not hidden", this ticket's own third point. So
 * this is not a 404 (which would say "there is no such thing here", the
 * `ComingSoonFlow` mistake this ticket's own stub replaces) and not a dead
 * form (which would let somebody fill in a trip and a photograph before
 * failing at the very last press). It says the true, narrow thing up front
 * and names `/api/health` as where an operator sees which provider is
 * missing. The way out is the studio bar's own "← Studio" (B2076: at every
 * width now), so this panel carries no second back link of its own.
 */
export default function CapabilityOffStep({
  banner,
  body,
}: {
  /** The bold first line — what cannot happen, and that the instance did it
   *  on purpose (K3✗'s own wording: "switched off", never "broken"). */
  banner: string;
  /** The explanatory line — where the setting lives, for an operator or a
   *  guest reading over their shoulder. */
  body: string;
}) {
  return (
    <div className="mt-4">
      <div className="rounded-xl border border-line-strong bg-surface-subtle px-4 py-3 text-sm text-ink-body">
        <p className="font-semibold text-ink-strong">{banner}</p>
        <p className="mt-1">{body}</p>
      </div>
    </div>
  );
}
