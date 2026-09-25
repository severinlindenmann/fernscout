import type { Metadata } from "next";
import { notFound } from "next/navigation";
import AboutPageContent from "./AboutPageContent";
import { getAbout } from "@/lib/about";
import { requestLocale, translateIn } from "@/lib/locales";
import { getUser } from "@/lib/users";
import { resolveViewer } from "@/lib/viewer";

/**
 * "Who is behind this journal" — B10.
 *
 * The only reader ever told who took a trip was somebody looking at the
 * costs page, and only when costs were visible to them. `about.md` is
 * optional, journal-wide prose the owner writes about themselves; absent (or
 * still a draft, for anyone but the owner previewing their own page) it is a
 * 404 rather than an empty heading — see `getAbout`.
 *
 * Names and nicknames only: `journal.owner.name` is the one field of the
 * owner object read here, and it is the only one that ever reaches a prop.
 * `journal.owner.email` is never touched, so there is nothing for a later
 * edit of this page — or of `AboutPageContent` — to leak. Same discipline
 * `ownerShortName` documents in lib/site.ts.
 */
export async function generateMetadata({
  params,
}: PageProps<"/[user]/about">): Promise<Metadata> {
  const { user } = await params;
  const journal = getUser(user);
  if (!journal) return {};
  const locale = await requestLocale();
  return {
    title: translateIn(locale, "about.title"),
    alternates: { canonical: `/${user}/about` },
  };
}

export default async function AboutPage({ params }: PageProps<"/[user]/about">) {
  const { user } = await params;
  const journal = getUser(user);
  if (!journal) notFound();

  const viewer = await resolveViewer(user);
  const about = getAbout(user, { includeDrafts: viewer.owner });
  if (!about) notFound();

  const locale = await requestLocale();

  return (
    <AboutPageContent
      title={translateIn(locale, "about.title")}
      ownerName={journal.owner.name}
      markdown={about.markdown}
    />
  );
}
