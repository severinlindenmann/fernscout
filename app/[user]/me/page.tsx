import type { Metadata } from "next";
import { requestLocale, translateIn } from "@/lib/locales";
import { notFound } from "next/navigation";
import MePageContent from "./MePageContent";
import { manageTokenFor, listContacts, normaliseEmail } from "@/lib/contacts";
import { isEnabled } from "@/lib/capabilities";
import { CODE_TTL_MINUTES } from "@/lib/auth";
import { serverSite } from "@/lib/site";
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
  if (!getUser(user)) notFound();

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

  // The manage page already exists and already works with no login, from the
  // token in every mail footer — so the panel links to it rather than growing
  // a second address form that would have to be kept in step with the first.
  let manageHref: string | undefined;
  if (viewer.email && contactsEnabled) {
    const contact = (await listContacts(user)).find(
      (c) => c.email === normaliseEmail(viewer.email!),
    );
    if (contact) manageHref = `/${user}/c/${manageTokenFor(user, contact.id)}`;
  }

  return (
    <MePageContent
      viewer={viewer}
      username={user}
      docUrl={`${serverSite().url}/documentation.txt`}
      manageHref={manageHref}
      // Resolved here rather than guessed in the component: a capability is a
      // server ceiling and a journal opt-in, and the page was offering a door
      // that this journal had never opened. The panel used to take a second
      // flag, `canJoin`, which was `isEnabled("contacts", …)` under a name
      // that promised something narrower — there is no open form to gate any
      // more (B37), so it is gone rather than left to be misread.
      canSignIn={isEnabled("auth", user)}
      codeMinutes={CODE_TTL_MINUTES}
      contactsEnabled={contactsEnabled}
      signinNotice={signinNotice}
    />
  );
}
