import PublishDayFlow from "@/components/studio/day/PublishDayFlow";
import StudioPage from "@/components/studio/StudioPage";
import { requestLocale, translateIn } from "@/lib/locales";
import { requireStudioOwner } from "@/lib/studio/pageGate";
import { daysToPublish } from "@/lib/studio/publishDay";

export const dynamic = "force-dynamic";
// B2549 — keep this page in the client Router Cache for 30s after a
// visit, so hub -> journal -> hub within that window costs no new
// document/RSC request; every save on this page calls router.refresh()
// (a keeper, test/studio-refresh-after-save.test.ts, enforces it), which
// invalidates the whole client cache, so a stale 30s window never shows
// a page past its own save.
export const unstable_dynamicStaleTime = 30;

/**
 * "Publish a day" — B2140, narrowed by B2677. The drafts list (or, with
 * `?list=published`, the days already up, to take one down). A draft's own
 * "Publish…" now opens Preview (`/studio/day/preview?trip=&date=`); this
 * page keeps only the take-down confirm, chosen by `?day=<slug>&trip=<id>`.
 * Owner only, like every studio page.
 */
export default async function StudioPublishDayPage({
  params,
  searchParams,
}: PageProps<"/at/[user]/studio/day/publish">) {
  const { user } = await params;
  await requireStudioOwner(user);
  const { day, trip, list } = await searchParams;
  const takeDown = list === "published";

  const rows = daysToPublish(user, takeDown ? "published" : "draft");
  const asked = typeof day === "string" && day ? day : null;
  const chosen = takeDown && asked ? (rows.find((r) => r.slug === asked && (typeof trip !== "string" || r.tripId === trip)) ?? null) : null;

  const locale = await requestLocale();
  return (
    <StudioPage
      username={user}
      group="write"
      title={translateIn(locale, takeDown ? "studio.publish.titleDown" : "studio.hub.item.publishDay.title")}
      lede={chosen ? undefined : translateIn(locale, takeDown ? "studio.publish.ledeDown" : "studio.publish.lede")}
    >
      <PublishDayFlow username={user} rows={rows} chosen={chosen} missing={Boolean(asked) && !chosen} takeDown={takeDown} />
    </StudioPage>
  );
}
