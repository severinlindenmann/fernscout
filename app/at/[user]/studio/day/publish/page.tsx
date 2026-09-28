import PublishDayFlow from "@/components/studio/day/PublishDayFlow";
import StudioPage from "@/components/studio/StudioPage";
import { isEnabled } from "@/lib/capabilities";
import { requestLocale, translateIn } from "@/lib/locales";
import { requireStudioOwner } from "@/lib/studio/pageGate";
import { blankFieldsOf, daysToPublish, readersOf } from "@/lib/studio/publishDay";

export const dynamic = "force-dynamic";
// B2549 — keep this page in the client Router Cache for 30s after a
// visit, so hub -> journal -> hub within that window costs no new
// document/RSC request; every save on this page calls router.refresh()
// (a keeper, test/studio-refresh-after-save.test.ts, enforces it), which
// invalidates the whole client cache, so a stale 30s window never shows
// a page past its own save.
export const unstable_dynamicStaleTime = 30;

/**
 * "Publish a day" — B2140. The studio's one door onto the site: the drafts
 * (or, with `?list=published`, the days already up, to take one down), and
 * with `?day=<slug>&trip=<id>` one of them chosen, what publishing it does,
 * and a `ConfirmPanel`. Owner only, like every studio page.
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
  const chosen = asked ? (rows.find((r) => r.slug === asked && (typeof trip !== "string" || r.tripId === trip)) ?? null) : null;

  // B2192 — the share sheet names what is still blank and who will read it.
  const blank = chosen && !takeDown ? blankFieldsOf(user, chosen) : [];
  const readers = chosen && !takeDown ? await readersOf(user, chosen) : null;

  const locale = await requestLocale();
  return (
    <StudioPage
      username={user}
      group="write"
      title={translateIn(locale, takeDown ? "studio.publish.titleDown" : "studio.hub.item.publishDay.title")}
      lede={chosen ? undefined : translateIn(locale, takeDown ? "studio.publish.ledeDown" : "studio.publish.lede")}
    >
      <PublishDayFlow
        username={user}
        rows={rows}
        chosen={chosen}
        missing={Boolean(asked) && !chosen}
        takeDown={takeDown}
        canTell={isEnabled("mail") || isEnabled("whatsapp")}
        blank={blank}
        readers={readers}
      />
    </StudioPage>
  );
}
