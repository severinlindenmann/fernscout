"use client";

import { usePathname } from "next/navigation";
import UpLink from "./UpLink";

/**
 * One step up, out of the documentation — B1728.
 *
 * `/docs` is a two-level tree and `app/docs/layout.tsx` wraps both levels, so
 * this is the one thing on that page that has to know which level it is on.
 * A guide goes up to the hub; the hub goes up to the site. Before this every
 * page under `/docs` had the same link straight out to `/`, which meant the
 * only way from `/docs/hosting` to the hub that lists it was the browser's
 * own Back — the exact gap this ticket is about.
 *
 * Both labels arrive translated from the server layout, which is what keeps
 * this the only client component in that subtree.
 */
export default function DocsUpLink({
  hubHref,
  hubLabel,
  siteLabel,
  className,
}: {
  hubHref: string;
  hubLabel: string;
  siteLabel: string;
  className?: string;
}) {
  const atHub = usePathname() === hubHref;
  return (
    <UpLink
      href={atHub ? "/" : hubHref}
      label={atHub ? siteLabel : hubLabel}
      className={className}
    />
  );
}
