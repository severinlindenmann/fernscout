import type { Metadata } from "next";
import { dictionaryFor, localesFor, requestLocale, translateIn } from "@/lib/locales";
import { notFound } from "next/navigation";
import MePageContent, { type ManagePanel, type PaymentPanel } from "./MePageContent";
import { manageTokenFor, listContacts, normaliseEmail, optedInCounts } from "@/lib/contacts";
import { EMPTY_ADDRESS } from "@/lib/contacts/crypto";
import { pickLocale } from "@/lib/contacts/locale";
import { isEnabled } from "@/lib/capabilities";
import { CODE_TTL_MINUTES } from "@/lib/auth";
import { balanceOf } from "@/lib/credits";
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

  // B367. `balanceOf` answers `null` for a journal with credits switched
  // off, which is not the same question as "zero left" — B74's rule is that
  // the whole section is then absent rather than showing a dash or a zero,
  // so `payment` stays `undefined` and the component never has to tell the
  // two apart. Nothing is fetched for anyone but the owner: a stranger or a
  // traveller has no business knowing what this journal has left to spend.
  let payment: PaymentPanel | undefined;
  if (viewer.owner) {
    const balance = await balanceOf(user);
    if (balance !== null) {
      // `optedInCounts` (lib/contacts) is `recipientsFor`'s own predicate,
      // read here without a trip to ask `mayMailTrip` about — see its doc
      // comment for why that makes this the journal-wide "up to N" rather
      // than one trip's exact count.
      const counts = optedInCounts(await listContacts(user));
      payment = {
        balance,
        emailRecipients: counts.email,
        // `null` rather than 0 when WhatsApp itself is off — B369 hasn't
        // shipped the channel yet, and a bare 0 would read as "nobody wants
        // it" rather than "this journal doesn't offer it".
        whatsappRecipients: isEnabled("whatsapp", user) ? counts.whatsapp : null,
      };
    }
  }

  return (
    <MePageContent
      viewer={viewer}
      username={user}
      siteUrl={serverSite().url}
      manage={manage}
      payment={payment}
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
