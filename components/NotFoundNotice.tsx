"use client";

import { usePathname } from "next/navigation";
import ReaderNotice from "./ReaderNotice";
import { journalPath, parseJournalPath } from "@/lib/journalPath";

/**
 * The root 404, worded from the URL that produced it.
 *
 * A path starting with `@` is somebody's journal, so a one-segment miss
 * (`/@alx`) and a deeper miss (`/@alex/day/typo`) are two different
 * accidents with two different fixes, and telling a reader "page not found"
 * when the real problem is a misspelt name sends them looking in the wrong
 * place. `not-found.tsx` gets no props and cannot see the path, so this reads
 * it on the client — which is also the only place it is knowable, since the
 * 404 shell is static.
 */
export default function NotFoundNotice({
  homeUser,
  homeTitle,
}: {
  homeUser?: string;
  homeTitle?: string;
}) {
  const pathname = usePathname();
  const journal = parseJournalPath(pathname);
  const unknownJournal = journal !== null && journal.rest.replace(/\/$/, "") === "";

  return (
    <ReaderNotice
      titleKey={unknownJournal ? "err.unknownUserTitle" : "err.pageGoneTitle"}
      bodyKey={unknownJournal ? "err.unknownUserBody" : "err.pageGoneBody"}
      actions={[
        ...(homeUser && homeTitle
          ? [
              {
                href: journalPath(homeUser),
                labelKey: "err.goToJournal" as const,
                vars: { title: homeTitle },
              },
            ]
          : []),
        // "/" — B2170 made /welcome the signup page; this was a redirect here.
        { href: "/", labelKey: "err.aboutThisSite" as const },
      ]}
    />
  );
}
