import type { Metadata } from "next";
import { notFound } from "next/navigation";
import JournalPageContent, { type JournalPanel, type ReminderRow } from "./JournalPageContent";
import StudioPage from "@/components/studio/StudioPage";
import { requireStudioOwner } from "@/lib/studio/pageGate";
import { journalHasAnyCost } from "@/lib/costs";
import { journalProfile } from "@/lib/journals";
import { getOwnerTel } from "@/lib/ownerTel";
import { requestLocale, translateIn } from "@/lib/locales";
import { getUser } from "@/lib/users";
import { knownCurrencies } from "@/lib/rates";
import { getTrips } from "@/lib/trips";
import { earliestTodayISO } from "@/lib/tripTime";

/**
 * Journal settings — B2017, moved whole from the owner block on
 * `/[user]/me` (`MePageContent.tsx`, B619/B852) so all journal
 * administration lives in the studio. B2074 puts it on the studio's own
 * shell (`StudioPage`) with one Save in the bar.
 */

export const dynamic = "force-dynamic";
// B2549 — keep this page in the client Router Cache for 30s after a
// visit, so hub -> journal -> hub within that window costs no new
// document/RSC request; every save on this page calls router.refresh()
// (a keeper, test/studio-refresh-after-save.test.ts, enforces it), which
// invalidates the whole client cache, so a stale 30s window never shows
// a page past its own save.
export const unstable_dynamicStaleTime = 30;

export async function generateMetadata({
  params,
}: PageProps<"/at/[user]/studio/journal">): Promise<Metadata> {
  const { user } = await params;
  return {
    title: translateIn(await requestLocale(), "studio.hub.item.journalSettings.title"),
    robots: { index: false, follow: false },
  };
}

export default async function StudioJournalPage({ params }: PageProps<"/at/[user]/studio/journal">) {
  const { user } = await params;
  await requireStudioOwner(user);
  const journal = getUser(user);
  if (!journal) notFound();

  // Same read `/[user]/me` used to build the owner's `JournalPanel` — B619,
  // widened by B852, and moved here whole by B2017. `ownerTel` comes from
  // `lib/ownerTel.ts`'s central store, not `journalProfile()`'s own
  // backward-compatible `config.json` read — see that field's own comment.
  const journalPanel: JournalPanel = {
    ...journalProfile(journal),
    ownerTel: (await getOwnerTel(user))?.tel ?? "",
    email: journal.owner.email ?? "",
    ownerName: journal.owner.name,
    ownerNickname: journal.owner.nickname,
    baseCurrencyLocked: journalHasAnyCost(user),
  };

  // B2171 — the evening reminder's switch, one per trip that can still get
  // one: a reminder only ever fires while a trip's own dates cover today
  // (`isRunning`, lib/digest/reminder.ts), so a trip already over is left out.
  const today = earliestTodayISO();
  const reminders: ReminderRow[] = getTrips(user)
    .filter((trip) => trip.end >= today)
    .map((trip) => ({ id: trip.id, title: trip.title, on: Boolean(trip.reminder) }));

  const locale = await requestLocale();

  return (
    <StudioPage
      username={user}
      group="journal"
      title={translateIn(locale, "studio.hub.item.journalSettings.title")}
      lede={translateIn(locale, "me.journalCardBody")}
    >
      <JournalPageContent
        username={user}
        journal={journalPanel}
        knownCurrencies={knownCurrencies()}
        reminders={reminders}
        tipsOn={journal.owner.tips?.optIn ?? false}
      />
    </StudioPage>
  );
}
