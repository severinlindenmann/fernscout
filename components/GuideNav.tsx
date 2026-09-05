import Link from "next/link";
import { BookOpen, PenLine, Users } from "lucide-react";
import { GUIDES, type Guide } from "@/lib/docs";
import { translateIn } from "@/lib/locales";

/**
 * The menu that switches between the three guides — B445.
 *
 * A server component with no state: which one you are reading is in the URL,
 * so there is nothing here for JavaScript to decide. It renders identically on
 * `/docs` and on each guide, which is the point — a reader who lands on the
 * wrong one should be able to get to the right one without going back first.
 *
 * The icons carry no meaning the words do not; they are there because this row
 * is the only navigation on a page of solid prose and a reader scanning for it
 * finds shapes faster than they find text.
 */

const ICONS: Record<Guide, typeof BookOpen> = {
  guest: BookOpen,
  creator: PenLine,
  buddy: Users,
};

export default function GuideNav({
  locale,
  current,
}: {
  locale: string;
  /** The guide being read, drawn as the current one. Absent on `/docs`, where
   * none of the three is open. */
  current?: Guide;
}) {
  return (
    <nav aria-label={translateIn(locale, "guides.navLabel")} className="flex flex-wrap gap-2">
      {GUIDES.map((guide) => {
        const Icon = ICONS[guide];
        const active = guide === current;
        return (
          <Link
            key={guide}
            href={`/docs/guide/${guide}`}
            aria-current={active ? "page" : undefined}
            className={`inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-semibold
                        transition-colors focus-visible:outline-2 focus-visible:outline-offset-2
                        focus-visible:outline-blue-500 ${
                          active
                            ? "bg-yellow-400 text-yellow-950"
                            : "border border-navy-200 bg-white text-navy-900 hover:border-navy-700"
                        }`}
          >
            <Icon className="h-4 w-4" aria-hidden strokeWidth={2.2} />
            {translateIn(locale, `guides.${guide}.title`)}
          </Link>
        );
      })}
    </nav>
  );
}
