import StudioPage from "@/components/studio/StudioPage";
import { requestLocale, translateIn } from "@/lib/locales";
import ReshapeDayFlow from "@/components/studio/day/ReshapeDayFlow";
import { requireStudioOwner } from "@/lib/studio/pageGate";
import { daysForEditPicker } from "@/lib/studio/editDay";
import { getTrips } from "@/lib/trips";

export const dynamic = "force-dynamic";

/**
 * "Something is filed wrong" — B1832, spec §7.1. Everything this flow
 * writes is genuinely new (`lib/studio/reshapeDay.ts`'s own doc comment);
 * the picker is not — `daysForEditPicker` is the exact read B1831 already
 * built for "Change a day", reused whole rather than a second grouped list.
 */
export default async function StudioReshapeDayPage({ params }: PageProps<"/[user]/studio/day/reshape">) {
  const { user } = await params;
  await requireStudioOwner(user);

  const picker = daysForEditPicker(user);
  const trips = getTrips(user).map((t) => ({ id: t.id, title: t.title, start: t.start, end: t.end }));

  return (
    <StudioPage username={user} group="write" title={translateIn(await requestLocale(), "studio.day.reshape.title")}>
      <ReshapeDayFlow username={user} picker={picker} trips={trips} />
    </StudioPage>
  );
}
