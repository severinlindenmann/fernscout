import StudioPage from "@/components/studio/StudioPage";
import { requestLocale, translateIn } from "@/lib/locales";
import PeopleFlow from "@/components/studio/people/PeopleFlow";
import { isEnabled } from "@/lib/capabilities";
import { hasHelperConsent } from "@/lib/helper/consent";
import { TRAVELLERS_FROM_PHOTO_CREDITS } from "@/lib/helper/model";
import { requireStudioOwner } from "@/lib/studio/pageGate";
import { getCurrentTrip, getTrips } from "@/lib/trips";
import { listContacts, normaliseEmail } from "@/lib/contacts";
import { peopleNamedIn } from "@/lib/tripPeople";
import { getUser } from "@/lib/users";
import type { KnownPerson } from "@/components/studio/people/PeopleYouHave";

export const dynamic = "force-dynamic";

/**
 * "Who was there" — B1823, spec §7.4 and D5: one flow, listed only under
 * People, with the vCard as one of its two doors (typing a person in by
 * hand is the other).
 *
 * `?name=` is a second way in, added by B1995: the inbox's own contact tile
 * links here with a `.vcf`'s already-known name, so somebody who has just
 * seen it does not have to type it again. It only ever pre-fills the
 * "type a person in" step's own field — nothing here writes on its own.
 */
export default async function StudioPeoplePage({
  params,
  searchParams,
}: PageProps<"/[user]/studio/people">) {
  const { user } = await params;
  await requireStudioOwner(user);
  const { name } = await searchParams;

  const allTrips = getTrips(user);
  const trips = allTrips.map((t) => ({ id: t.id, title: t.title }));
  const current = getCurrentTrip(user);
  // Same capability-and-consent read `studio/photos/page.tsx` already does
  // for the extract flow's own camera door: the figure creator's "from a
  // photo" screen must be *absent*, not merely disabled, without it
  // (AGENTS.md, B2021's own acceptance line).
  const photoConsent = isEnabled("helper", user) && hasHelperConsent(user, "photos");

  // B2088 — who is already here: the contacts this flow filed
  // (`owner-import`) and anyone a trip names, minus the owner's own row
  // (that one lives on /studio/readers). Absent when contacts are off, since
  // the admin endpoint that edits and removes them is off too.
  let people: KnownPerson[] | undefined;
  if (isEnabled("contacts", user)) {
    const ownerEmail = getUser(user)?.owner.email;
    const own = ownerEmail ? normaliseEmail(ownerEmail) : null;
    // Byline only (D3, B2297) — this flow is crediting who a trip names, not
    // deciding who may read or write it, so it wants the file's own list,
    // not the access one.
    const members = allTrips.map((trip) => ({ title: trip.title, people: peopleNamedIn(trip) }));
    people = (await listContacts(user)).flatMap((c) => {
      const on = members.filter((m) => m.people.includes(c.email)).map((m) => m.title);
      if (c.email === own || (c.createdVia !== "owner-import" && on.length === 0)) return [];
      return [{ id: c.id, name: c.name, email: c.email, trips: on }];
    });
  }

  return (
    <StudioPage username={user} group="people" title={translateIn(await requestLocale(), "studio.people.title")}>
      <PeopleFlow
        username={user}
        trips={trips}
        defaultTripId={current?.id ?? null}
        initialName={typeof name === "string" ? name : undefined}
        photoConsent={photoConsent}
        photoCredits={TRAVELLERS_FROM_PHOTO_CREDITS}
        people={people}
      />
    </StudioPage>
  );
}
