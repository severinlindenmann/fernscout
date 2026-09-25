import ReactMarkdown from "react-markdown";
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
 * Inline `code`'s colour is set in `app/globals.css` (`.prose code`), not as
 * a `prose-code:` utility here — B1796. The typography plugin's own default
 * inline-code colour is a fixed near-black with no dark-mode counterpart
 * wired up (no `dark:prose-invert` anywhere in this app; every other colour
 * above already reads from the theme-aware `ink-*` tokens instead), so it
 * went unreadable wherever a documentation page's surface flips dark. A
 * `prose-code:` utility looked like the fix but is not one: Tailwind's own
 * generated selector for it has no lower boundary at `pre`, so it also wins
 * against typography's `pre code { color: inherit }` and breaks the fenced
 * code block's own (correct, theme-independent) light-on-dark chip instead
 * — see the CSS rule's own comment for the `:not(pre code)` that scopes it.
 */
export default function EntryContent({ markdown }: { markdown: string }) {
  return (
    <div
      className="prose max-w-none prose-p:leading-relaxed prose-headings:font-display
        prose-headings:font-semibold prose-headings:text-ink-strong prose-p:text-ink-body
        prose-a:text-ink-strong prose-a:decoration-blue-500 prose-a:decoration-2
        prose-a:underline-offset-2 hover:prose-a:decoration-coral-600
        prose-strong:text-ink-strong prose-blockquote:border-yellow-400
        prose-blockquote:text-ink-secondary prose-li:text-ink-body prose-hr:border-line-quiet"
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
    </div>
  );
}
