import Link from "next/link";
import { translateIn } from "@/lib/locales";
import type { TranslationKey } from "@/lib/i18n";

/**
 * The one navigation every documentation page carries — B470.
 *
 * Entries arrive as a prop rather than being read here, so this component has
 * no opinion about which pages exist. That is what lets the hub render the
 * same destinations as cards *without* this row appearing above them —
 * which is the whole of the "two menus" fix. Before it, `/docs` drew a row of
 * anchors to its own sections beside a row of links to the guide pages: two
 * different kinds of navigation, drawn identically, side by side.
 */
export type DocsNavEntry = {
  /** The path, which is also the identity — `current` is compared to it. */
  href: string;
  /** A `TranslationKey`, resolved here so no caller passes rendered text. */
  labelKey: TranslationKey;
};

export default function DocsNav({
  locale,
  entries,
  current,
}: {
  locale: string;
  entries: readonly DocsNavEntry[];
  current?: string;
}) {
  return (
    <nav
      aria-label={translateIn(locale, "docs.navLabel")}
      className="flex flex-wrap items-center gap-x-1 gap-y-2"
    >
      {entries.map((entry) => {
        const active = entry.href === current;
        return (
          <Link
            key={entry.href}
            href={entry.href}
            aria-current={active ? "page" : undefined}
            className={`inline-flex min-h-11 items-center rounded-full px-3 text-sm font-semibold
                        transition-colors focus-visible:outline-2 focus-visible:outline-offset-2
                        focus-visible:outline-blue-500 ${
                          active
                            ? "bg-yellow-400 text-yellow-950"
                            : "text-ink-body hover:bg-surface-subtle hover:text-ink-strong"
                        }`}
          >
            {translateIn(locale, entry.labelKey)}
          </Link>
        );
      })}
    </nav>
  );
}
