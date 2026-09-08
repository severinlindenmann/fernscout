import type { Metadata } from "next";
import { headers } from "next/headers";
import { isEnabled } from "@/lib/capabilities";
import { isOwner } from "@/lib/contacts/session";
import { balanceOf } from "@/lib/credits";
import { hasHelperConsent } from "@/lib/helper/consent";
import { speechProvider } from "@/lib/helper/transcribe";
import { localeForPath, requestLocale, translateIn } from "@/lib/locales";
import { PATH_HEADER } from "@/lib/requestKeys";
import { notFound } from "next/navigation";
import SearchPageContent from "./SearchPageContent";
import { getUser } from "@/lib/users";

/**
 * Two languages on purpose.
 *
 * The tab title follows the *reader* — it lands in their history, their
 * bookmarks and their tab strip, and a German reader on a German journal was
 * getting "Gallery" there while the page in front of them said "Galerie".
 * The sharing card follows the *journal*, because the people who see one are
 * not this reader and their language is not knowable from this request.
 */
export async function generateMetadata(): Promise<Metadata> {
  const reader = await requestLocale();
  const journal = localeForPath((await headers()).get(PATH_HEADER));
  const description = translateIn(journal, "search.subtitle");
  const shared = translateIn(journal, "search.title");
  return {
    title: translateIn(reader, "search.title"),
    description,
    alternates: { canonical: "/search" },
    robots: { index: false, follow: true },
    openGraph: { type: "website", title: shared, description, url: "/search" },
    twitter: { card: "summary", title: shared, description },
  };
}

/**
 * B981 — whether speaking here goes to this instance's own transcriber.
 *
 * Owner only, and asked on the server so no request has to be made from the
 * page to find out: a stranger's browser is told nothing about whose journal
 * this is, and the answer for them is simply absent. `hasHelperConsent` and
 * `speechProvider` are what `RecordButton` needs to draw its own consent
 * panel — the same two facts `/agent` reads for it.
 */
async function speechFor(
  user: string,
): Promise<{ consented: boolean; provider: string; balance: number | null } | undefined> {
  if (!isEnabled("transcription", user)) return undefined;
  if (!(await isOwner(user))) return undefined;
  return {
    consented: hasHelperConsent(user, "speech"),
    provider: speechProvider(),
    // What they have, so the page can be quiet about the price and say
    // something only when there is nothing left — B986. `null` is "credits
    // are off here", which is not zero and is not a warning either.
    balance: await balanceOf(user),
  };
}

export default async function SearchPage({ params }: PageProps<"/[user]/search">) {
  const { user } = await params;
  if (!getUser(user)) notFound();
  return <SearchPageContent username={user} speech={await speechFor(user)} />;
}
