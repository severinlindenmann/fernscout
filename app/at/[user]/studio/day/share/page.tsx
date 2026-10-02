import StudioPage from "@/components/studio/StudioPage";
import ShareDayStory from "@/components/studio/day/ShareDayStory";
import { requestLocale, translateIn } from "@/lib/locales";
import { requireStudioOwner } from "@/lib/studio/pageGate";
import { readDayFile, readTripFile, resolveDayStem } from "@/lib/api/v2/store";
import { getTrip } from "@/lib/trips";
import { isOpenToLink } from "@/lib/access";
import { journalPath } from "@/lib/journalPath";
import { serverSite } from "@/lib/site";
import { videoToolsAvailable } from "@/lib/storyVideo";

export const dynamic = "force-dynamic";

/**
 * "Share as a story" — B2665. A published day, one picture or clip for
 * WhatsApp Status / Instagram Story, with the owner's own words for the
 * caption. `?trip=&day=<slug>`; a draft or missing day (the second tap on
 * an unpublish, a bad bookmark) is a plain message, not a 404 or a crash —
 * same reasoning as `EditDayFlow`'s own "missing" state.
 */
export default async function StudioShareDayPage({
  params,
  searchParams,
}: PageProps<"/at/[user]/studio/day/share">) {
  const { user } = await params;
  await requireStudioOwner(user);
  const { trip: tripId, day: dayParam } = await searchParams;
  const locale = await requestLocale();

  const title = translateIn(locale, "studio.share.title");

  if (typeof tripId !== "string" || !tripId || typeof dayParam !== "string" || !dayParam) {
    return (
      <StudioPage username={user} group="write" title={title} lede={translateIn(locale, "studio.share.missing")}>
        <p />
      </StudioPage>
    );
  }

  const tripFile = readTripFile(user, tripId);
  const stem = tripFile ? resolveDayStem(user, tripId, dayParam) : null;
  const day = stem ? readDayFile(user, tripId, stem) : null;

  if (!tripFile || !stem || !day || day.status !== "published") {
    return (
      <StudioPage username={user} group="write" title={title} lede={translateIn(locale, "studio.share.missing")}>
        <p />
      </StudioPage>
    );
  }

  const trip = getTrip(`${user}/${tripId}`);
  const linkAllowed = Boolean(trip && isOpenToLink(trip));
  const link = linkAllowed
    ? `${(process.env.NEXT_PUBLIC_SITE_URL ?? serverSite().url).replace(/\/$/, "")}${journalPath(user)}/trips/${tripId}/day/${stem}`
    : null;

  // `item.src` is trip-relative (`/media/<trip>/<day>/<file>`) — the shape
  // every day document stores. The browser needs the journal-prefixed form
  // (`/@<user>/media/...`) the media route actually answers at; the story
  // routes below read the trip-relative form straight off the day document
  // (`storyPhotoFile`, reusing `resolveMediaFile`'s own guard), so only this
  // client-facing copy needs the prefix.
  const photos = (day.media ?? [])
    .filter((item) => item.type !== "video")
    .map((item) => ({ src: `${journalPath(user)}${item.src}`, caption: item.caption }));

  const firstSentence = day.content.trim().match(/^[^.!?]*[.!?]/)?.[0]?.trim();
  // The day title + "." + the day's own first sentence — the owner's own
  // words only, per the brief. A title already ending in punctuation
  // (rare — titles are plain phrases) is not given a second one.
  const titleLine = /[.!?]$/.test(day.title) ? day.title : `${day.title}.`;
  const caption = [titleLine, firstSentence].filter(Boolean).join(" ").trim();

  return (
    <StudioPage username={user} group="write" title={title}>
      <ShareDayStory
        username={user}
        tripId={tripId}
        slug={stem}
        photos={photos}
        caption={caption}
        linkAllowed={linkAllowed}
        link={link}
        videoAvailable={await videoToolsAvailable()}
      />
    </StudioPage>
  );
}
