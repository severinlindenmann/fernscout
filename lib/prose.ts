import type { Day, Entry } from "./types";

/**
 * A day's prose, already rendered — the shape it travels to the browser in.
 *
 * The story page used to send each day's markdown and parse it in the reader's
 * browser, which put react-markdown, remark-gfm and the whole unified /
 * micromark toolchain behind it — the largest single piece of JavaScript on
 * the page — on every story page, to turn a few paragraphs into `<p>`s. The
 * server already had all of it, and renders the same markdown for the legal
 * page and the docs. So `EntryContent` now runs there (`lib/proseTree.tsx`),
 * and what crosses the wire is its output: the elements it drew, as data.
 *
 * Data rather than an HTML string, so nothing is ever handed to
 * `dangerouslySetInnerHTML`, and rather than React Server Component output,
 * because the days a reader pages to arrive from `/<user>/story.json` — a
 * plain GET the service worker caches and keeps for offline reading (B2158) —
 * and a server function answering a POST could be neither.
 *
 * `[tag, props, children]`: `props` holds only what `EntryContent` gave a host
 * element — strings, numbers, booleans, and a table cell's `style`.
 * `components/Prose.tsx` draws it back; `test/prose.test.tsx` holds the two
 * renderings of the same markdown to the same HTML.
 */
export type ProseNode = string | ProseElement;
type ProseElement = [tag: string, props: ProseProps | null, children: ProseNode[]];
export type ProseProps = Record<string, string | number | boolean | Record<string, string>>;

/**
 * Each update's prose, by entry slug, in the language this reader reads it
 * in. Absent on a day nobody rendered prose for — the helper room's preview,
 * say — which `DayCard` then renders from the markdown itself.
 */
export type DayProse = Record<string, ProseNode>;

/** A `Day` as the story page holds it: with its prose already drawn. */
export type StoryDay = Day & { prose?: DayProse };

/**
 * The markdown a reader in `locale` is shown for this update.
 *
 * `LocaleProvider.localized`'s own rule, for the server: the prose is chosen
 * here and the title there, and the two must never land in different
 * languages — `test/prose.test.tsx` renders both and holds them equal. See
 * `localized` for why it reads the way it does (B294, B305).
 */
export function contentFor(
  entry: Pick<Entry, "content" | "translations">,
  locale: string,
  writtenLocale: string,
): string {
  if (locale === writtenLocale) return entry.content;
  return entry.translations?.[locale]?.content ?? entry.content;
}
