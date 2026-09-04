import type { Metadata } from "next";
import { dictionaryFor, localesFor, requestLocale, translateIn } from "@/lib/locales";
import { notFound } from "next/navigation";
import MePageContent, { type ManagePanel } from "./MePageContent";
import { manageTokenFor, listContacts, normaliseEmail } from "@/lib/contacts";
import { EMPTY_ADDRESS } from "@/lib/contacts/crypto";
import { pickLocale } from "@/lib/contacts/locale";
import { isEnabled } from "@/lib/capabilities";
import { CODE_TTL_MINUTES } from "@/lib/auth";
import { ownerShortName, serverSite } from "@/lib/site";
import { resolveViewer } from "@/lib/viewer";
import { getUser } from "@/lib/users";

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
  // by this codebase — `/api/auth/link` on a spent link, and the same route on
  // a throttle — and anything else in the query is ignored rather than
  // rendered, so the parameter cannot be used to put a sentence of somebody
  // else's choosing on the page.
  const signin = (await searchParams).signin;
  const signinNotice =
    signin === "expired"
      ? "me.signinExpired"
      : signin === "throttled"
        ? "me.signinThrottled"
        : undefined;

  const viewer = await resolveViewer(user);

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
    if (contact) {
      // The reader's own UI language, not the one on the contact record —
      // the record's `locale` is a separate question ("write to me in"),
      // still asked inside the form's own dropdown. Rendering the form's
      // chrome in the record's language instead would put it next to a
      // header in whatever language this reader is actually reading in.
      const uiLocale = await requestLocale();
      manage = {
        token: manageTokenFor(user, contact.id),
        locales: localesFor(user),
        dictionary: dictionaryFor(uiLocale),
        contact: {
          name: contact.name ?? "",
          email: contact.email,
          locale: pickLocale(contact.locale, journal.defaultLocale),
          status: contact.status,
          wantsEmailDigest: contact.wantsEmailDigest,
          wantsPostcard: contact.wantsPostcard,
          wantsWhatsapp: contact.wantsWhatsapp,
          address: contact.postalAddress ?? EMPTY_ADDRESS,
        },
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
    />
  );
}
