import PublishDayFlow from "@/components/studio/day/PublishDayFlow";
import { listGroups } from "@/lib/contacts/groups";
import { getTellChoice, tellAudience } from "@/lib/digest/tellChoice";
import StudioPage from "@/components/studio/StudioPage";
import { tripRef } from "@/lib/trips";
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
  const { day, trip, list, also } = await searchParams;
  const takeDown = list === "published";

  const rows = daysToPublish(user, takeDown ? "published" : "draft");
  const asked = typeof day === "string" && day ? day : null;
  const chosen = asked ? (rows.find((r) => r.slug === asked && (typeof trip !== "string" || r.tripId === trip)) ?? null) : null;

  // B2192 — the share sheet names what is still blank and who will read it.
  const ownBlank = chosen && !takeDown ? blankFieldsOf(user, chosen) : [];
  const readers = chosen && !takeDown ? await readersOf(user, chosen) : null;
  // TIX-6 — who this day would reach, by reader group, and last time's pick.
  // TIX-2 — the other parts of the same date the add-a-day flow just wrote,
  // published together with the chosen one (drafts on the same trip only).
  const alsoSlugs = typeof also === "string" && chosen && !takeDown ? also.split(",").filter(Boolean) : [];
  const alsoRows = rows
    .filter((r) => chosen && r.tripId === chosen.tripId && r.slug !== chosen.slug && alsoSlugs.includes(r.slug))
    .map((r) => ({ ...r, blank: blankFieldsOf(user, r) }));
  // The sentence names every blank across the parts; each part declines only its own.
  const blank = [...new Set([...ownBlank, ...alsoRows.flatMap((r) => r.blank)])];
  const tell =
    chosen && !takeDown
      ? {
          ...(await tellAudience(user, tripRef(user, chosen.tripId), chosen.slug)),
          groups: (await listGroups(user)).map(({ id, name, color }) => ({ id, name, color })),
          choice: await getTellChoice(user, chosen.tripId),
        }
      : null;

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
        tell={tell}
        also={alsoRows}
        blank={blank}
        readers={readers}
      />
    </StudioPage>
  );
}
