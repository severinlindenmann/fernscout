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

export default async function MePage({ params }: PageProps<"/[user]/me">) {
  const { user } = await params;
  if (!getUser(user)) notFound();

  const viewer = await resolveViewer(user);

  // The manage page already exists and already works with no login, from the
  // token in every mail footer — so the panel links to it rather than growing
  // a second address form that would have to be kept in step with the first.
  let manageHref: string | undefined;
  if (viewer.email && isEnabled("contacts", user)) {
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
      // Resolved here rather than guessed in the component: both are a server
      // ceiling and a journal opt-in, and the page was offering a door that
      // this journal had never opened.
      canJoin={isEnabled("contacts", user)}
      canSignIn={isEnabled("auth", user)}
      codeMinutes={CODE_TTL_MINUTES}
    />
  );
}
