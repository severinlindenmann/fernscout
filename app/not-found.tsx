import { headers } from "next/headers";
import { permanentRedirect } from "next/navigation";
import NotFoundNotice from "@/components/NotFoundNotice";
import { movedJournalPath } from "@/lib/movedJournal";
import { PATH_HEADER, SEARCH_HEADER } from "@/lib/requestKeys";
import { getDefaultUsername, getUser } from "@/lib/users";

/**
 * The 404 for the whole instance.
 *
 * It catches two things. Anything that matches no route at all lands here, and
 * so does `notFound()` thrown from `app/at/[user]/layout.tsx` — which is the case
 * that actually happens to people: a misspelt journal name in a forwarded link
 * (`/@anna`). A journal's old address without the `@` is not a miss at all,
 * and is sent on — see `lib/movedJournal.ts`.
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
export default async function NotFound() {
  // A journal's pre-`@` address is not a miss: send it on (`lib/movedJournal.ts`).
  const request = await headers();
  const moved = movedJournalPath(request.get(PATH_HEADER), request.get(SEARCH_HEADER));
  if (moved) permanentRedirect(moved);

  const username = getDefaultUsername();
  const user = username ? getUser(username) : null;

  return (
    <NotFoundNotice
      homeUser={user && username ? username : undefined}
      homeTitle={user?.title}
    />
  );
}
