import type { Metadata } from "next";
import { requestLocale, translateIn } from "@/lib/locales";
import NotFoundNotice from "@/components/NotFoundNotice";
import { getDefaultUsername, getUser } from "@/lib/users";

/**
 * The 404 for the whole instance.
 *
 * It catches two things. Anything that matches no route at all lands here, and
 * so does `notFound()` thrown from `app/[user]/layout.tsx` — which is the case
 * that actually happens to people: a misspelt journal name in a forwarded link.
 * Since `[user]` is a top-level dynamic segment, almost every bad URL on this
 * server is one of those, so this page is really "no journal by that name",
 * with the generic wording kept for deeper misses.
 *
 * It offers the default journal by name rather than a bare "home", because the
 * reader who got here was trying to read somebody's trip, not visit a website.
 */
/** The tab title follows the reader; see the note in the gallery page. */
export async function generateMetadata(): Promise<Metadata> {
  return {
    title: translateIn(await requestLocale(), "err.notFoundTitle"),
    robots: { index: false, follow: false },
  };
}

export default function NotFound() {
  const username = getDefaultUsername();
  const user = username ? getUser(username) : null;

  return (
    <NotFoundNotice
      homeUser={user && username ? username : undefined}
      homeTitle={user?.title}
    />
  );
}
