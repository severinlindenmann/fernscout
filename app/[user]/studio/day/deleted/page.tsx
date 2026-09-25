import RecentlyDeleted from "@/components/studio/day/RecentlyDeleted";
import StudioPage from "@/components/studio/StudioPage";
import { listTrash } from "@/lib/dayTrash";
import { requestLocale, translateIn } from "@/lib/locales";
import { requireStudioOwner } from "@/lib/studio/pageGate";
import { getTrips } from "@/lib/trips";

export const dynamic = "force-dynamic";

/**
 * "Recently deleted" — B2259. Every day deleted from the studio in the last
 * 30 days, newest first, each with Restore. Reading the list purges what is
 * older (`listTrash`), so nothing past its 30 days is ever offered.
 */
export default async function StudioRecentlyDeletedPage({ params }: PageProps<"/[user]/studio/day/deleted">) {
  const { user } = await params;
  await requireStudioOwner(user);
  const titles = new Map(getTrips(user).map((t) => [t.id, t.title]));
  const rows = listTrash(user).map((e) => ({
    id: e.id,
    tripId: e.trip,
    tripTitle: titles.get(e.trip) ?? e.trip,
    title: e.title,
    date: e.date,
    deletedAt: e.deletedAt.slice(0, 10),
    daysLeft: e.daysLeft,
    wasShared: e.formerStatus === "published",
  }));
  const locale = await requestLocale();
  return (
    <StudioPage
      username={user}
      group="write"
      title={translateIn(locale, "studio.deleted.title")}
      lede={translateIn(locale, "studio.deleted.lede")}
    >
      <RecentlyDeleted username={user} rows={rows} />
    </StudioPage>
  );
}
