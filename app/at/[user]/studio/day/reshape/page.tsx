import StudioPage from "@/components/studio/StudioPage";
import { requestLocale, translateIn } from "@/lib/locales";
import ReshapeDayFlow from "@/components/studio/day/ReshapeDayFlow";
import { requireStudioOwner } from "@/lib/studio/pageGate";
import { daysForEditPicker } from "@/lib/studio/editDay";
import { getTrips } from "@/lib/trips";

export const dynamic = "force-dynamic";
// B2549 — keep this page in the client Router Cache for 30s after a
// visit, so hub -> journal -> hub within that window costs no new
// document/RSC request; every save on this page calls router.refresh()
// (a keeper, test/studio-refresh-after-save.test.ts, enforces it), which
// invalidates the whole client cache, so a stale 30s window never shows
// a page past its own save.
export const unstable_dynamicStaleTime = 30;

/**
 * "Something is filed wrong" — B1832, spec §7.1. Everything this flow
 * writes is genuinely new (`lib/studio/reshapeDay.ts`'s own doc comment);
 * the picker is not — `daysForEditPicker` is the exact read B1831 already
 * built for "Change a day", reused whole rather than a second grouped list.
 */
export default async function StudioReshapeDayPage({ params }: PageProps<"/at/[user]/studio/day/reshape">) {
  const { user } = await params;
  await requireStudioOwner(user);

  const picker = daysForEditPicker(user);
  const trips = getTrips(user).map((t) => ({ id: t.id, title: t.title, start: t.start, end: t.end }));

  return (
    <StudioPage username={user} group="write" hideGroups title={translateIn(await requestLocale(), "studio.day.reshape.title")}>
      <ReshapeDayFlow username={user} picker={picker} trips={trips} />
    </StudioPage>
  );
}
