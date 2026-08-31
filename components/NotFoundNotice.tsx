"use client";

import { usePathname } from "next/navigation";
import ReaderNotice from "./ReaderNotice";

/**
 * The root 404, worded from the URL that produced it.
 *
 * Every top-level path in this app is somebody's journal name, so a one-segment
 * miss (`/alx`) and a deeper miss (`/alex/day/typo`) are two different
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
  const segments = pathname.split("/").filter(Boolean);
  const unknownJournal = segments.length <= 1;

  return (
    <ReaderNotice
      titleKey={unknownJournal ? "err.unknownUserTitle" : "err.pageGoneTitle"}
      bodyKey={unknownJournal ? "err.unknownUserBody" : "err.pageGoneBody"}
      actions={[
        ...(homeUser && homeTitle
          ? [
              {
                href: `/${homeUser}`,
                labelKey: "err.goToJournal" as const,
                vars: { title: homeTitle },
              },
            ]
          : []),
        { href: "/welcome", labelKey: "err.aboutThisSite" as const },
      ]}
    />
  );
}
