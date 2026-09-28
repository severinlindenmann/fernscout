import ConflictsPanel from "@/components/studio/day/ConflictsPanel";
import StudioPage from "@/components/studio/StudioPage";
import { requireStudioOwner } from "@/lib/studio/pageGate";
import { translateIn, requestLocale } from "@/lib/locales";

export const dynamic = "force-dynamic";
// B2549 — keep this page in the client Router Cache for 30s after a
// visit, so hub -> journal -> hub within that window costs no new
// document/RSC request; every save on this page calls router.refresh()
// (a keeper, test/studio-refresh-after-save.test.ts, enforces it), which
// invalidates the whole client cache, so a stale 30s window never shows
// a page past its own save.
export const unstable_dynamicStaleTime = 30;

/**
 * D3, B2331 — where the pill's own "N needs a decision" leads. A `day.edit`
 * queued while offline whose replay came back 409 `stale_document`: two
 * versions now exist, and this is the one place both are shown side by side
 * with nothing applied until the owner picks. See `ConflictCard.tsx`.
 */
export default async function StudioConflictsPage({ params }: PageProps<"/at/[user]/studio/day/conflicts">) {
  const { user } = await params;
  await requireStudioOwner(user);
  const locale = await requestLocale();

  return (
    <StudioPage username={user} group="write" title={translateIn(locale, "studio.conflicts.pageTitle")}>
      <ConflictsPanel username={user} />
    </StudioPage>
  );
}
