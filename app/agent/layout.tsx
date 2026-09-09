/**
 * `/agent` draws no frame of its own any more — B1121.
 *
 * There used to be one here: a back link and the instance's name over every
 * page under `/agent`, added by B697 because `/agent` had no way back to the
 * landing page beyond the browser's own button. That bar cost 3.5rem of every
 * screen it sat over, `HelperRoom` had to subtract it from its own height to
 * keep the composer above the fold, and on a phone — the design width this
 * product is built for — it was exactly the wasted vertical space B1121 was
 * filed about.
 *
 * The room now draws its own header (a chevron before the journal name, the
 * two icons on the right) and `AgentDoor` draws its own back-to-site link for
 * the signed-out visitor, so this layout has nothing left to add. The wizard
 * at `/agent/<user>` still needs a frame — it draws no header of its own —
 * and keeps one at `app/agent/[user]/layout.tsx`.
 */
export default function AgentLayout({ children }: LayoutProps<"/agent">) {
  return children;
}
