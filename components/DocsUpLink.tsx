"use client";

import { usePathname } from "next/navigation";
import UpLink from "./UpLink";
import { useLanguageHref } from "./LanguageLink";
import { READING } from "./landing/kit";

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
 * The label arrives translated from the server layout. On the hub itself
 * there is nothing to draw: the site's header (B2531) is the way out.
 */
export default function DocsUpLink({
  hubHref,
  hubLabel,
  className,
}: {
  hubHref: string;
  hubLabel: string;
  className?: string;
}) {
  // `/de/docs` is the hub too, and goes up to `/de` — B2473.
  const to = useLanguageHref();
  const atHub = usePathname() === to(hubHref);
  if (atHub) return null;
  return (
    <div className={`${READING} pt-6`}>
      <UpLink href={hubHref} label={hubLabel} className={className} />
    </div>
  );
}
