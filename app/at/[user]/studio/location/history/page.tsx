import StudioPage from "@/components/studio/StudioPage";
import GpsPurgePanel from "@/components/studio/location/GpsPurgePanel";
import { requestLocale, translateIn } from "@/lib/locales";
import { requireStudioOwner } from "@/lib/studio/pageGate";

export const dynamic = "force-dynamic";

/**
 * "Delete stored history" — B2563 T1, `GpsPurgePanel`'s own address now,
 * unchanged otherwise: it was as loud as the trips list on the shared
 * overview page, for something reached far less often.
 */
export default async function StudioLocationHistoryPage({ params }: PageProps<"/at/[user]/studio/location/history">) {
  const { user } = await params;
  await requireStudioOwner(user);
  const locale = await requestLocale();

  return (
    <StudioPage username={user} group="bringIn" title={translateIn(locale, "studio.location.historyLink")}>
      <GpsPurgePanel username={user} />
    </StudioPage>
  );
}
