import type { Metadata } from "next";
import { notFound } from "next/navigation";
import JournalPageContent, { type JournalPanel, type ReminderRow } from "./JournalPageContent";
import StudioPage from "@/components/studio/StudioPage";
import { requireStudioOwner } from "@/lib/studio/pageGate";
import { journalProfile } from "@/lib/journals";
import { getOwnerTel } from "@/lib/ownerTel";
import { dictionaryFor, localesFor, requestLocale, translateIn } from "@/lib/locales";
import OwnDetails from "@/components/studio/readers/OwnDetails";
import { getContactByEmail, manageTokenFor } from "@/lib/contacts";
import { EMPTY_ADDRESS } from "@/lib/contacts/crypto";
import { pickLocale } from "@/lib/contacts/locale";
import { whatsappCountryCode } from "@/lib/contactNumber";
import { getUser } from "@/lib/users";
import { knownCurrencies } from "@/lib/rates";
import { getTrips } from "@/lib/trips";
import { earliestTodayISO } from "@/lib/tripTime";
import { isEnabled } from "@/lib/capabilities";
import { readTellBy } from "@/lib/studio/tellBy";

/**
 * Journal settings — B2017, moved whole from the owner block on
 * `/[user]/me` (`MePageContent.tsx`, B619/B852) so all journal
 * administration lives in the studio. B2074 puts it on the studio's own
 * shell (`StudioPage`) with one Save in the bar.
 */

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: PageProps<"/[user]/studio/journal">): Promise<Metadata> {
  const { user } = await params;
  return {
    title: translateIn(await requestLocale(), "studio.hub.item.journalSettings.title"),
    robots: { index: false, follow: false },
  };
}

export default async function StudioJournalPage({ params }: PageProps<"/[user]/studio/journal">) {
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
  };

  // B2171 — the evening reminder's switch, one per trip that can still get
  // one: a reminder only ever fires while a trip's own dates cover today
  // (`isRunning`, lib/digest/reminder.ts), so a trip already over is left out.
  const today = earliestTodayISO();
  const reminders: ReminderRow[] = getTrips(user)
    .filter((trip) => trip.end >= today)
    .map((trip) => ({ id: trip.id, title: trip.title, on: Boolean(trip.reminder) }));

  const locale = await requestLocale();

  // B2291 — the owner's own name, phone and address moved here from Readers:
  // they are not a reader, and Readers is only about who is let in. Only
  // where contacts are on, and only for an owner with an address to key it.
  const ownEmail = journal.owner.email;
  const ownRow =
    isEnabled("contacts", user) && ownEmail ? await getContactByEmail(user, ownEmail) : null;
  const showOwn = isEnabled("contacts", user) && Boolean(ownEmail);

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
        tellBy={isEnabled("transcription", user) ? { current: readTellBy(user) } : undefined}
      />
      {showOwn && (
        <OwnDetails
          username={user}
          locales={localesFor(user)}
          dictionary={dictionaryFor(pickLocale(locale), "ownDetails")}
          defaultCountryCode={whatsappCountryCode()}
          addressLookupEnabled={isEnabled("addressLookup", user)}
          own={
            ownRow
              ? {
                  token: manageTokenFor(user, ownRow.id),
                  contact: {
                    name: ownRow.name ?? "",
                    email: ownRow.email,
                    locale: pickLocale(ownRow.locale, journal.defaultLocale),
                    status: ownRow.status,
                    wantsEmailDigest: ownRow.wantsEmailDigest,
                    wantsPostcard: ownRow.wantsPostcard,
                    wantsWhatsapp: ownRow.wantsWhatsapp,
                    address: ownRow.postalAddress ?? EMPTY_ADDRESS,
                  },
                }
              : undefined
          }
        />
      )}
    </StudioPage>
  );
}
