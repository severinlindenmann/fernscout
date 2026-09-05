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
 *
 * No `generateMetadata` here on purpose (B251): `not-found.js` has no metadata
 * export in Next's API surface, so one used to sit here, never called, and a
 * test could still call it directly and pass. The translated tab title and
 * the single `noindex` now come from `app/layout.tsx` and from Next itself —
 * see the note on `generateMetadata` there.
 */
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
