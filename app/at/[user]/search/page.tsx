import type { Metadata } from "next";
import { headers } from "next/headers";
import { localeForPath, requestLocale, translateIn } from "@/lib/locales";
import { PATH_HEADER } from "@/lib/requestKeys";
import { notFound } from "next/navigation";
import SearchPageContent from "./SearchPageContent";
import { getUser } from "@/lib/users";

import { journalPath } from "@/lib/journalPath";
/**
 * Two languages on purpose.
 *
 * The tab title follows the *reader* — it lands in their history, their
 * bookmarks and their tab strip, and a German reader on a German journal was
 * getting "Gallery" there while the page in front of them said "Galerie".
 * The sharing card follows the *journal*, because the people who see one are
 * not this reader and their language is not knowable from this request.
 */
export async function generateMetadata({
  params,
}: PageProps<"/at/[user]/search">): Promise<Metadata> {
  const { user } = await params;
  const reader = await requestLocale();
  const journal = localeForPath((await headers()).get(PATH_HEADER));
  const description = translateIn(journal, "search.subtitle");
  const shared = translateIn(journal, "search.title");
  return {
    title: translateIn(reader, "search.title"),
    description,
    alternates: { canonical: `${journalPath(user)}/search` },
    robots: { index: false, follow: true },
    openGraph: { type: "website", title: shared, description, url: `${journalPath(user)}/search` },
    twitter: { card: "summary", title: shared, description },
  };
}

export default async function SearchPage({ params }: PageProps<"/at/[user]/search">) {
  const { user } = await params;
  if (!getUser(user)) notFound();
  return <SearchPageContent />;
}
