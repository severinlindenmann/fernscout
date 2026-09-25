import { notFound } from "next/navigation";
import StudioPage from "@/components/studio/StudioPage";
import { requestLocale, translateIn } from "@/lib/locales";
import FigureLibrary from "@/components/studio/figures/FigureLibrary";
import { isEnabled } from "@/lib/capabilities";
import { listContacts } from "@/lib/contacts";
import { hasHelperConsent } from "@/lib/helper/consent";
import { TRAVELLERS_FROM_PHOTO_CREDITS } from "@/lib/helper/model";
import { MAX_FIGURES_LIMIT, figureModifiedAt, figureTripRows, listFiguresPage } from "@/lib/figures";
import { journalV2Fields } from "@/lib/journals";
import { requireStudioOwner } from "@/lib/studio/pageGate";
import { getUser } from "@/lib/users";

export const dynamic = "force-dynamic";

/**
 * `/[user]/studio/figures` — the figure library, B2022. Make a figure,
 * change one, say who it is, delete one; the journal's default walking set;
 * and, per trip, the journal's set, none, or the trip's own party.
 *
 * Server-rendered exactly like `/[user]/studio/people` beside it: every
 * read here is a plain content function, and `FigureLibrary` (a client
 * component) only ever writes through the owner-cookie web doors this
 * ticket adds.
 */
export default async function StudioFiguresPage({ params }: PageProps<"/[user]/studio/figures">) {
  const { user } = await params;
  await requireStudioOwner(user);

  const journal = getUser(user);
  if (!journal) notFound();

  // Every figure the journal has, not a page of them — MAX_FIGURES on the
  // journal/trip sets (`MAX_FIGURES`, `lib/travellers/vocabulary.ts`) already
  // bounds how many could ever be chosen, so the whole library fits in one
  // page comfortably.
  // Newest first: the library shows the latest few and folds the rest
  // behind "show all", so what was just made or changed is at the top.
  const figures = listFiguresPage(user, { limit: MAX_FIGURES_LIMIT })
    .items.map((figure) => ({ figure, at: figureModifiedAt(user, figure.id) }))
    .sort((a, b) => b.at - a.at)
    .map((row) => row.figure);

  const journalFields = journalV2Fields(journal);
  const journalSet = journalFields.figures?.mode === "set" ? journalFields.figures.figures : [];

  // `contacts` is a whole optional capability (`lib/capabilities.ts`) — off
  // means this journal has never been able to collect one, so the picker is
  // simply empty rather than the page failing to load one.
  const contacts = isEnabled("contacts", user)
    ? (await listContacts(user)).map((c) => ({ name: c.name ?? c.email, email: c.email }))
    : [];

  // Latest trip first, by its start — the same rule as the trips index.
  const trips = figureTripRows(user).sort((a, b) => b.start.localeCompare(a.start));

  // Same capability-and-consent read `studio/people/page.tsx` already does
  // for the creator's own camera door: absent, not merely disabled, without
  // it (AGENTS.md, B2021's own acceptance line).
  const photoConsent = isEnabled("helper", user) && hasHelperConsent(user, "photos");

  return (
    <StudioPage username={user} group="people" title={translateIn(await requestLocale(), "studio.figures.library.heading")}>
      <FigureLibrary
        username={user}
        initialFigures={figures}
        contacts={contacts}
        initialJournalSet={journalSet}
        trips={trips}
        photoConsent={photoConsent}
        photoCredits={TRAVELLERS_FROM_PHOTO_CREDITS}
      />
    </StudioPage>
  );
}
