"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { useI18n } from "./LocaleProvider";
import { useUpCrumbs } from "./useUpCrumbs";

/**
 * Where this page sits, drawn above the journal's title — B1728.
 *
 * One arrow can say where *up* is. It cannot say where you are, and "where am
 * I" is the question a reader who arrived on a shared link into one day is
 * actually asking. So at `sm` and up the header draws the whole chain —
 * `Fernscout › Trips › Sommer 2025` — furthest ancestor first, every crumb a real
 * link to a real page. Three is the most there can ever be, because the
 * journal is three deep (see lib/navUp.ts).
 *
 * The current page is deliberately **not** a crumb. The row directly below
 * this one is the journal's title, and `SiteNav` on the line after that marks
 * the section with the same yellow waymark it has always used; a third naming
 * of the page you are already looking at would be the only crumb nobody could
 * click.
 *
 * Below `sm` this draws nothing — `PageHeader`'s phone row has one line for
 * everything and takes the nearest crumb alone, as a labelled `UpLink`.
 */
export default function UpTrail({ className }: { className?: string }) {
  const { t } = useI18n();
  const crumbs = useUpCrumbs();
  if (crumbs.length === 0) return null;

  return (
    <nav
      aria-label={t("nav.trail")}
      className={className ?? "-ml-1 mb-0.5 hidden min-w-0 items-center gap-1 text-xs sm:flex"}
    >
      {[...crumbs].reverse().map((crumb, i) => (
        <span key={crumb.href} className="flex min-w-0 items-center gap-1">
          {i > 0 && (
            <ChevronRight
              className="h-3 w-3 shrink-0 text-ink-secondary/60"
              aria-hidden
              strokeWidth={2.4}
            />
          )}
          <Link
            href={crumb.href}
            className="truncate rounded px-1 py-0.5 font-semibold text-ink-secondary transition-colors
                       hover:text-ink-strong focus-visible:outline-2 focus-visible:outline-offset-2
                       focus-visible:outline-blue-500"
          >
            {crumb.label}
          </Link>
        </span>
      ))}
    </nav>
  );
}
