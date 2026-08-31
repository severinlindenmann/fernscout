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
 */
export default function EntryContent({ markdown }: { markdown: string }) {
  return (
    <div
      className="prose max-w-none prose-p:leading-relaxed prose-headings:font-display
        prose-headings:font-semibold prose-headings:text-navy-900 prose-p:text-navy-700
        prose-a:text-navy-900 prose-a:decoration-blue-500 prose-a:decoration-2
        prose-a:underline-offset-2 hover:prose-a:decoration-coral-600
        prose-strong:text-navy-900 prose-blockquote:border-yellow-400
        prose-blockquote:text-navy-600 prose-li:text-navy-700 prose-hr:border-navy-200"
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
    </div>
  );
}
