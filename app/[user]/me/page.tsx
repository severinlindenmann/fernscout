import type { Metadata } from "next";
import { dictionaryFor, localesFor, requestLocale, translateIn } from "@/lib/locales";
import { notFound } from "next/navigation";
import MePageContent, { type ManagePanel } from "./MePageContent";
import { getAbout } from "@/lib/about";
import { manageTokenFor, listContacts, normaliseEmail } from "@/lib/contacts";
import { EMPTY_ADDRESS } from "@/lib/contacts/crypto";
import { pickLocale } from "@/lib/contacts/locale";
import { isEnabled } from "@/lib/capabilities";
import { operatorMayRead } from "@/lib/helper/sessions";
import { CODE_TTL_MINUTES } from "@/lib/auth";
import { ownerShortName, serverSite } from "@/lib/site";
import pkg from "@/package.json";
import { resolveViewer } from "@/lib/viewer";
import { getUser } from "@/lib/users";
import { whatsappCountryCode } from "@/lib/contactNumber";

// Reads a session on every request; there is nothing here to prerender.
export const dynamic = "force-dynamic";

/** Never indexed: it is a different page for every reader, and most of them
 * are one person's own access. */
/** The tab title follows the reader; see the note in the gallery page. */
export async function generateMetadata(): Promise<Metadata> {
  return {
    title: translateIn(await requestLocale(), "me.title"),
    robots: { index: false, follow: false },
  };
}

export default async function MePage({ params, searchParams }: PageProps<"/[user]/me">) {
  const { user } = await params;
  const journal = getUser(user);
  if (!journal) notFound();

  // Why they are here rather than inside the journal. Both values are written
  // by this codebase — `/api/auth/links/redeem` on a spent link, and the same
  // route on a throttle — and anything else in the query is ignored rather than
  // rendered, so the parameter cannot be used to put a sentence of somebody
  // else's choosing on the page.
  const signin = (await searchParams).signin;
  const viewer = await resolveViewer(user);

  // Only shown to a reader still without a session: B359 found it sitting
  // above "Signed in as …" once the fresh code from the same page had
  // worked, because the parameter that drives it survives the sign-in
  // unread. `GuestSignIn` reloads rather than navigating, so the
  // query string is still `?signin=expired` on the request that renders the
  // new session — this is where that request learns the session exists and
  // stops repeating a notice about a link that no longer matters.
  const signinNotice = viewer.email
    ? undefined
    : signin === "expired"
      ? "me.signinExpired"
      : signin === "throttled"
        ? "me.signinThrottled"
        : undefined;

  // Asked once, for both doors this page opens into contacts. B74: the
  // guest-details link below was gated on it and the owner's guest-list link
  // was not, so an owner whose journal has contacts off followed a link their
  // own page had drawn and got a 404.
  const contactsEnabled = isEnabled("contacts", user);

  // The manage form itself lives in one place, `ContactManage`, and is reused
  // rather than rebuilt: it works with no login from the token in every mail
  // footer (`/c/<token>`), and it renders again here, inline, for a reader
  // who is already signed in and would otherwise be sent to a second page for
  // one field they can see right in front of them.
  let manage: ManagePanel | undefined;
  if (viewer.email && contactsEnabled) {
    const contact = (await listContacts(user)).find(
      (c) => c.email === normaliseEmail(viewer.email!),
    );
    // Before D3 (B2297), a person named in a trip's own `people:` block had
    // write access and no contacts row to have earned it — B1395 gave them
    // this form anyway. Since D3, `through === "traveller"` means a granted
    // `trip_people` place, which always already has a row, so this arm no
    // longer has a real case to cover; see `app/api/contacts/self/route.ts`
    // for the fuller account and why it is kept rather than removed.
    const isTraveller = viewer.trips.some((trip) => trip.through === "traveller");
    if (contact || isTraveller) {
      // The reader's own UI language, not the one on the contact record —
      // the record's `locale` is a separate question ("write to me in"),
      // still asked inside the form's own dropdown. Rendering the form's
      // chrome in the record's language instead would put it next to a
      // header in whatever language this reader is actually reading in.
      const uiLocale = await requestLocale();
      manage = {
        // No manage token exists until the row does — `manageTokenFor` names
        // an id, and there is none yet. `ContactManage` reads an empty token
        // as "post through `/api/contacts/self` instead", never as a real
        // credential for `/api/contacts/manage`.
        token: contact ? manageTokenFor(user, contact.id) : "",
        locales: localesFor(user),
        dictionary: dictionaryFor(uiLocale),
        contact: contact
          ? {
              name: contact.name ?? "",
              email: contact.email,
              locale: pickLocale(contact.locale, journal.defaultLocale),
              status: contact.status,
              wantsEmailDigest: contact.wantsEmailDigest,
              wantsPostcard: contact.wantsPostcard,
              wantsWhatsapp: contact.wantsWhatsapp,
              address: contact.postalAddress ?? EMPTY_ADDRESS,
            }
          : {
              name: "",
              email: viewer.email,
              locale: pickLocale(null, journal.defaultLocale),
              status: "pending",
              wantsEmailDigest: false,
              wantsPostcard: false,
              wantsWhatsapp: false,
              address: EMPTY_ADDRESS,
            },
        // B385: same fallback `toE164` reads at send time.
        defaultCountryCode: whatsappCountryCode(),
        // B399: same server-ceiling-and-journal-opt-in check as everywhere
        // else this capability is read.
        addressLookupEnabled: isEnabled("addressLookup", user),
      };
    }
  }

  return (
    <MePageContent
      viewer={viewer}
      username={user}
      siteUrl={serverSite().url}
      manage={manage}
      // Resolved here rather than guessed in the component: a capability is a
      // server ceiling and a journal opt-in, and the page was offering a door
      // that this journal had never opened. The panel used to take a second
      // flag, `canJoin`, which was `isEnabled("contacts", …)` under a name
      // that promised something narrower — there is no open form to gate any
      // more (B37), so it is gone rather than left to be misread.
      /**
       * Whether the operator may read this journal's conversations — B976.
       *
       * Resolved here for the same reason `canSignIn` is: a capability is a
       * server ceiling and a journal opt-in, and the card must not be drawn
       * for a journal that has no helper at all. `null` is what the component
       * reads as "there is nothing here to switch".
       */
      // `consentAgreedAt` and `consentRows` are not passed — B2017 moved the
      // owner's own copy of the consent section to `/studio/agent`, and a
      // buddy's `consentRows` was always `[]` (B1390's grants are owner
      // only), so the component's own defaults are exactly right here.
      sessionsShared={isEnabled("helper", user) ? operatorMayRead(user) : null}
      canSignIn={isEnabled("auth", user)}
      codeMinutes={CODE_TTL_MINUTES}
      contactsEnabled={contactsEnabled}
      // B20. The stranger's half of this page told somebody to ask for a link
      // and never said whom to ask, on a site they may have reached without
      // knowing whose it is.
      //
      // One string, picked here: `journal.owner` also carries the owner's
      // email address, and the rule is that the field is chosen at the server
      // boundary rather than in the component, so that a later edit to the
      // component cannot leak a value it was never handed. Nothing narrower
      // than the whole object would do — this is the whole object minus the
      // address, computed to a single word.
      ownerName={ownerShortName(journal)}
      signinNotice={signinNotice}
      // B10 — whether `/<user>/about` exists for this reader. The owner's
      // own preview of a draft counts (`includeDrafts: viewer.owner`, same
      // reasoning as the page itself); everybody else sees the door only
      // once it is published.
      hasAbout={getAbout(user, { includeDrafts: viewer.owner }) !== null}
      // B1386 — instance-wide, no username argument, same as
      // app/agent/page.tsx: whether a stranger with no journal here can get
      // one through the wizard at all.
      signupEnabled={isEnabled("signup")}
      // What this page was built from, and the server the operator describes
      // in `site.hosting`. Which server the reader actually reached is read
      // off `location` in the component: only the browser knows that.
      build={{ version: pkg.version, commit: process.env.GIT_SHA?.slice(0, 7) }}
      hosting={serverSite().hosting}
    />
  );
}
