import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * A reader's markdown, in the site's own type.
 *
 * Links are dark with a coloured underline rather than coloured text: blue-500
 * is 4.55:1 on white and 4.37:1 on cream-50, so as *words* it fails at the
 * sizes prose uses, while as a 2px underline it is a graphical object needing
 * only 3:1 and clears it everywhere. The words themselves then sit at 14:1.
 * Same trick as the landing page. The underline is always drawn, never only on
 * hover — colour alone must not be the thing that says "this is a link".
 *
 * Every other colour, inline code and tables included, is set once in
 * `app/globals.css` by pointing the typography plugin's `--tw-prose-*`
 * variables at the theme tokens (B1796, B2311). Its defaults are light-mode
 * only, and the per-element utilities that used to live here kept missing an
 * element — table cells went unreadable on the dark page.
 */
export default function EntryContent({
  markdown,
  components,
}: {
  markdown: string;
  /** Element overrides — the legal page gives its `h2`s their anchors. */
  components?: Components;
}) {
  return (
    <div
      className="prose max-w-none prose-p:leading-relaxed prose-headings:font-display
        prose-headings:font-semibold prose-a:decoration-blue-500 prose-a:decoration-2
        prose-a:underline-offset-2 hover:prose-a:decoration-coral-600
        prose-blockquote:border-yellow-400"
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
