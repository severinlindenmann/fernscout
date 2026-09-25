import ConflictsPanel from "@/components/studio/day/ConflictsPanel";
import StudioPage from "@/components/studio/StudioPage";
import { requireStudioOwner } from "@/lib/studio/pageGate";
import { translateIn, requestLocale } from "@/lib/locales";

export const dynamic = "force-dynamic";

/**
 * D3, B2331 — where the pill's own "N needs a decision" leads. A `day.edit`
 * queued while offline whose replay came back 409 `stale_document`: two
 * versions now exist, and this is the one place both are shown side by side
 * with nothing applied until the owner picks. See `ConflictCard.tsx`.
 */
export default async function StudioConflictsPage({ params }: PageProps<"/[user]/studio/day/conflicts">) {
  const { user } = await params;
  await requireStudioOwner(user);
  const locale = await requestLocale();

  return (
    <StudioPage username={user} group="write" title={translateIn(locale, "studio.conflicts.pageTitle")}>
      <ConflictsPanel username={user} />
    </StudioPage>
  );
}
