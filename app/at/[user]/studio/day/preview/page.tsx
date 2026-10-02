import PreviewDayFlow from "@/components/studio/day/PreviewDayFlow";
import StudioPage from "@/components/studio/StudioPage";
import { listGroups } from "@/lib/contacts/groups";
import { getTellChoice, tellAudience } from "@/lib/digest/tellChoice";
import { isEnabled } from "@/lib/capabilities";
import { hasHelperConsent } from "@/lib/helper/consent";
import { requestLocale, translateIn } from "@/lib/locales";
import { requireStudioOwner } from "@/lib/studio/pageGate";
import { blankFieldsOf, daysToPublish, readersOf } from "@/lib/studio/publishDay";
import { tagsUsedBefore } from "@/lib/studio/tagsUsedBefore";
import { tripRef } from "@/lib/trips";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

/**
 * "Preview" — B2677. One day, every draft part of it stacked on one page,
 * as readers will see it, with what publishing it will do and to whom.
 * `?trip=<id>&date=<YYYY-MM-DD>`; every draft of that trip and date, main
 * part (earliest time, or the first written) first. Reached from Write's
 * "Preview →" and from the drafts list's "Publish…"; nothing here writes
 * until "Publish for …" is pressed.
 */
export default async function StudioPreviewDayPage({ searchParams, params }: PageProps<"/at/[user]/studio/day/preview">) {
  const { user } = await params;
  await requireStudioOwner(user);
  const { trip: tripId, date } = await searchParams;
  const locale = await requestLocale();
  const title = translateIn(locale, "studio.preview.title");

  if (typeof tripId !== "string" || !tripId || typeof date !== "string" || !date) {
    return (
      <StudioPage username={user} group="write" title={title} lede={translateIn(locale, "studio.publish.notFound")}>
        <p />
      </StudioPage>
    );
  }

  const drafts = daysToPublish(user, "draft").filter((row) => row.tripId === tripId && row.date === date);
  // Earliest time first (an untimed part — the usual "main" one — sorts
  // first, same as a blank string sorting before any "HH:MM").
  drafts.sort((a, b) => (a.time ?? "").localeCompare(b.time ?? ""));
  const [chosen, ...also] = drafts;

  if (!chosen) {
    return (
      <StudioPage username={user} group="write" title={title} lede={translateIn(locale, "studio.publish.notFound")}>
        <p />
      </StudioPage>
    );
  }

  const blank = [...new Set(drafts.flatMap((row) => blankFieldsOf(user, row)))];
  const readers = await readersOf(user, chosen);
  const tell = {
    ...(await tellAudience(user, tripRef(user, chosen.tripId), chosen.slug)),
    groups: (await listGroups(user)).map(({ id, name, color }) => ({ id, name, color })),
    choice: await getTellChoice(user, chosen.tripId),
  };

  const user0 = getUser(user);
  const otherLocales = (user0?.locales ?? []).filter((l) => l !== (user0?.defaultLocale ?? "en"));

  return (
    <StudioPage username={user} group="write" title={title}>
      <PreviewDayFlow
        username={user}
        tripId={tripId}
        tripTitle={chosen.tripTitle}
        date={date}
        chosen={chosen}
        also={also}
        blank={blank}
        readers={readers}
        tell={tell}
        usedBeforeTags={tagsUsedBefore(user, { trip: tripId })}
        otherLocales={otherLocales}
        defaultLocale={user0?.defaultLocale ?? "en"}
        helperEnabled={isEnabled("helper", user)}
        consent={{ words: hasHelperConsent(user, "words"), photos: hasHelperConsent(user, "photos") }}
      />
    </StudioPage>
  );
}
